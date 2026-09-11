'use strict';

const Order = require('../../models/Order');
const present = require('../../utils/present');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { escapeRegex } = require('../../utils/orderSearch');
const { toTaka } = require('../../utils/money');
const { normalizeBdPhone } = require('../../utils/phone');
const { ORDER_STATUS } = require('../../domain/constants');

/**
 * A reseller's own customers.
 *
 * Deliberately computed from this reseller's orders rather than read off the
 * shared customer record. That record knows every shop a number has bought
 * from and what it spent at each, and one reseller has no business learning
 * what a buyer spends with another: it is their competitor's sales figures.
 *
 * So the shape matches the owner's and the numbers do not. A buyer who has
 * ordered twelve times across three shops shows as four orders here, because
 * four is how many times they ordered from this one.
 */

/** Counts a reseller's own orders for each buyer. Phone is the identity. */
const summaryStages = (resellerId, extraMatch = {}) => [
  { $match: { reseller: resellerId, ...extraMatch } },
  { $sort: { createdAt: -1 } },
  {
    $group: {
      _id: '$customer.phoneE164',
      // The name from the most recent order, since the sort above put it first.
      latestName: { $first: '$customer.name' },
      latestAddress: { $first: '$customer.address' },
      names: { $addToSet: '$customer.name' },
      addresses: { $addToSet: '$customer.address' },
      orderCount: { $sum: 1 },
      deliveredCount: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.DELIVERED] }, 1, 0] } },
      cancelledCount: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.CANCELLED] }, 1, 0] } },
      returnedCount: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.RETURNED] }, 1, 0] } },
      totalSpendPoisha: {
        $sum: {
          $cond: [
            { $eq: ['$status', ORDER_STATUS.DELIVERED] },
            '$totals.customerTotalPoisha',
            0,
          ],
        },
      },
      firstOrderAt: { $min: '$createdAt' },
      lastOrderAt: { $max: '$createdAt' },
    },
  },
];

const shape = (row) => ({
  // The phone is the identity, so it is also the handle the detail route takes.
  id: row._id,
  phone: row._id,
  name: row.latestName,
  names: row.names,
  addresses: row.addresses,
  latestAddress: row.latestAddress,
  orderCount: row.orderCount,
  deliveredCount: row.deliveredCount,
  cancelledCount: row.cancelledCount,
  returnedCount: row.returnedCount,
  totalSpend: toTaka(row.totalSpendPoisha),
  firstOrderAt: row.firstOrderAt,
  lastOrderAt: row.lastOrderAt,
});

async function listCustomers(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const term = (req.query.q || '').trim();

  /*
   * Filtered before the grouping, so the index on reseller and the one on the
   * phone both still apply. Matching after the group would mean grouping every
   * order this reseller has ever taken in order to throw most of it away.
   */
  const extra = {};
  if (term) {
    const escaped = escapeRegex(term);
    const or = [{ 'customer.name': new RegExp(escaped, 'i') }];
    const digits = term.replace(/\D/g, '');
    if (digits.length >= 4) {
      or.push({ 'customer.phoneE164': new RegExp(`${escapeRegex(digits)}$`) });
    }
    extra.$or = or;
  }

  const [rows] = await Order.aggregate([
    ...summaryStages(req.reseller._id, extra),
    { $sort: { lastOrderAt: -1 } },
    {
      // Count and page in one pass. A separate count would run the whole
      // grouping a second time.
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'value' }],
      },
    },
  ]);

  return ok(res, {
    customers: (rows?.items || []).map(shape),
    total: rows?.total?.[0]?.value || 0,
    page,
    limit,
  });
}

/**
 * One buyer, and every order they placed with this reseller.
 *
 * Addressed by phone rather than by an id, because the reseller's view has no
 * customer document behind it: it is an aggregation over their own orders, and
 * the number is the only stable handle there is.
 */
async function getCustomer(req, res) {
  // Normalised, so a reseller can paste 01712345678 from a chat and still land
  // on the right buyer. An unparseable number is a 400 rather than an empty page.
  const phoneE164 = normalizeBdPhone(req.params.phone, 'phone');

  const [summary] = await Order.aggregate(
    summaryStages(req.reseller._id, { 'customer.phoneE164': phoneE164 })
  );
  if (!summary) throw notFound('Customer not found');

  const orders = await Order.find({
    reseller: req.reseller._id,
    'customer.phoneE164': phoneE164,
  })
    .sort({ createdAt: -1 })
    .limit(50);

  return ok(res, { customer: shape(summary), orders: orders.map(present.order) });
}

module.exports = { listCustomers, getCustomer };
