'use strict';

const mongoose = require('mongoose');
const { PURCHASE_STATUS } = require('../domain/constants');

/**
 * The only place a cost-side query becomes a Mongo filter.
 *
 * The purchase list, the totals beside it, the printed purchase sheet and the
 * CSV all build from `purchaseFilter`; the expense screens from `expenseFilter`.
 * They used to build their own, and the sheet answered a different question from
 * the screen it was printed from: the list honoured the seller filter and the
 * report did not. One builder means they cannot disagree about which rows a
 * screen is showing — the same rule `utils/orderFilter.js` sets for orders.
 *
 * Dates match the indexed `businessDate` string, never `createdAt`. Ids are cast
 * here rather than left as strings, because the totals and the reports run these
 * through `aggregate`, which unlike `find` casts nothing: a string id in a
 * `$match` matches no document at all, and the total reads as zero.
 */

const id = (value) => new mongoose.Types.ObjectId(String(value));

const dateClause = (from, to) => {
  if (!from && !to) return null;
  const businessDate = {};
  if (from) businessDate.$gte = from;
  if (to) businessDate.$lte = to;
  return businessDate;
};

/** Which purchases a screen is showing. Cancelled ones included unless excluded. */
function purchaseFilter({ payeeId, supplyId, status, from, to } = {}) {
  const filter = {};
  if (payeeId) filter.payee = id(payeeId);
  if (supplyId) filter['lines.supply'] = id(supplyId);
  if (status) filter.status = status;
  const businessDate = dateClause(from, to);
  if (businessDate) filter.businessDate = businessDate;
  return filter;
}

/**
 * The same purchases, less the cancelled ones: what a total is summed over.
 * A cancelled purchase is listed, because it happened and was undone, and never
 * counted, because it no longer cost anything.
 */
const countedPurchases = (query) => ({
  $and: [purchaseFilter(query), { status: { $ne: PURCHASE_STATUS.CANCELLED } }],
});

/**
 * Which expenses a screen is showing. Voided ones are kept for the audit trail
 * and left out unless asked for; a total never counts them whatever is asked.
 */
function expenseFilter(
  { categoryId, payeeId, orderId, scope, paymentStatus, includeVoided, from, to } = {}
) {
  const filter = {};
  if (categoryId) filter.category = id(categoryId);
  if (payeeId) filter.payee = id(payeeId);
  if (orderId) filter.order = id(orderId);
  if (scope) filter.scope = scope;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (includeVoided !== 'true' && includeVoided !== true) filter.voidedAt = null;
  const businessDate = dateClause(from, to);
  if (businessDate) filter.businessDate = businessDate;
  return filter;
}

/** The same expenses, never the voided ones: what a total is summed over. */
const countedExpenses = (query) => ({ ...expenseFilter(query), voidedAt: null });

module.exports = { purchaseFilter, countedPurchases, expenseFilter, countedExpenses };
