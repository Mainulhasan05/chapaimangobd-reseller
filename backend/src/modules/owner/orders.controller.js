'use strict';

const Order = require('../../models/Order');
const { buildOrderFilter } = require('../../utils/orderFilter');
const orderService = require('../../services/orderService');
const customerSms = require('../../services/customerSms');
const { getSettings } = require('../../services/settings');
const audit = require('../../services/audit');
const { editCustomer } = require('../shared/orderCustomer.controller');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const { availableActions, assertDeliveryChargeEditable } = require('../../domain/orderStateMachine');
const { ROLES, ORDER_STATUS } = require('../../domain/constants');

/**
 * The filter for this request. Aging is the only one that has to ask the
 * database anything, so the settings read is skipped unless it is on.
 */
async function filterFor(query) {
  const agingHours = query.aging ? (await getSettings()).orderAgingHours : undefined;
  return buildOrderFilter(query, { agingHours });
}

async function listOrders(req, res) {
  const { page, limit } = req.query;
  const filter = await filterFor(req.query);

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('reseller', 'shopName slug'),
    Order.countDocuments(filter),
  ]);

  return ok(res, {
    orders: orders.map((o) => ({
      ...present.order(o),
      actions: availableActions(o, ROLES.OWNER),
    })),
    page,
    limit,
    total,
  });
}

/**
 * The counts and the money for exactly the orders the list is showing.
 *
 * These used to be read off the dashboard report, which groups the whole
 * collection with no date filter at all. That was defensible while the only
 * filter was a status, and became wrong the moment a date range existed: the
 * chip said "delivered 4,312" above a list of nine. A tab that promises a
 * number has to promise the number you get when you press it.
 *
 * Cancelled and returned orders are counted but kept out of the money, because
 * the owner never billed for them; `byStatus` is where they are accounted for.
 */
async function ordersSummary(req, res) {
  // Status is what the tabs choose between, so the counts must span all of them.
  const { status, aging, ...rest } = req.query;
  const filter = await filterFor(rest);

  const [counts, money, agingCount] = await Promise.all([
    Order.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([
      {
        $match: {
          ...filter,
          status: { $nin: [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          // What the owner billed: goods at cost price plus the delivery charge.
          ownerRevenuePoisha: { $sum: '$totals.walletDebitPoisha' },
          goodsPoisha: { $sum: '$totals.costSubtotalPoisha' },
          deliveryPoisha: { $sum: '$deliveryChargePoisha' },
          // What the customers pay, which is the other number in every
          // conversation about a day's trading.
          customerPoisha: { $sum: '$totals.customerTotalPoisha' },
          resellerMarginPoisha: { $sum: '$totals.resellerMarginPoisha' },
        },
      },
    ]),
    /*
     * The aging tile counts stale confirmed orders within the same dates. It is
     * its own query rather than a slice of `byStatus` because aging is a
     * wall-clock age and the statuses are a calendar filter: one cannot be read
     * off the other, and the tile beside them has to mean what it says.
     */
    Order.countDocuments(await filterFor({ ...rest, aging: true })),
  ]);

  const totals = money[0] || {};

  return ok(res, {
    byStatus: Object.fromEntries(counts.map((row) => [row._id, row.count])),
    total: counts.reduce((sum, row) => sum + row.count, 0),
    aging: agingCount,
    money: {
      orders: totals.orders || 0,
      ownerRevenue: toTaka(totals.ownerRevenuePoisha || 0),
      goods: toTaka(totals.goodsPoisha || 0),
      delivery: toTaka(totals.deliveryPoisha || 0),
      customerTotal: toTaka(totals.customerPoisha || 0),
      resellerMargin: toTaka(totals.resellerMarginPoisha || 0),
    },
  });
}

async function getOrder(req, res) {
  const order = await Order.findById(req.params.id).populate('reseller', 'shopName slug');
  if (!order) throw notFound('Order not found');

  return ok(res, { order: present.orderFor(order, ROLES.OWNER) });
}

/**
 * Every lifecycle change goes through the transition table. Which entries post
 * and whether stock comes back are properties of the transition, not of this
 * handler, so nothing here compares a status by hand.
 */
function transition(action) {
  return async function handle(req, res) {
    const order = await orderService.transitionOrder({
      orderId: req.params.id,
      action,
      actorUser: req.user,
      role: ROLES.OWNER,
      payload: {
        reason: req.body.reason,
        note: req.body.note,
        courierName: req.body.courierName,
        trackingNumber: req.body.trackingNumber,
        // Which orchard each line comes from. Only `accept` asks for these, and
        // the transition table is what says so.
        sources: req.body.sources,
        // Only `return` reads this: whether the parcel goes back on the shelf.
        restock: req.body.restock === true,
      },
      // Only accept, ship and cancel carry the box; see schema and docs/adr/0013.
      sendCustomerSms: req.body.sendCustomerSms === true,
    });

    if (action === 'cancel' || action === 'return') {
      const after = { status: order.status, reason: req.body.reason };
      if (action === 'return') after.restocked = order.restockedOnReturn;

      await audit.record({
        actor: req.user._id,
        action: `order.${action}`,
        targetType: 'Order',
        targetId: order._id,
        after,
        ip: req.ip,
      });
    }

    // The same shape as GET /orders/:id, reseller and actions included, so the
    // order screen can take the response as its new copy without a refetch.
    await order.populate('reseller', 'shopName slug');
    return ok(res, { order: present.orderFor(order, ROLES.OWNER) });
  };
}

/**
 * What the customer would be sent, before the owner commits to sending it.
 *
 * Rendered by the same function the transition uses, from the same inputs, so
 * the text shown in the modal is the text that is queued. `available: false`
 * when there is no gateway, which the modal turns into a disabled switch.
 */
async function customerSmsPreview(req, res) {
  const { action, courier, trackingId, reason } = req.query;
  const order = await Order.findById(req.params.id);
  if (!order) throw notFound('Order not found');

  const available = customerSms.isAvailable();
  const preview = await customerSms.buildCustomerSms({
    order,
    action,
    courierName: courier,
    trackingNumber: trackingId,
    reason,
  });

  return ok(res, { ...preview, available });
}

/**
 * The zone charge is a default, not a rule. Editable until the order ships; once
 * the wallet has been debited the difference posts as its own ledger entry, and
 * the original debit is never touched. See docs/adr/0010.
 *
 * Answers with the order exactly as GET /orders/:id does, reseller included, so
 * the order screen can take the response as its new copy.
 */
async function overrideDeliveryCharge(req, res) {
  const deliveryChargePoisha = toPoisha(req.body.deliveryCharge, 'deliveryCharge');

  let result;
  try {
    result = await orderService.changeDeliveryCharge({
      orderId: req.params.id,
      deliveryChargePoisha,
      actorUser: req.user,
    });
  } catch (err) {
    /*
     * Lost a race. If what won was the parcel leaving, the honest answer is
     * that the charge is now locked, which the screen explains, rather than a
     * generic "someone changed this" that invites a pointless retry.
     */
    if (err && err.code === 'ALREADY_HANDLED') {
      const now = await Order.findById(req.params.id).select('status');
      if (now) assertDeliveryChargeEditable(now);
    }
    throw err;
  }
  const { order, beforePoisha, entry } = result;

  if (beforePoisha !== deliveryChargePoisha) {
    await audit.record({
      actor: req.user._id,
      action: 'order.delivery_charge',
      targetType: 'Order',
      targetId: order._id,
      before: { deliveryChargePoisha: beforePoisha, status: order.status },
      after: {
        deliveryChargePoisha,
        ledgerEntry: entry ? entry._id : null,
        adjustmentPoisha: entry ? entry.amountPoisha : 0,
      },
      ip: req.ip,
    });
  }

  await order.populate('reseller', 'shopName slug');

  return ok(res, {
    order: present.orderFor(order, ROLES.OWNER),
    adjustment: entry ? present.ledgerEntry(entry) : null,
  });
}

module.exports = {
  listOrders,
  ordersSummary,
  getOrder,
  customerSmsPreview,
  overrideDeliveryCharge,
  editCustomer: editCustomer(ROLES.OWNER),
  accept: transition('accept'),
  pack: transition('pack'),
  ship: transition('ship'),
  deliver: transition('deliver'),
  cancel: transition('cancel'),
  markReturned: transition('return'),
};
