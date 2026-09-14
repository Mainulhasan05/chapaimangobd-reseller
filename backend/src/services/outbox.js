'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

const { logger } = require('../config/logger');
const OutboxMessage = require('../models/OutboxMessage');
const ResellerProfile = require('../models/ResellerProfile');
const User = require('../models/User');
const webpush = require('../channels/webpush');
const telegram = require('../channels/telegram');
const smsService = require('./sms');
const { NOTIFICATION_CHANNEL, SMS_PURPOSE, ROLES } = require('../domain/constants');

const { OUTBOX_STATUS, OUTBOX_KIND, CHANNEL_STATUS, toChannelState } = OutboxMessage;

/**
 * Drains side effects that were queued during a database transaction.
 *
 * Nothing sends from inside a transaction, because the callback is retried on
 * write conflict and the reseller would receive the same message twice.
 *
 * Safe with any number of API instances (docs/adr/0012):
 * - a message is claimed with one atomic update that sets a lease, so two
 *   workers never hold the same message;
 * - each channel records its own outcome, so a retry after a Telegram failure
 *   does not send the web push again;
 * - after MAX_ATTEMPTS the message is dead-lettered, left for the owner's daily
 *   digest rather than retried forever.
 */

const MAX_ATTEMPTS = 5;
const POLL_MS = 15 * 1000;
// Longer than the worst case for one message: three external channels with a
// 15 second timeout each. A lease that expires mid-send lets another worker
// resend, so this errs long.
const LEASE_MS = 60 * 1000;

/** Identifies this process in `leaseOwner`, for debugging a stuck message. */
const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

/** Exponential backoff, so a dead gateway is not hammered. */
const backoffMs = (attempts) => Math.min(60 * 60 * 1000, 1000 * 2 ** attempts);

/**
 * Queues a message. Pass `session` from inside a transaction: the message then
 * commits or vanishes with the business write that caused it.
 */
async function enqueue({ user, eventType, channels, payload }, { session } = {}) {
  const [message] = await OutboxMessage.create(
    [
      {
        user: user && user._id ? user._id : user,
        eventType,
        channels: (channels || []).map(toChannelState),
        payload,
      },
    ],
    session ? { session } : {}
  );
  return message;
}

/**
 * Queues an SMS to a customer: owner-paid, one channel, no account behind it.
 *
 * `text` is stored exactly as rendered for the owner's preview and is sent as
 * is; nothing downstream re-renders it. Pass `session` from the transition's
 * transaction so the message exists only if the status change commits.
 */
async function enqueueCustomerSms({ phoneE164, text, eventType, orderId }, { session } = {}) {
  const [message] = await OutboxMessage.create(
    [
      {
        kind: OUTBOX_KIND.CUSTOMER_SMS,
        eventType,
        channels: [NOTIFICATION_CHANNEL.SMS],
        payload: { phoneE164, text, orderId },
      },
    ],
    session ? { session } : {}
  );
  return message;
}

async function deliverOne(channel, { user, title, body, data, message }) {
  if (channel === NOTIFICATION_CHANNEL.WEB_PUSH) {
    await webpush.send({ userId: user._id, title, body, data });
    return;
  }

  if (channel === NOTIFICATION_CHANNEL.TELEGRAM) {
    await telegram.send({ userId: user._id, title, body });
    return;
  }

  if (channel === NOTIFICATION_CHANNEL.SMS) {
    await sendSms(user, title, body, message);
  }
}

/**
 * SMS is the only channel that costs money and the only one the owner can switch
 * off for everybody at once, so it goes through services/sms.js rather than the
 * gateway. That service re-checks the master switch, moves the credits and
 * writes the log row; all that is left here is finding whose credits to spend.
 *
 * It throws only when the message deserves another attempt, which is what keeps
 * a permanently rejected number from being re-queued five times.
 */
async function sendSms(user, title, body, message) {
  /*
   * An SMS addressed to the owner is an owner alert, and the business pays for
   * those: it goes out whatever the master switch says (docs/adr/0013).
   */
  if (user.role === ROLES.OWNER) {
    await smsService.sendOwnerPaid({
      phoneE164: user.phoneE164,
      text: body ? `${title}. ${body}` : title,
      purpose: SMS_PURPOSE.OWNER_ALERT,
      eventType: message.eventType,
      user,
      outboxMessage: message._id,
    });
    return;
  }

  const profile = await ResellerProfile.findOne({ user: user._id });

  await smsService.send({
    phoneE164: user.phoneE164,
    text: body ? `${title}. ${body}` : title,
    purpose: SMS_PURPOSE.NOTIFICATION,
    eventType: message.eventType,
    user,
    // Only a reseller pays. The owner has no profile and no credit balance, and
    // a notification addressed to them is not a reseller cost.
    charge: profile || null,
    outboxMessage: message._id,
  });
}

/**
 * Atomically takes one due message. Documents written before per-channel
 * state and statuses existed have neither `status` nor `leaseUntil`, and
 * `null` in the filter matches a missing field, so they are claimed too.
 */
function claimNext(now = new Date()) {
  return OutboxMessage.findOneAndUpdate(
    {
      status: { $in: [OUTBOX_STATUS.PENDING, null] },
      sentAt: null,
      nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), leaseOwner: WORKER_ID } },
    { sort: { nextAttemptAt: 1 }, new: true, lean: true }
  );
}

/** Writes only while this worker still holds the lease. */
const withLease = (message) => ({ _id: message._id, leaseOwner: WORKER_ID });

/**
 * Tries every channel not already sent, recording each outcome as it happens,
 * so a crash between two channels does not resend the first.
 * Returns true when every channel has now gone out.
 */
async function processMessage(message) {
  const states = (message.channels || []).map((c) => ({ ...toChannelState(c) }));
  const attempts = (message.attempts || 0) + 1;

  // A message that exhausted its attempts under the old worker is dead-lettered
  // without another try.
  if ((message.attempts || 0) >= MAX_ATTEMPTS) {
    await OutboxMessage.updateOne(withLease(message), {
      $set: { channels: states, status: OUTBOX_STATUS.DEAD, deadAt: new Date() },
      $unset: { leaseUntil: 1, leaseOwner: 1 },
    });
    return false;
  }

  if (message.kind === OUTBOX_KIND.CUSTOMER_SMS) {
    return processCustomerSms(message, states, attempts);
  }

  const user = await User.findById(message.user);
  if (!user) {
    // Nobody left to tell. Not a failure worth retrying or reporting.
    await OutboxMessage.updateOne(withLease(message), {
      $set: {
        channels: states,
        status: OUTBOX_STATUS.SENT,
        sentAt: new Date(),
        lastError: 'recipient no longer exists',
      },
      $inc: { attempts: 1 },
      $unset: { leaseUntil: 1, leaseOwner: 1 },
    });
    return false;
  }

  const { title, body, data } = message.payload || {};
  return deliverStates(message, states, attempts, (name) =>
    deliverOne(name, { user, title, body, data, message })
  );
}

/**
 * A customer SMS. The business pays and the master switch does not apply
 * (docs/adr/0013); services/sms.js still writes the log row and throws only for
 * a failure worth retrying.
 */
function processCustomerSms(message, states, attempts) {
  const { phoneE164, text, orderId } = message.payload || {};
  return deliverStates(message, states, attempts, () =>
    smsService.sendOwnerPaid({
      phoneE164,
      text,
      purpose: SMS_PURPOSE.CUSTOMER,
      eventType: message.eventType,
      outboxMessage: message._id,
      order: orderId || null,
    })
  );
}

/** Tries each unsent channel with `send`, recording outcomes; see processMessage. */
async function deliverStates(message, states, attempts, send) {
  const errors = [];

  for (const state of states) {
    if (state.status === CHANNEL_STATUS.SENT) continue; // eslint-disable-line no-continue
    state.attempts = (state.attempts || 0) + 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      await send(state.name);
      state.status = CHANNEL_STATUS.SENT;
      state.sentAt = new Date();
      state.lastError = null;
    } catch (err) {
      state.status = CHANNEL_STATUS.FAILED;
      state.lastError = String(err.message || err).slice(0, 500);
      errors.push(`${state.name}: ${state.lastError}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await OutboxMessage.updateOne(withLease(message), { $set: { channels: states } });
  }

  if (errors.length === 0) {
    await OutboxMessage.updateOne(withLease(message), {
      $set: { status: OUTBOX_STATUS.SENT, sentAt: new Date(), lastError: null, attempts },
      $unset: { leaseUntil: 1, leaseOwner: 1 },
    });
    return true;
  }

  const lastError = errors.join('; ').slice(0, 500);
  if (attempts >= MAX_ATTEMPTS) {
    await OutboxMessage.updateOne(withLease(message), {
      $set: { status: OUTBOX_STATUS.DEAD, deadAt: new Date(), lastError, attempts },
      $unset: { leaseUntil: 1, leaseOwner: 1 },
    });
    logger.warn({ outboxMessage: message._id, lastError }, 'outbox: message dead-lettered');
    return false;
  }

  await OutboxMessage.updateOne(withLease(message), {
    $set: {
      status: OUTBOX_STATUS.PENDING,
      attempts,
      lastError,
      nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
    },
    $unset: { leaseUntil: 1, leaseOwner: 1 },
  });
  return false;
}

/** Processes up to `limit` due messages. Returns how many were fully delivered. */
async function drainOnce(limit = 25) {
  let delivered = 0;

  for (let i = 0; i < limit; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const message = await claimNext();
    if (!message) break;

    try {
      // eslint-disable-next-line no-await-in-loop
      if (await processMessage(message)) delivered += 1;
    } catch (err) {
      // A database error mid-message. The lease expires and the message is
      // picked up again; channels already recorded as sent stay sent.
      logger.error({ err, outboxMessage: message._id }, 'outbox: processing failed');
    }
  }

  return delivered;
}

/** How many messages gave up, in total and since `since`. For the digest. */
async function deadLetterCounts({ since } = {}) {
  const [total, recent] = await Promise.all([
    OutboxMessage.countDocuments({ status: OUTBOX_STATUS.DEAD }),
    since
      ? OutboxMessage.countDocuments({ status: OUTBOX_STATUS.DEAD, deadAt: { $gte: since } })
      : Promise.resolve(null),
  ]);
  return { total, recent };
}

let timer = null;
let inFlight = null;

/**
 * One tick at a time in this process. A slow gateway used to let the next
 * interval start a second drain over the same messages before the first ended.
 */
function tick() {
  if (inFlight) return inFlight;
  inFlight = drainOnce()
    .catch((err) => {
      logger.error({ err }, 'outbox: drain failed');
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function startOutboxWorker({ intervalMs = POLL_MS } = {}) {
  if (timer) return timer;
  timer = setInterval(tick, intervalMs);
  timer.unref();
  return timer;
}

/** Stops polling and resolves once the drain in progress, if any, finishes. */
async function stopOutboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  if (inFlight) await inFlight;
}

module.exports = {
  enqueue,
  enqueueCustomerSms,
  drainOnce,
  tick,
  deadLetterCounts,
  startOutboxWorker,
  stopOutboxWorker,
  backoffMs,
  MAX_ATTEMPTS,
  LEASE_MS,
  OUTBOX_STATUS,
  CHANNEL_STATUS,
};
