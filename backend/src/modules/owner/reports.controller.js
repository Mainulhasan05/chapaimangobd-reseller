'use strict';

const Order = require('../../models/Order');
const LedgerEntry = require('../../models/LedgerEntry');
const ResellerProfile = require('../../models/ResellerProfile');
const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');

const { getSettings } = require('../../services/settings');
const { ok } = require('../../middleware/error');
const { toTaka } = require('../../utils/money');
const { fromMilli } = require('../../utils/quantity');
const {
  businessDate,
  startOfBusinessDay,
  endOfBusinessDay,
  agingCutoff,
  formatDhakaDateTime,
  TZ,
} = require('../../utils/dhakaTime');
const { streamCsv, trustedFormula } = require('../../utils/csv');
const { ORDER_STATUS, REVIEW_STATUS } = require('../../domain/constants');

/**
 * The two numbers that actually protect the business are total receivable and
 * how many confirmed orders are going stale. Everything else is context.
 */
async function dashboard(_req, res) {
  const settings = await getSettings();
  const today = businessDate();

  const [statusCounts, todayCount, aging, owed, pendingDeposits, pendingWithdrawals] =
    await Promise.all([
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Order.countDocuments({ businessDate: today }),
      Order.countDocuments({
        status: ORDER_STATUS.CONFIRMED,
        confirmedAt: { $lt: agingCutoff(settings.orderAgingHours) },
      }),
      ResellerProfile.aggregate([
        { $match: { balancePoisha: { $lt: 0 } } },
        { $group: { _id: null, total: { $sum: '$balancePoisha' } } },
      ]),
      Deposit.countDocuments({ status: REVIEW_STATUS.PENDING }),
      Withdrawal.countDocuments({ status: REVIEW_STATUS.PENDING }),
    ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));

  return ok(res, {
    today,
    ordersToday: todayCount,
    byStatus,
    awaitingAcceptance: byStatus[ORDER_STATUS.CONFIRMED] || 0,
    agingOrders: aging,
    agingThresholdHours: settings.orderAgingHours,
    totalReceivable: toTaka(owed.length ? Math.abs(owed[0].total) : 0),
    pendingDeposits,
    pendingWithdrawals,
  });
}

/** Quantity sold per product over a Dhaka date range. */
async function productsSold(req, res) {
  const from = req.query.from || businessDate();
  const to = req.query.to || businessDate();

  const rows = await Order.aggregate([
    {
      $match: {
        status: { $nin: [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] },
        createdAt: { $gte: startOfBusinessDay(from), $lt: endOfBusinessDay(to) },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: { product: '$items.product', name: '$items.productNameBn', unit: '$items.unit' },
        qtyMilli: { $sum: '$items.qtyMilli' },
        revenuePoisha: { $sum: '$items.lineSellPoisha' },
        costPoisha: { $sum: '$items.lineCostPoisha' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { qtyMilli: -1 } },
  ]);

  return ok(res, {
    from,
    to,
    products: rows.map((r) => ({
      product: r._id.product,
      name: r._id.name,
      unit: r._id.unit,
      quantity: fromMilli(r.qtyMilli),
      revenue: toTaka(r.revenuePoisha),
      cost: toTaka(r.costPoisha),
      orders: r.orders,
    })),
  });
}

/** Orders per Dhaka calendar day. The timezone is explicit, never the server one. */
async function ordersByDay(req, res) {
  const from = req.query.from || businessDate();
  const to = req.query.to || businessDate();

  const rows = await Order.aggregate([
    { $match: { createdAt: { $gte: startOfBusinessDay(from), $lt: endOfBusinessDay(to) } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
        orders: { $sum: 1 },
        customerTotalPoisha: { $sum: '$totals.customerTotalPoisha' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return ok(res, {
    days: rows.map((r) => ({
      date: r._id,
      orders: r.orders,
      customerTotal: toTaka(r.customerTotalPoisha),
    })),
  });
}

/* ------------------------------------------------------------------- exports */

// Cell escaping, formula-injection defence and the streaming itself live in
// utils/csv.js.

async function exportOrders(req, res) {
  const filter = {};
  if (req.query.status) filter.status = { $in: req.query.status.split(',') };
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = startOfBusinessDay(req.query.from);
    if (req.query.to) filter.createdAt.$lt = endOfBusinessDay(req.query.to);
  }

  const headers = [
    'Order Code',
    'Date',
    'Status',
    'Payment Mode',
    'Shop',
    'Customer',
    'Phone',
    'District',
    'Items',
    'Cost Subtotal',
    'Sell Subtotal',
    'Delivery',
    'Customer Total',
    'Wallet Debit',
  ];

  const cursor = Order.find(filter)
    .sort({ createdAt: -1 })
    .populate('reseller', 'shopName')
    .cursor();

  const toRow = (order) => {
    const items = order.items
      .map((i) => `${i.productNameBn} x ${fromMilli(i.qtyMilli)}${i.unit}`)
      .join(' | ');

    return [
      order.orderCode,
      order.businessDate,
      order.status,
      order.paymentMode,
      order.reseller ? order.reseller.shopName : '',
      order.customer.name,
      // Quoted so Excel keeps the leading zero on a Bangladeshi mobile number.
      trustedFormula(`="${order.customer.phoneE164}"`),
      order.customer.district,
      items,
      toTaka(order.totals.costSubtotalPoisha),
      toTaka(order.totals.sellSubtotalPoisha),
      toTaka(order.deliveryChargePoisha),
      toTaka(order.totals.customerTotalPoisha),
      toTaka(order.totals.walletDebitPoisha),
    ];
  };

  await streamCsv(req, res, { filename: 'orders.csv', headers, cursor, toRow });
}

async function exportLedger(req, res) {
  const filter = {};
  if (req.query.reseller) filter.reseller = req.query.reseller;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = startOfBusinessDay(req.query.from);
    if (req.query.to) filter.createdAt.$lt = endOfBusinessDay(req.query.to);
  }

  const headers = [
    'Seq',
    'Date',
    'Shop',
    'Kind',
    'Amount',
    'Balance After',
    'Reference',
    'Note',
  ];

  const cursor = LedgerEntry.find(filter)
    .sort({ createdAt: 1 })
    .populate('reseller', 'shopName')
    .cursor();

  const toRow = (entry) => [
    entry.seq,
    // Dhaka wall-clock time. UTC put every early-morning entry on the day before.
    formatDhakaDateTime(entry.createdAt),
    entry.reseller && entry.reseller.shopName ? entry.reseller.shopName : '',
    entry.kind,
    toTaka(entry.amountPoisha),
    toTaka(entry.balanceAfterPoisha),
    `${entry.refType}:${entry.refId || ''}`,
    entry.note,
  ];

  await streamCsv(req, res, { filename: 'ledger.csv', headers, cursor, toRow });
}

module.exports = { dashboard, productsSold, ordersByDay, exportOrders, exportLedger };
