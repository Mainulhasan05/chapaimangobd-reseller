'use strict';

const crypto = require('node:crypto');

const env = require('../config/env');
const { logger } = require('../config/logger');
const Otp = require('../models/Otp');
const gateway = require('../channels/sms');
const smsService = require('./sms');
const { MongoRateLimitStore } = require('./rateLimitStore');
const { AppError, badRequest } = require('../utils/errors');
const { SMS_PURPOSE, SMS_STATUS, OTP_PURPOSE } = require('../domain/constants');

/**
 * One-time codes by SMS. See docs/adr/0014.
 *
 * - Six digits from `crypto.randomInt`, stored only as an HMAC keyed with a
 *   pepper that lives in the environment, never in the database.
 * - Five minutes to use it. Five wrong tries and it is void.
 * - A new code for the same phone and purpose voids the one before it, so only
 *   the latest SMS ever works.
 * - Three sends per phone per hour, counted in MongoDB so every instance shares
 *   the count (docs/adr/0012).
 * - Owner-paid (docs/adr/0013): the master switch does not apply, a configured
 *   gateway does. Outside production with no gateway the code is written to the
 *   server log instead, so development does not need an SMS account.
 *
 * Sent synchronously, not through the outbox: the person is looking at a form
 * waiting for the code, and needs to hear now if it could not be sent. Never
 * call this inside a transaction.
 */

const CODE_LENGTH = 6;
const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SENDS_PER_HOUR = 3;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

const sendCounter = new MongoRateLimitStore({ prefix: 'otp-send', windowMs: SEND_WINDOW_MS });
/*
 * One send per phone and purpose per minute. The hourly allowance alone let a
 * double-tap on "send again" spend two of the three codes in a second.
 */
const cooldown = new MongoRateLimitStore({ prefix: 'otp-cooldown', windowMs: RESEND_COOLDOWN_MS });
const cooldownKey = (phoneE164, purpose) => `${purpose}:${phoneE164}`;

/** Latest code per phone and purpose, for tests only. Never populated elsewhere. */
const testCodes = new Map();

const hashCode = (phoneE164, purpose, code) =>
  crypto
    .createHmac('sha256', env.otpPepper)
    .update(`${purpose}:${phoneE164}:${code}`)
    .digest('hex');

const hashChallenge = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

const generateCode = () => String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');

/** GSM-7, well under one segment, and says not to share it. */
const messageFor = (code) => `ChapaiMango code: ${code}. Valid 5 min. Do not share.`;

const sameHash = (a, b) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const smsUnavailable = () =>
  new AppError(503, 'SMS_UNAVAILABLE', 'The code could not be sent by SMS right now, please try later');

const expired = () =>
  badRequest('OTP_EXPIRED', 'That code has expired or was replaced, request a new one', {
    otp: 'Code expired',
  });

const invalid = () => badRequest('OTP_INVALID', 'That code is not correct', { otp: 'Wrong code' });

/**
 * Refuses when a code could never reach anyone. Only production refuses: a
 * development machine without a gateway prints the code instead.
 */
function assertCanSend() {
  if (env.isProd && !gateway.isConfigured()) throw smsUnavailable();
}

/**
 * Counts one send against the phone's hourly allowance, atomically. Called for
 * every request that could send, including ones for a phone with no account,
 * so the limit itself does not reveal which numbers are registered.
 *
 * With a purpose, the per-minute resend cooldown is taken first, so a refused
 * resend does not also spend one of the hour's codes. A refusal carries
 * `retryAfter`, the whole seconds until the next code may be requested.
 */
async function takeSendAllowance(phoneE164, purpose) {
  if (purpose) {
    const { totalHits: recent, resetTime } = await cooldown.increment(cooldownKey(phoneE164, purpose));
    if (recent > 1) {
      const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
      const err = new AppError(429, 'OTP_COOLDOWN', `Wait ${retryAfter} seconds before asking for another code`);
      err.details = { retryAfter };
      throw err;
    }
  }

  const { totalHits } = await sendCounter.increment(phoneE164);
  if (totalHits > SENDS_PER_HOUR) {
    throw new AppError(429, 'OTP_SEND_LIMIT', 'Too many codes requested for this number, try again later');
  }
}

/**
 * Issues and sends a code.
 *
 * @param {string} phoneE164
 * @param {string} purpose one of OTP_PURPOSE
 * @param {object} [opts]
 * @param {object} [opts.user] binds the code to an existing account
 * @param {boolean} [opts.withChallenge] also returns a random challenge id that
 *   must accompany the code, for the owner's new-device sign-in
 * @param {boolean} [opts.allowanceTaken] the caller already counted this send
 * @returns {Promise<{ expiresAt: Date, challengeId?: string }>}
 */
async function send(phoneE164, purpose, { user = null, withChallenge = false, allowanceTaken = false } = {}) {
  if (!Object.values(OTP_PURPOSE).includes(purpose)) throw new Error(`otp: unknown purpose ${purpose}`);

  assertCanSend();
  if (!allowanceTaken) await takeSendAllowance(phoneE164, purpose);

  const now = new Date();
  const code = generateCode();
  const challengeId = withChallenge ? crypto.randomBytes(32).toString('base64url') : null;

  // Only the newest SMS works. Voided before the insert, so there is never a
  // moment with two live codes for one phone and purpose.
  await Otp.updateMany(
    { phoneE164, purpose, consumedAt: null, voidedAt: null },
    { $set: { voidedAt: now } }
  );

  const doc = await Otp.create({
    phoneE164,
    purpose,
    codeHash: hashCode(phoneE164, purpose, code),
    expiresAt: new Date(now.getTime() + TTL_MS),
    userId: user ? user._id || user : null,
    challengeHash: challengeId ? hashChallenge(challengeId) : null,
  });

  if (env.isTest) {
    // Deleted first so insertion order tracks the newest send.
    testCodes.delete(`${phoneE164}:${purpose}`);
    testCodes.set(`${phoneE164}:${purpose}`, code);
  }

  const text = messageFor(code);
  let result;
  try {
    result = await smsService.sendOwnerPaid({
      phoneE164,
      text,
      logText: messageFor('******'),
      purpose: SMS_PURPOSE.OTP,
      user,
    });
  } catch (err) {
    // A retryable gateway failure. The code is useless if it never arrived.
    result = { status: SMS_STATUS.FAILED, error: err.message };
  }

  if (result.status !== SMS_STATUS.SENT) {
    if (!gateway.isConfigured() && !env.isProd) {
      // Development without a gateway: the log is the SMS.
      logger.warn({ phone: phoneE164, purpose, code }, 'otp: SMS gateway not configured, code logged instead');
    } else {
      await Otp.updateOne({ _id: doc._id }, { $set: { voidedAt: new Date() } });
      // Nothing arrived, so asking again straight away is fair.
      await cooldown.resetKey(cooldownKey(phoneE164, purpose));
      logger.error({ purpose, status: result.status, error: result.error }, 'otp: code could not be sent');
      throw smsUnavailable();
    }
  }

  return { expiresAt: doc.expiresAt, ...(challengeId ? { challengeId } : {}) };
}

/**
 * Checks a code and consumes it. A wrong code costs an attempt, and the fifth
 * wrong one voids the code. Consumption is one guarded update, so a code
 * cannot be spent twice by two requests racing.
 *
 * Returns the consumed document, whose `userId` a caller can trust.
 */
async function consume(filter, code, hashFor) {
  const now = new Date();
  const live = { consumedAt: null, voidedAt: null, expiresAt: { $gt: now }, attempts: { $lt: MAX_ATTEMPTS } };

  const doc = await Otp.findOne({ ...filter, ...live })
    .sort({ createdAt: -1 })
    .select('+codeHash');
  if (!doc) throw expired();

  const given = typeof code === 'string' ? code.trim() : '';
  const matches = /^\d{6}$/.test(given) && sameHash(hashFor(doc, given), doc.codeHash);

  if (!matches) {
    // One pipeline update: count the attempt, and void on reaching the cap.
    const updated = await Otp.findOneAndUpdate(
      { _id: doc._id, consumedAt: null, voidedAt: null },
      [
        { $set: { attempts: { $add: ['$attempts', 1] } } },
        { $set: { voidedAt: { $cond: [{ $gte: ['$attempts', MAX_ATTEMPTS] }, now, null] } } },
      ],
      { new: true }
    );
    if (!updated || updated.voidedAt) throw expired();
    throw invalid();
  }

  const consumed = await Otp.findOneAndUpdate(
    { _id: doc._id, ...live },
    { $set: { consumedAt: now } },
    { new: true }
  );
  if (!consumed) throw expired();
  return consumed;
}

/**
 * Verifies the latest code for a phone and purpose. Pass `user` to require the
 * code to have been issued to that account.
 */
function verify(phoneE164, purpose, code, { user = null } = {}) {
  const filter = { phoneE164, purpose };
  if (user) filter.userId = user._id || user;
  return consume(filter, code, (doc, given) => hashCode(doc.phoneE164, doc.purpose, given));
}

/** Verifies a code sent with a challenge id, which is what identifies the attempt. */
function verifyChallenge(challengeId, purpose, code) {
  if (typeof challengeId !== 'string' || challengeId.length < 20) return Promise.reject(expired());
  return consume({ challengeHash: hashChallenge(challengeId), purpose }, code, (doc, given) =>
    hashCode(doc.phoneE164, doc.purpose, given)
  );
}

/** The last code sent to a phone for a purpose. Test runs only. */
function lastCodeFor(phoneE164, purpose) {
  if (!env.isTest) throw new Error('otp: __lastCodeFor is available only under NODE_ENV=test');
  if (purpose) return testCodes.get(`${phoneE164}:${purpose}`) || null;
  const match = [...testCodes.entries()].reverse().find(([key]) => key.startsWith(`${phoneE164}:`));
  return match ? match[1] : null;
}

module.exports = {
  send,
  verify,
  verifyChallenge,
  assertCanSend,
  takeSendAllowance,
  hashCode,
  messageFor,
  CODE_LENGTH,
  TTL_MS,
  MAX_ATTEMPTS,
  SENDS_PER_HOUR,
  RESEND_COOLDOWN_MS,
  ...(env.isTest ? { __lastCodeFor: lastCodeFor } : {}),
};
