'use strict';

const { logger } = require('../config/logger');
const env = require('../config/env');
const gateway = require('../channels/sms');

/**
 * Whether the SMS gateway works, for the dashboard's health row.
 *
 * The row used to read the master switch, which is the owner's choice about
 * reseller-paid SMS (docs/adr/0013) and says nothing about whether a message
 * would go out: an owner who had deliberately switched it off saw a fault, and
 * a gateway with an empty account showed none. This asks the gateway instead.
 *
 * - `not_configured` — no credentials, so nothing owner-paid can go either;
 * - `error`          — the balance check failed or timed out;
 * - `ok`             — the gateway answered.
 *
 * The dashboard is polled every minute and the gateway is a third party, so the
 * answer is kept for a few minutes and the check never waits long or throws.
 */

const CACHE_MS = 3 * 60 * 1000;
const TIMEOUT_MS = 5000;

let cached = null;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      t.unref();
    }),
  ]);

/**
 * @returns {Promise<{ smsGateway: 'ok'|'not_configured'|'error',
 *   smsBalance: number|null, smsBalanceLow: boolean }>}
 */
async function gatewayHealth({ now = Date.now() } = {}) {
  if (!gateway.isConfigured()) {
    return { smsGateway: 'not_configured', smsBalance: null, smsBalanceLow: false };
  }
  if (cached && cached.until > now) return cached.value;

  let value;
  try {
    const balance = await withTimeout(Promise.resolve(gateway.checkBalance()), TIMEOUT_MS);
    value = {
      smsGateway: 'ok',
      smsBalance: balance,
      // The same threshold the morning digest warns at.
      smsBalanceLow: balance != null && balance < env.SMS_LOW_BALANCE,
    };
  } catch (err) {
    logger.warn({ err }, 'smsHealth: balance check failed');
    value = { smsGateway: 'error', smsBalance: null, smsBalanceLow: false };
  }

  cached = { value, until: now + CACHE_MS };
  return value;
}

/** Forgets the cached answer. For tests, and for after the credentials change. */
function clearCache() {
  cached = null;
}

module.exports = { gatewayHealth, clearCache };
