'use strict';

const env = require('../config/env');
const { logger } = require('../config/logger');
const Order = require('../models/Order');
const ResellerProfile = require('../models/ResellerProfile');
const User = require('../models/User');
const Notification = require('../models/Notification');
const smsService = require('../services/sms');
const outbox = require('../services/outbox');
const { getSettings } = require('../services/settings');
const { notify } = require('../services/notify');
const { notifyOwnersOnce } = require('./owners');
const { businessDate } = require('../utils/dhakaTime');
const { EVENT_TYPE, ORDER_STATUS, ROLES } = require('../domain/constants');

/**
 * 09:00 Dhaka. One morning notification to the owner listing what needs a
 * decision today, and a warning to each reseller close to their credit limit.
 * A morning with nothing to report sends nothing.
 */

const HOUR_MS = 60 * 60 * 1000;
const CODES_IN_ALERT = 10;
const SHOPS_IN_ALERT = 5;
const SMS_BALANCE_TIMEOUT_MS = 10 * 1000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      t.unref();
    }),
  ]);

/**
 * Confirmed and waiting longer than the owner's threshold. Aging is a wall-clock
 * delta, not a calendar day: an order confirmed at 23:50 is not a day old at
 * 00:10.
 */
async function agingOrders(now, hours) {
  const filter = {
    status: ORDER_STATUS.CONFIRMED,
    confirmedAt: { $lt: new Date(now.getTime() - hours * HOUR_MS) },
  };
  const [count, oldest] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter, { orderCode: 1 }).sort({ confirmedAt: 1 }).limit(CODES_IN_ALERT).lean(),
  ]);
  return { count, codes: oldest.map((o) => o.orderCode) };
}

/**
 * Resellers whose headroom (balance plus credit limit) is at most a tenth of the
 * limit, which includes anyone already past it. Integer arithmetic, because
 * these are poisha. A reseller with no ledger history is skipped: a new shop at
 * zero balance and zero limit is not in trouble, it just has not started.
 */
async function nearLimitResellers() {
  const profiles = await ResellerProfile.find(
    {
      ledgerSeq: { $gt: 0 },
      $expr: {
        $lte: [
          { $multiply: [10, { $add: ['$balancePoisha', '$creditLimitPoisha'] }] },
          '$creditLimitPoisha',
        ],
      },
    },
    { user: 1, shopName: 1, slug: 1, balancePoisha: 1, creditLimitPoisha: 1 }
  ).lean();

  if (profiles.length === 0) return [];

  const users = await User.find({
    _id: { $in: profiles.map((p) => p.user) },
    role: ROLES.RESELLER,
    isActive: { $ne: false },
  });
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return profiles.filter((p) => byId.has(String(p.user))).map((p) => ({ profile: p, user: byId.get(String(p.user)) }));
}

/** The gateway's balance, or null when unknown. Never throws, never hangs. */
async function smsBalance() {
  try {
    return await withTimeout(Promise.resolve(smsService.balance()), SMS_BALANCE_TIMEOUT_MS);
  } catch (err) {
    logger.warn({ err }, 'digest: sms balance check failed');
    return null;
  }
}

async function dailyDigest({ now = new Date() } = {}) {
  const dayKey = businessDate(now);
  const settings = await getSettings({ fresh: true });
  const agingHours = settings.orderAgingHours || 24;

  const [aging, nearLimit, dead, balance] = await Promise.all([
    agingOrders(now, agingHours),
    nearLimitResellers(),
    outbox.deadLetterCounts({ since: new Date(now.getTime() - 24 * HOUR_MS) }),
    smsBalance(),
  ]);

  // Each reseller hears about it once per Dhaka day, however often this runs.
  let resellersWarned = 0;
  for (const { profile, user } of nearLimit) {
    // eslint-disable-next-line no-await-in-loop
    const already = await Notification.exists({
      user: user._id,
      eventType: EVENT_TYPE.BALANCE_NEAR_LIMIT,
      'data.dayKey': dayKey,
    });
    if (already) continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    const created = await notify({
      user,
      eventType: EVENT_TYPE.BALANCE_NEAR_LIMIT,
      data: {
        balancePoisha: profile.balancePoisha,
        creditLimitPoisha: profile.creditLimitPoisha,
        dayKey,
      },
    });
    if (created) resellersWarned += 1;
  }

  const smsLow = balance != null && balance < env.SMS_LOW_BALANCE;
  const deadLetters = dead.recent || 0;

  const data = {
    agingCount: aging.count,
    agingHours,
    agingCodes: aging.codes,
    nearLimitCount: nearLimit.length,
    nearLimitShops: nearLimit.slice(0, SHOPS_IN_ALERT).map(({ profile }) => profile.shopName || profile.slug),
    deadLetters,
    deadLettersTotal: dead.total,
    smsBalance: balance,
    smsLow,
  };

  const worthSending = aging.count > 0 || nearLimit.length > 0 || deadLetters > 0 || smsLow;
  const ownersAlerted = worthSending
    ? await notifyOwnersOnce({ eventType: EVENT_TYPE.ALERT_DAILY_DIGEST, dayKey, data })
    : 0;

  return { dayKey, ...data, resellersWarned, ownersAlerted };
}

module.exports = { dailyDigest };
