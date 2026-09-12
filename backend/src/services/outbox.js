'use strict';

const OutboxMessage = require('../models/OutboxMessage');
const ResellerProfile = require('../models/ResellerProfile');
const User = require('../models/User');
const webpush = require('../channels/webpush');
const telegram = require('../channels/telegram');
const smsService = require('./sms');
const { NOTIFICATION_CHANNEL, SMS_PURPOSE } = require('../domain/constants');

/**
 * Drains side effects that were queued during a database transaction.
 *
 * Nothing sends from inside a transaction, because the callback is retried on
 * write conflict and the reseller would receive the same message twice.
 */

const MAX_ATTEMPTS = 5;
const POLL_MS = 15 * 1000;

/** Exponential backoff, so a dead gateway is not hammered. */
const backoffMs = (attempts) => Math.min(60 * 60 * 1000, 1000 * 2 ** attempts);

async function deliver(message) {
  const user = await User.findById(message.user);
  if (!user) return;

  const { title, body, data } = message.payload || {};
  const errors = [];

  for (const channel of message.channels) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deliverOne(channel, { user, title, body, data, message });
    } catch (err) {
      errors.push(`${channel}: ${err.message}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('; '));
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

/** Processes one batch of due messages. Returns how many were handled. */
async function drainOnce(limit = 25) {
  const due = await OutboxMessage.find({
    sentAt: null,
    nextAttemptAt: { $lte: new Date() },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit);

  let delivered = 0;

  for (const message of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deliver(message);
      // eslint-disable-next-line no-await-in-loop
      await OutboxMessage.updateOne(
        { _id: message._id },
        { $set: { sentAt: new Date(), lastError: null }, $inc: { attempts: 1 } }
      );
      delivered += 1;
    } catch (err) {
      const attempts = message.attempts + 1;
      // eslint-disable-next-line no-await-in-loop
      await OutboxMessage.updateOne(
        { _id: message._id },
        {
          $set: {
            attempts,
            lastError: err.message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
          },
        }
      );
    }
  }

  return delivered;
}

let timer = null;

function startOutboxWorker({ intervalMs = POLL_MS } = {}) {
  if (timer) return timer;
  timer = setInterval(() => {
    drainOnce().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[outbox] drain failed', err.message);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}

function stopOutboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { drainOnce, startOutboxWorker, stopOutboxWorker, MAX_ATTEMPTS };
