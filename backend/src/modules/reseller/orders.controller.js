'use strict';

const Order = require('../../models/Order');
const orderService = require('../../services/orderService');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { normalizeBdPhone } = require('../../utils/phone');
const { orderSearchFilter } = require('../../utils/orderSearch');
const { businessDate } = require('../../utils/dhakaTime');
const { toMilli } = require('../../utils/quantity');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const { availableActions } = require('../../domain/orderStateMachine');
const { ROLES } = require('../../domain/constants');

async function listOrders(req, res) {
  const { status, q, page, limit } = req.query;
  const filter = { reseller: req.reseller._id };
  if (status) filter.status = status;

  const search = orderSearchFilter(q);
  if (search) Object.assign(filter, search);

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments(filter),
  ]);

  return ok(res, {
    orders: orders.map((o) => ({
      ...present.order(o),
      actions: availableActions(o, ROLES.RESELLER),
    })),
    page,
    limit,
    total,
  });
}

async function getOrder(req, res) {
  const order = await Order.findOne({ _id: req.params.id, reseller: req.reseller._id });
  if (!order) throw notFound('Order not found');

  return ok(res, {
    order: { ...present.order(order), actions: availableActions(order, ROLES.RESELLER) },
  });
}

/**
 * The moment money moves. Prices arrive as taka and quantities as decimals, and
 * both are converted here before anything downstream sees them.
 */
async function confirmOrder(req, res) {
  const overrides = (req.body.items || []).map((item) => ({
    product: item.product,
    ...(item.quantity != null ? { qtyMilli: toMilli(item.quantity) } : {}),
    ...(item.sellPrice != null ? { sellPricePoisha: toPoisha(item.sellPrice, 'sellPrice') } : {}),
  }));

  const order = await orderService.confirmOrder({
    orderId: req.params.id,
    resellerProfile: req.reseller,
    actorUser: req.user,
    itemOverrides: overrides,
    paymentMode: req.body.paymentMode,
  });

  return ok(res, { order: present.order(order) });
}

/** A customer who phoned instead of using the form. Starts at confirmed. */
async function createManualOrder(req, res) {
  const { customer, items, paymentMode } = req.body;

  const order = await orderService.createManualOrder({
    resellerProfile: req.reseller,
    actorUser: req.user,
    paymentMode,
    customer: {
      name: customer.name,
      phoneE164: normalizeBdPhone(customer.phone, 'customer.phone'),
      altPhoneE164: customer.altPhone
        ? normalizeBdPhone(customer.altPhone, 'customer.altPhone')
        : undefined,
      address: customer.address,
      district: customer.district,
      note: customer.note,
    },
    items: items.map((i) => ({
      product: i.product,
      qtyMilli: toMilli(i.quantity),
      ...(i.sellPrice != null ? { sellPricePoisha: toPoisha(i.sellPrice, 'sellPrice') } : {}),
    })),
  });

  return ok(res, { order: present.order(order) }, 201);
}

async function cancelOrder(req, res) {
  const order = await orderService.transitionOrder({
    orderId: req.params.id,
    action: 'cancel',
    actorUser: req.user,
    role: ROLES.RESELLER,
    resellerProfile: req.reseller,
    payload: { reason: req.body.reason },
  });

  return ok(res, { order: present.order(order) });
}

/**
 * The reseller's own last N business days, for the dashboard chart.
 *
 * Grouped on the denormalised `businessDate` string rather than on `createdAt`,
 * so this is an index scan over { reseller: 1, businessDate: 1 } and never has
 * to reason about where a Dhaka day falls in UTC. Cancelled orders are left out,
 * because the chart is about what the reseller actually earned.
 *
 * Empty days are filled with zeroes here rather than in the browser: a series
 * with holes in it draws a chart that lies about its own shape.
 */
async function dailyStats(req, res) {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 31);

  const dates = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    dates.push(businessDate(new Date(Date.now() - back * 86_400_000)));
  }

  const rows = await Order.aggregate([
    {
      $match: {
        reseller: req.reseller._id,
        businessDate: { $gte: dates[0] },
        status: { $ne: 'cancelled' },
      },
    },
    {
      $group: {
        _id: '$businessDate',
        orders: { $sum: 1 },
        marginPoisha: { $sum: '$totals.resellerMarginPoisha' },
      },
    },
  ]);

  const byDate = new Map(rows.map((row) => [row._id, row]));

  return ok(res, {
    days: dates.map((date) => {
      const row = byDate.get(date);
      return {
        date,
        orders: row ? row.orders : 0,
        margin: row ? toTaka(row.marginPoisha) : 0,
      };
    }),
  });
}

module.exports = {
  listOrders,
  dailyStats,
  getOrder,
  confirmOrder,
  createManualOrder,
  cancelOrder,
};
