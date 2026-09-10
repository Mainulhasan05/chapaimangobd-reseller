'use strict';

const env = require('../config/env');
const { toLocalBd } = require('../utils/phone');

/**
 * Automas SMS gateway.
 *
 * Fully implemented but not exposed at launch: it sits behind the features.sms
 * setting, which defaults to off. Resellers buy credits before they can send.
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
  INSUFFICIENT_BALANCE: 1000,
};

/** True when the message needs Unicode encoding, which Bengali always does. */
const needsUnicode = (text) => /[^\x00-\x7F]/.test(text);

/** How many gateway messages this text will actually cost. */
function segmentCount(text) {
  const size = needsUnicode(text) ? UNICODE_SEGMENT : GSM_SEGMENT;
  return Math.max(1, Math.ceil(text.length / size));
}

class SmsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SmsError';
    this.code = code;
    // An auth failure or an empty gateway balance is our problem, not the
    // recipient problem, so retrying the same message will not help.
    this.retryable = code !== STATUS.AUTH_FAILED && code !== STATUS.BAD_API_KEY;
  }
}

const isConfigured = () => env.smsConfigured;

/**
 * Sends one SMS. Returns the gateway message id.
 * The caller is responsible for having checked the feature flag and the credits.
 */
async function send({ phoneE164, text }) {
  if (!isConfigured()) {
    throw new SmsError(STATUS.AUTH_FAILED, 'SMS gateway is not configured');
  }

  const params = new URLSearchParams({
    apikey: env.SMS_API_KEY,
    senderid: env.SMS_SENDER_ID,
    msisdn: toLocalBd(phoneE164),
    msg: text,
    type: 'text',
  });

  // smsformat 8 is the gateway flag for Unicode, without which Bengali arrives
  // as question marks.
  if (needsUnicode(text)) params.set('smsformat', '8');

  const response = await fetch(env.SMS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new SmsError(-1, `SMS gateway returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const first = Array.isArray(payload.response) ? payload.response[0] : payload.response;

  if (!first || first.status !== STATUS.SUCCESS) {
    const code = first ? first.status : -1;
    throw new SmsError(code, describeStatus(code));
  }

  return { id: first.id, segments: segmentCount(text) };
}

function describeStatus(code) {
  switch (code) {
    case STATUS.AUTH_FAILED:
      return 'SMS gateway authentication failed';
    case STATUS.BAD_API_KEY:
      return 'SMS gateway rejected the API key';
    case STATUS.INSUFFICIENT_BALANCE:
      return 'SMS gateway account has no balance left';
    default:
      return `SMS gateway returned status ${code}`;
  }
}

/** Gateway account balance, so the owner can be warned before sending fails. */
async function checkBalance() {
  if (!isConfigured()) return null;

  const url = `${env.SMS_BALANCE_URL}?api_key=${encodeURIComponent(env.SMS_API_KEY)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new SmsError(-1, `Balance check returned HTTP ${response.status}`);

  const payload = await response.json();
  return Number(payload.response);
}

module.exports = {
  STATUS,
  SmsError,
  isConfigured,
  needsUnicode,
  segmentCount,
  send,
  checkBalance,
  describeStatus,
};
