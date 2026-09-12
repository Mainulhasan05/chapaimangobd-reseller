'use strict';

const env = require('../config/env');
const { toLocalBd } = require('../utils/phone');

/**
 * Automas SMS gateway. Transport only.
 *
 * This module knows how to talk to the gateway and nothing else. It does not
 * check the feature flag, it does not spend credits and it does not write a log
 * row, because a module that could be called without doing those things is a
 * module that will be. `services/sms.js` is the only caller and is where all
 * three live; see the note at the top of it.
 *
 * Bengali text is Unicode, which caps a segment at 70 characters against 160 for
 * ASCII and therefore roughly doubles the cost of a long message. Templates stay
 * short, and Latin script is preferred wherever it still reads acceptably.
 */

const GSM_SEGMENT = 160;
const UNICODE_SEGMENT = 70;

const STATUS = {
  SUCCESS: 0,
  AUTH_FAILED: 103,
  BAD_API_KEY: 106,
  INVALID_NUMBER: 108,
  BLOCKED_SENDER: 109,
  INSUFFICIENT_BALANCE: 1000,
};

/** How much of a gateway reply is worth keeping when it is not what we expected. */
const RAW_LIMIT = 2000;

/** True when the message needs Unicode encoding, which Bengali always does. */
const needsUnicode = (text) => /[^\x00-\x7F]/.test(text);

const encodingOf = (text) => (needsUnicode(text) ? 'unicode' : 'gsm');

/** How many gateway messages this text will actually cost. */
function segmentCount(text) {
  const size = needsUnicode(text) ? UNICODE_SEGMENT : GSM_SEGMENT;
  return Math.max(1, Math.ceil(text.length / size));
}

/**
 * A gateway failure, carrying everything the log row needs.
 *
 * It used to carry a code and a message. That was enough to retry on and not
 * nearly enough to diagnose with: when a send failed the only surviving trace
 * was a sentence, and the reply that produced it was gone. Now the parsed body,
 * the raw bytes and the HTTP status ride along, so a failed row in the panel
 * shows what the gateway actually said.
 */
class SmsError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SmsError';
    this.code = code;
    this.httpStatus = detail.httpStatus ?? null;
    this.payload = detail.payload ?? null;
    this.raw = detail.raw ?? null;
    this.durationMs = detail.durationMs ?? null;
    // An auth failure or an empty gateway balance is our problem, not the
    // recipient problem, so retrying the same message will not help.
    this.retryable =
      code !== STATUS.AUTH_FAILED &&
      code !== STATUS.BAD_API_KEY &&
      code !== STATUS.INVALID_NUMBER &&
      code !== STATUS.BLOCKED_SENDER;
  }
}

const isConfigured = () => env.smsConfigured;

/** Keeps the API key out of anything that gets stored or printed. */
const redact = (params) => {
  const out = Object.fromEntries(new URLSearchParams(params));
  if (out.apikey) out.apikey = `${out.apikey.slice(0, 4)}…`;
  return out;
};

/**
 * Sends one SMS.
 *
 * Returns everything the gateway said, not just the id: the caller writes a log
 * row out of it and the raw reply is the only evidence that survives.
 * The caller is responsible for the feature flag and the credits.
 */
async function send({ phoneE164, text }) {
  if (!isConfigured()) {
    throw new SmsError(STATUS.AUTH_FAILED, 'SMS gateway is not configured');
  }

  const msisdn = toLocalBd(phoneE164);
  const params = new URLSearchParams({
    apikey: env.smsApiKey,
    senderid: env.smsSenderId,
    msisdn,
    msg: text,
    type: 'text',
  });

  // smsformat 8 is the gateway flag for Unicode, without which Bengali arrives
  // as question marks.
  if (needsUnicode(text)) params.set('smsformat', '8');

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(env.SMS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    // The gateway was never reached: a timeout, or DNS, or a refused socket.
    // Worth retrying, and worth saying which so the panel does not just read
    // "failed".
    throw new SmsError(-1, `SMS gateway unreachable: ${err.message}`, {
      durationMs: Date.now() - startedAt,
    });
  }

  const durationMs = Date.now() - startedAt;
  const raw = (await response.text()).slice(0, RAW_LIMIT);

  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Left null deliberately. Automas answers an outage with an HTML page, and
    // the raw copy below is what makes that legible in the panel.
  }

  const detail = { httpStatus: response.status, payload, raw, durationMs };

  if (!response.ok) {
    throw new SmsError(-1, `SMS gateway returned HTTP ${response.status}`, detail);
  }

  if (!payload) {
    throw new SmsError(-1, 'SMS gateway returned a reply that was not JSON', detail);
  }

  const first = Array.isArray(payload.response) ? payload.response[0] : payload.response;

  if (!first || Number(first.status) !== STATUS.SUCCESS) {
    const code = first ? Number(first.status) : -1;
    throw new SmsError(code, describeStatus(code), detail);
  }

  return {
    id: first.id ? String(first.id) : null,
    statusCode: STATUS.SUCCESS,
    segments: segmentCount(text),
    encoding: encodingOf(text),
    msisdn,
    senderId: env.smsSenderId,
    request: redact(params),
    ...detail,
  };
}

function describeStatus(code) {
  switch (code) {
    case STATUS.AUTH_FAILED:
      return 'SMS gateway authentication failed';
    case STATUS.BAD_API_KEY:
      return 'SMS gateway rejected the API key';
    case STATUS.INVALID_NUMBER:
      return 'SMS gateway rejected the phone number';
    case STATUS.BLOCKED_SENDER:
      return 'SMS gateway rejected the sender id';
    case STATUS.INSUFFICIENT_BALANCE:
      return 'SMS gateway account has no balance left';
    default:
      return `SMS gateway returned status ${code}`;
  }
}

/** Gateway account balance, so the owner can be warned before sending fails. */
async function checkBalance() {
  if (!isConfigured()) return null;

  const url = `${env.SMS_BALANCE_URL}?api_key=${encodeURIComponent(env.smsApiKey)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new SmsError(-1, `Balance check returned HTTP ${response.status}`);

  const payload = await response.json();
  const balance = Number(payload.response);
  return Number.isFinite(balance) ? balance : null;
}

module.exports = {
  STATUS,
  SmsError,
  isConfigured,
  needsUnicode,
  encodingOf,
  segmentCount,
  send,
  checkBalance,
  describeStatus,
};
