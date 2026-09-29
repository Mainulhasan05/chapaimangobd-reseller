'use strict';

const ledger = require('../services/ledger');
const payeeLedger = require('../services/payeeLedger');
const supplyStock = require('../services/supplyStock');
const ResellerProfile = require('../models/ResellerProfile');
const { notifyOwnersOnce } = require('./owners');
const { businessDate } = require('../utils/dhakaTime');
const { EVENT_TYPE } = require('../domain/constants');

/**
 * 02:00 Dhaka. Replays every append-only record in the system against the
 * denormalised figure beside it, and tells the owner, in-app and on Telegram,
 * about anything that disagrees.
 *
 * Three books, checked together because they fail the same way: a reseller
 * **wallet** against its `LedgerEntry` rows, a **payee** due against its
 * `PayeeLedgerEntry` rows, and a **supply** count against its `StockMovement`
 * rows. Each is an immutable log with a cached total, and a cache that has
 * drifted from its log is the one class of bug none of them can catch alone.
 *
 * One alert covers all three, because the owner's question is "do the books
 * balance", not "which of three subsystems is unhappy".
 *
 * The services own the checking; this job owns only the schedule and the alert.
 * See docs/adr/0002 and docs/adr/0025.
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

  /*
   * The cost side. Reconciled even when the wallets are clean, because a drifted
   * supply count is just as much a broken book as a drifted balance, and skipping
   * the check whenever the resellers happen to be fine would hide it for as long
   * as they stay fine.
   */
  const payees = await payeeLedger.reconcileAll();
  const supplies = await supplyStock.reconcileAll();
  const payeeDrift = payees.drifted.length;
  const supplyDrift = supplies.drifted.length;

  if (driftedCount === 0 && payeeDrift === 0 && supplyDrift === 0) {
    return {
      checked: summary.checked,
      driftedCount,
      payeesChecked: payees.checked,
      payeeDrift,
      suppliesChecked: supplies.checked,
      supplyDrift,
      alerted: 0,
    };
  }

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
      payeeDrift,
      payeeIds: payees.drifted.map((d) => String(d.payee)),
      supplyDrift,
      supplyIds: supplies.drifted.map((d) => String(d.supply)),
    },
  });

  return {
    checked: summary.checked,
    driftedCount,
    payeesChecked: payees.checked,
    payeeDrift,
    suppliesChecked: supplies.checked,
    supplyDrift,
    alerted,
  };
}

module.exports = { nightlyReconcile, summarise };
