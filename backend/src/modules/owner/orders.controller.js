'use strict';

const Order = require('../../models/Order');
const { orderSearchFilter } = require('../../utils/orderSearch');
const orderService = require('../../services/orderService');
const { getSettings } = require('../../services/settings');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { notFound, conflict } = require('../../utils/errors');
const { toPoisha } = require('../../utils/money');
const { startOfBusinessDay, endOfBusinessDay, agingCutoff } = require('../../utils/dhakaTime');
const present = require('../../utils/present');
const { availableActions } = require('../../domain/orderStateMachine');
const { ROLES, ORDER_STATUS } = require('../../domain/constants');

async function listOrders(req, res) {
  const { status, reseller, q, from, to, aging, page, limit } = req.query;
  const filter = {};

  if (status) filter.status = { $in: status.split(',') };
  if (reseller) filter.reseller = reseller;

  // Date boundaries are Dhaka calendar days, resolved to UTC instants. Using the
  // server clock here would put the first six hours of every day on the wrong side.
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = startOfBusinessDay(from);
    if (to) filter.createdAt.$lt = endOfBusinessDay(to);
  }

  if (aging) {
    const settings = await getSettings();
    filter.status = ORDER_STATUS.CONFIRMED;
    filter.confirmedAt = { $lt: agingCutoff(settings.orderAgingHours) };
  }

  const search = orderSearchFilter(q);
  if (search) Object.assign(filter, search);

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

async function getOrder(req, res) {
  const order = await Order.findById(req.params.id).populate('reseller', 'shopName slug');
  if (!order) throw notFound('Order not found');

  return ok(res, {
    order: { ...present.order(order), actions: availableActions(order, ROLES.OWNER) },
  });
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
      },
    });

    if (action === 'cancel' || action === 'return') {
      await audit.record({
        actor: req.user._id,
        action: `order.${action}`,
        targetType: 'Order',
        targetId: order._id,
        after: { status: order.status, reason: req.body.reason },
        ip: req.ip,
      });
    }

    return ok(res, { order: present.order(order) });
  };
}

/**
 * The zone charge is a default, not a rule. Only adjustable before the wallet has
 * been debited, because afterwards the ledger entry and the order would disagree.
 */
async function overrideDeliveryCharge(req, res) {
  const deliveryChargePoisha = toPoisha(req.body.deliveryCharge, 'deliveryCharge');

  const order = await Order.findById(req.params.id);
  if (!order) throw notFound('Order not found');
  if (order.status !== ORDER_STATUS.PENDING) {
    throw conflict(
      'ALREADY_CHARGED',
      'The delivery charge can only be changed before the reseller confirms'
    );
  }

  order.deliveryChargePoisha = deliveryChargePoisha;
  order.totals.walletDebitPoisha = order.totals.costSubtotalPoisha + deliveryChargePoisha;
  order.totals.customerTotalPoisha = order.totals.sellSubtotalPoisha + deliveryChargePoisha;
  await order.save();

  await audit.record({
    actor: req.user._id,
    action: 'order.delivery_charge',
    targetType: 'Order',
    targetId: order._id,
    after: { deliveryChargePoisha },
    ip: req.ip,
  });

  return ok(res, { order: present.order(order) });
}

module.exports = {
  listOrders,
  getOrder,
  overrideDeliveryCharge,
  accept: transition('accept'),
  pack: transition('pack'),
  ship: transition('ship'),
  deliver: transition('deliver'),
  cancel: transition('cancel'),
  markReturned: transition('return'),
};
