'use strict';

const { logger } = require('../config/logger');
const SmsLog = require('../models/SmsLog');
const ResellerProfile = require('../models/ResellerProfile');
const gateway = require('../channels/sms');
const { getSettings } = require('./settings');
const {
  SMS_STATUS,
  SMS_BLOCK_REASON,
  SMS_PURPOSE,
  SMS_PAYER,
  SMS_CATEGORY,
} = require('../domain/constants');

/**
 * The only way an SMS leaves this platform.
 *
 * Three things have to happen around every send and none of them may be
 * optional: the owner's switch is honoured, credits are spent and refunded
 * correctly, and a row is written whatever the outcome. Scattering those across
 * call sites is how a message ends up sent with no record of it, so they live
 * here and `channels/sms.js` is left as bare transport. Nothing else in the
 * codebase calls the gateway.
 *
 * `send` never throws for a failure that is final. It throws only when the
 * caller should try again later, which is what tells the outbox worker to
 * re-queue. A doomed message, a rejected number or a switched-off feature all
 * return normally with a log row explaining themselves, because retrying any of
 * them five times over an hour would change nothing but the bill.
 */

/** Longer than any template here. A truncated message is worse than a short one. */
const MAX_TEXT = 1000;

/**
 * Writes the row. Never throws: losing the record is bad, but failing the send
 * because the record could not be written would be worse, and the thrown error
 * would be reported to a reseller who did nothing wrong.
 */
async function record(row) {
  try {
    return await SmsLog.create(row);
  } catch (err) {
    logger.error({ err, purpose: row.purpose }, 'sms: could not write the log row');
    return null;
  }
}

/** The shape `send` hands back, so a caller never has to read the mongoose doc. */
const outcome = (status, log, extra = {}) => ({
  status,
  logId: log ? log._id : null,
  ...extra,
});

/** The log category a purpose implies, when the caller does not name one. */
const CATEGORY_BY_PURPOSE = {
  [SMS_PURPOSE.NOTIFICATION]: SMS_CATEGORY.NOTIFICATION,
  [SMS_PURPOSE.TEST]: SMS_CATEGORY.TEST,
  [SMS_PURPOSE.MANUAL]: SMS_CATEGORY.MANUAL,
  [SMS_PURPOSE.OTP]: SMS_CATEGORY.OTP,
  [SMS_PURPOSE.OWNER_ALERT]: SMS_CATEGORY.OWNER_ALERT,
};

/**
 * Sends one SMS and records it.
 *
 * `charge` names the reseller profile whose credits pay for the message. Leave
 * it out and nobody is charged, which is right for anything the owner sends:
 * a test costs the owner gateway balance and no reseller asked for it.
 */
async function send({
  phoneE164,
  text,
  purpose = SMS_PURPOSE.NOTIFICATION,
  eventType = null,
  user = null,
  charge = null,
  triggeredBy = null,
  outboxMessage = null,
  /** Set by the owner's test send, the one path allowed past the master switch. */
  ignoreFeatureFlag = false,
  /*
   * `owner` marks a message the business pays for: OTP, owner alerts, customer
   * SMS. It ignores the master switch and can never spend reseller credits,
   * because the switch exists to stop resellers' spending, not the login form.
   * See docs/adr/0013. Left out, it is inferred from `charge`.
   */
  payer = null,
  category = null,
  /**
   * What the log row says instead of the text, for a message whose content is
   * a secret. An OTP is sent in full and recorded masked, so the SMS panel is
   * not a list of working codes.
   */
  logText = null,
}) {
  const body = (text || '').trim().slice(0, MAX_TEXT);
  const ownerPaid = payer === SMS_PAYER.OWNER;
  if (ownerPaid && charge) {
    throw new Error('sms: an owner-paid message cannot charge a reseller');
  }

  const base = {
    toPhoneE164: phoneE164 || null,
    toLocal: null,
    senderId: null,
    text: logText == null ? body : String(logText).slice(0, MAX_TEXT),
    encoding: gateway.encodingOf(body),
    segments: gateway.segmentCount(body || ' '),
    purpose,
    payer: payer || (charge ? SMS_PAYER.RESELLER : SMS_PAYER.OWNER),
    category: category || CATEGORY_BY_PURPOSE[purpose] || null,
    eventType,
    user: user ? user._id || user : null,
    reseller: charge ? charge._id : null,
    resellerName: charge ? charge.shopName || null : null,
    triggeredBy: triggeredBy ? triggeredBy._id || triggeredBy : null,
    outboxMessage,
  };

  const blocked = async (reason, message) =>
    outcome(
      SMS_STATUS.BLOCKED,
      await record({ ...base, status: SMS_STATUS.BLOCKED, blockedReason: reason, error: message }),
      { reason }
    );

  if (!phoneE164) return blocked(SMS_BLOCK_REASON.NO_RECIPIENT, 'No phone number to send to');
  if (!body) return blocked(SMS_BLOCK_REASON.EMPTY_TEXT, 'The message was empty');

  /*
   * Read fresh, not from the thirty second cache. This is the owner's kill
   * switch: when it is thrown off, the next message must not go out, and a
   * message costing money on the strength of a stale read is not a trade worth
   * making for one query on a path that is about to make a network call anyway.
   */
  const settings = await getSettings({ fresh: true });
  if (!settings.features.sms && !ignoreFeatureFlag && !ownerPaid) {
    return blocked(SMS_BLOCK_REASON.FEATURE_OFF, 'SMS is switched off by the owner');
  }

  if (!gateway.isConfigured()) {
    return blocked(SMS_BLOCK_REASON.NOT_CONFIGURED, 'SMS gateway credentials are not set');
  }

  /*
   * The credit is taken before the send and given back if the send fails.
   *
   * Charging per attempt and refunding only a permanent failure was the older
   * rule, and it meant a gateway timing out five times took five credits off a
   * reseller for one message nobody received. Refunding every failure can at
   * worst give back a credit for a message that did arrive after a timeout; the
   * log row records both the charge and the refund either way, so the owner can
   * see it happen rather than discovering it in a balance.
   */
  const cost = base.segments;
  let charged = 0;

  if (charge) {
    const paid = await ResellerProfile.findOneAndUpdate(
      { _id: charge._id, smsCredits: { $gte: cost } },
      { $inc: { smsCredits: -cost } },
      { new: true }
    );
    if (!paid) {
      return blocked(SMS_BLOCK_REASON.NO_CREDITS, 'The reseller has no SMS credits left');
    }
    charged = cost;
  }

  try {
    const result = await gateway.send({ phoneE164, text: body });

    const log = await record({
      ...base,
      toLocal: result.msisdn,
      senderId: result.senderId,
      status: SMS_STATUS.SENT,
      providerMessageId: result.id,
      providerStatusCode: result.statusCode,
      providerHttpStatus: result.httpStatus,
      providerResponse: result.payload,
      providerRaw: result.raw,
      creditsCharged: charged,
      durationMs: result.durationMs,
      sentAt: new Date(),
    });

    return outcome(SMS_STATUS.SENT, log, { providerMessageId: result.id, segments: cost });
  } catch (err) {
    let refunded = 0;
    if (charged > 0) {
      await ResellerProfile.updateOne({ _id: charge._id }, { $inc: { smsCredits: charged } });
      refunded = charged;
    }

    const retryable = err.retryable !== false;

    const log = await record({
      ...base,
      status: SMS_STATUS.FAILED,
      providerStatusCode: typeof err.code === 'number' ? err.code : null,
      providerHttpStatus: err.httpStatus ?? null,
      providerResponse: err.payload ?? null,
      providerRaw: err.raw ?? null,
      error: err.message,
      retryable,
      creditsCharged: charged,
      creditsRefunded: refunded,
      durationMs: err.durationMs ?? null,
    });

    // Only a failure that could plausibly succeed later goes back to the worker.
    // A rejected key or a rejected number is final, and re-queuing it would put
    // five identical rows in the log for one message that was never going to send.
    if (retryable) {
      const wrapped = new Error(err.message);
      wrapped.smsLogId = log ? log._id : null;
      throw wrapped;
    }

    return outcome(SMS_STATUS.FAILED, log, { error: err.message, retryable });
  }
}

/** The gateway's own balance, or null when it is not configured. */
async function balance() {
  if (!gateway.isConfigured()) return null;
  return gateway.checkBalance();
}

/**
 * An SMS the business pays for (docs/adr/0013): OTP, owner alerts. Needs only a
 * configured gateway. Same return and throw contract as `send`.
 */
const sendOwnerPaid = (options) => send({ ...options, charge: null, payer: SMS_PAYER.OWNER });

module.exports = { send, sendOwnerPaid, balance, MAX_TEXT };
