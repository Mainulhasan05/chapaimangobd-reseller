'use strict';

const Order = require('../../models/Order');
const { orderSearchFilter } = require('../../utils/orderSearch');
const orderService = require('../../services/orderService');
const { getSettings } = require('../../services/settings');
const audit = require('../../services/audit');
const { editCustomer } = require('../shared/orderCustomer.controller');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
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
        // Only `return` reads this: whether the parcel goes back on the shelf.
        restock: req.body.restock === true,
      },
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

    return ok(res, { order: present.order(order) });
  };
}

/**
 * The zone charge is a default, not a rule. Editable until the order ships; once
 * the wallet has been debited the difference posts as its own ledger entry, and
 * the original debit is never touched. See docs/adr/0010.
 */
async function overrideDeliveryCharge(req, res) {
  const deliveryChargePoisha = toPoisha(req.body.deliveryCharge, 'deliveryCharge');

  const { order, beforePoisha, entry } = await orderService.changeDeliveryCharge({
    orderId: req.params.id,
    deliveryChargePoisha,
    actorUser: req.user,
  });

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

  return ok(res, {
    order: { ...present.order(order), actions: availableActions(order, ROLES.OWNER) },
    adjustment: entry ? present.ledgerEntry(entry) : null,
  });
}

module.exports = {
  listOrders,
  getOrder,
  overrideDeliveryCharge,
  editCustomer: editCustomer(ROLES.OWNER),
  accept: transition('accept'),
  pack: transition('pack'),
  ship: transition('ship'),
  deliver: transition('deliver'),
  cancel: transition('cancel'),
  markReturned: transition('return'),
};
