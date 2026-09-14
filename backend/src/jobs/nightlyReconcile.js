'use strict';

const ledger = require('../services/ledger');
const ResellerProfile = require('../models/ResellerProfile');
const { notifyOwnersOnce } = require('./owners');
const { businessDate } = require('../utils/dhakaTime');
const { EVENT_TYPE } = require('../domain/constants');

/**
 * 02:00 Dhaka. Replays every wallet's ledger against its denormalised balance
 * and tells the owner, in-app and on Telegram, about any that disagree.
 *
 * The ledger service owns the checking; this job owns only the schedule and the
 * alert. See docs/adr/0002 for why a drift is worth waking someone for.
 */

const SHOPS_IN_ALERT = 5;

/**
 * reconcileAll's result, whatever shape it takes. It has returned
 * `{ checked, drifted: [result] }`; a batched version may return a count and a
 * list of ids instead. Reading it defensively keeps the alert working through
 * that change.
 */
function summarise(result) {
  if (Array.isArray(result)) {
    const drifted = result.filter((r) => r && r.ok === false);
    return { checked: result.length, driftedIds: drifted.map((r) => r.reseller) };
  }

  const r = result || {};
  let driftedIds = [];
  if (Array.isArray(r.drifted)) {
    driftedIds = r.drifted.map((d) => (d && d.reseller !== undefined ? d.reseller : d));
  } else if (Array.isArray(r.driftedIds)) {
    driftedIds = r.driftedIds;
  } else if (Array.isArray(r.results)) {
    driftedIds = r.results.filter((x) => x && x.ok === false).map((x) => x.reseller);
  }

  let driftedCount = driftedIds.length;
  if (typeof r.drifted === 'number') driftedCount = r.drifted;
  else if (typeof r.driftedCount === 'number') driftedCount = r.driftedCount;

  return {
    checked: typeof r.checked === 'number' ? r.checked : null,
    driftedIds: driftedIds.filter(Boolean),
    driftedCount,
  };
}

async function nightlyReconcile({ now = new Date() } = {}) {
  const summary = summarise(await ledger.reconcileAll());
  const driftedCount = summary.driftedCount != null ? summary.driftedCount : summary.driftedIds.length;

  if (driftedCount === 0) return { checked: summary.checked, driftedCount, alerted: 0 };

  const profiles = await ResellerProfile.find(
    { _id: { $in: summary.driftedIds.slice(0, SHOPS_IN_ALERT) } },
    { shopName: 1, slug: 1 }
  ).lean();

  const alerted = await notifyOwnersOnce({
    eventType: EVENT_TYPE.ALERT_LEDGER_DRIFT,
    dayKey: businessDate(now),
    data: {
      checked: summary.checked,
      driftedCount,
      shops: profiles.map((p) => p.shopName || p.slug),
      resellerIds: summary.driftedIds.map(String),
    },
  });

  return { checked: summary.checked, driftedCount, alerted };
}

module.exports = { nightlyReconcile, summarise };
