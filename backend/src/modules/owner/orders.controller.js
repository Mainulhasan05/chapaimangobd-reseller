'use strict';

const Order = require('../../models/Order');
const { buildOwnerOrderFilter } = require('../../utils/orderFilter');
const orderService = require('../../services/orderService');
const customerSms = require('../../services/customerSms');
const { getSettings } = require('../../services/settings');
const audit = require('../../services/audit');
const { editCustomer } = require('../shared/orderCustomer.controller');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const packagingConsumption = require('../../services/packagingConsumption');
const costing = require('../../services/costing');
const { fromMilli } = require('../../utils/quantity');
const {
  assertDeliveryChargeEditable,
  assertCourierEditable,
} = require('../../domain/orderStateMachine');
const { ROLES, ORDER_STATUS } = require('../../domain/constants');

/**
 * The filter for this request. Aging is the only one that has to ask the
 * database anything, so the settings read is skipped unless it is on.
 */
async function filterFor(query) {
  const agingHours = query.aging ? (await getSettings()).orderAgingHours : undefined;
  return buildOwnerOrderFilter(query, { agingHours });
}

/**
 * One page of orders, oldest first.
 *
 * "Oldest" means the longest the owner has had it: confirmed first, because
 * that is when an order lands on the owner's desk, and created for an order
 * nobody has confirmed yet. Mongo cannot sort a find by an expression, so the
 * page is chosen by an aggregation and the documents are then read the normal
 * way, which keeps the populate and the presentation identical to the default
 * sort. The filter is cast first: an aggregation, unlike a find, does not turn
 * a reseller id string into an ObjectId.
 */
async function oldestFirstPage(filter, { skip, limit }) {
  const ids = await Order.aggregate([
    { $match: Order.where().cast(Order, filter) },
    { $addFields: { sortAt: { $ifNull: ['$confirmedAt', '$createdAt'] } } },
    { $sort: { sortAt: 1, _id: 1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]);
  const position = new Map(ids.map((row, i) => [String(row._id), i]));
  const docs = await Order.find({ _id: { $in: ids.map((row) => row._id) } }).populate(
    present.ownerResellerPopulate()
  );
  return docs.sort((a, b) => position.get(String(a._id)) - position.get(String(b._id)));
}

async function listOrders(req, res) {
  const { page, limit, sort } = req.query;
  const filter = await filterFor(req.query);
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    sort === 'oldest'
      ? oldestFirstPage(filter, { skip, limit })
      : Order.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .populate(present.ownerResellerPopulate()),
    Order.countDocuments(filter),
  ]);

  return ok(res, {
    orders: orders.map((o) => present.ownerOrder(o)),
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
 *
 * `status` narrows the money and nothing else. The tabs are a status filter, and
 * a money strip above the shipped tab that adds up every tab is a figure about
 * orders the owner is not looking at; but the counts on the tabs themselves
 * must still span every status, or each tab would show only its own number.
 */
async function ordersSummary(req, res) {
  const { status, aging, ...rest } = req.query;
  const filter = await filterFor(rest);

  const unbilled = [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED];
  const moneyStatus = status
    ? { $in: String(status).split(',').filter((s) => !unbilled.includes(s)) }
    : { $nin: unbilled };

  const [counts, money, agingCount] = await Promise.all([
    Order.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([
      {
        $match: { ...filter, status: moneyStatus },
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
  const order = await Order.findById(req.params.id).populate(present.ownerResellerPopulate());
  if (!order) throw notFound('Order not found');

  /*
   * What this parcel cost the owner and what it made: goods at cost, plus the
   * packaging consumed, plus the expenses filed against it.
   *
   * Beside the order rather than inside it, because none of it is a figure the
   * reseller is party to — `order.totals` is. See docs/adr/0027.
   */
  const cost = await costing.costForOrder(order);

  return ok(res, {
    order: present.ownerOrder(order),
    cost: {
      goods: toTaka(cost.goodsPoisha),
      packaging: toTaka(cost.packagingPoisha),
      expenses: toTaka(cost.expensePoisha),
      total: toTaka(cost.costPoisha),
      // What the owner billed the reseller: goods at cost plus delivery.
      revenue: toTaka(cost.revenuePoisha),
      margin: toTaka(cost.marginPoisha),
      /*
       * Billed for delivery, to hold against the courier expense below it. These
       * are two different numbers and the gap between them is the owner's margin
       * on delivery, which nothing in the app recorded before now.
       */
      deliveryCharged: toTaka(cost.deliveryChargePoisha),
      items: cost.expenses.map((e) => ({
        id: e._id,
        categoryNameBn: e.categoryNameBn,
        amount: toTaka(e.amountPoisha),
        paymentStatus: e.paymentStatus,
        payeeNameBn: e.payeeNameBn || null,
      })),
    },
  });
}

/**
 * What packing this order is expected to take, and what it would cost.
 *
 * Its own endpoint rather than part of the order response, because it reads the
 * live products and supplies and the order screen should not pay for that on
 * every poll. Shown from accept onwards, well before anything is deducted, so a
 * supply that has run out is visible while there is still time to buy more.
 *
 * Every figure is an estimate and says so: the recipe says "about one and a half
 * sheets" and nobody counted. `shortages` is information, never a refusal — a
 * short count does not block a delivery. See docs/adr/0026.
 */
async function packagingEstimate(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) throw notFound('Order not found');

  const estimate = await packagingConsumption.estimate(order);

  return ok(res, {
    isEstimated: true,
    // What the lines' own snapshots say, once the parcel's fate is settled. Until
    // then this is empty and the estimate above is all there is.
    isRecorded: (order.packagingCostPoisha || 0) > 0,
    recordedCost: toTaka(order.packagingCostPoisha || 0),
    rows: estimate.rows.map((row) => ({
      supply: row.supply,
      supplyNameBn: row.supplyNameBn,
      quantity: fromMilli(row.qtyMilli),
      unitCost: toTaka(row.unitCostPoisha),
      cost: toTaka(row.costPoisha),
    })),
    cost: toTaka(estimate.totalCostPoisha),
    shortages: estimate.shortages.map((s) => ({
      supply: s.supply,
      supplyNameBn: s.supplyNameBn,
      need: fromMilli(s.needMilli),
      onHand: fromMilli(s.onHandMilli),
      short: fromMilli(s.shortMilli),
    })),
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
    await order.populate(present.ownerResellerPopulate());
    return ok(res, { order: present.ownerOrder(order) });
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

  await order.populate(present.ownerResellerPopulate());

  return ok(res, {
    order: present.ownerOrder(order),
    adjustment: entry ? present.ledgerEntry(entry) : null,
  });
}

/**
 * Corrects the courier or the tracking number while the parcel is on its way.
 * Answers with the order exactly as GET /orders/:id does.
 */
async function editCourier(req, res) {
  const { courierName, trackingNumber } = req.body;
  const { order, changed, before, after } = await orderService.editCourier({
    orderId: req.params.id,
    actorUser: req.user,
    courierName,
    trackingNumber,
  });

  if (changed.length > 0) {
    await audit.record({
      actor: req.user._id,
      action: 'order.courier',
      targetType: 'Order',
      targetId: order._id,
      before: { ...before, status: order.status },
      after,
      ip: req.ip,
    });
  }

  await order.populate(present.ownerResellerPopulate());
  return ok(res, {
    order: present.ownerOrder(order),
    changed: changed.map((field) => (field === 'name' ? 'courierName' : field)),
  });
}

/** How many recently shipped parcels the courier list is read from. */
const RECENT_SHIPMENTS = 200;

/**
 * The couriers the owner has actually used lately, most recent first, for the
 * ship sheet to offer instead of a blank box. Read from what was written on the
 * last parcels rather than kept as a list, because a list is one more thing to
 * maintain and this one maintains itself. Spellings that differ only in case or
 * spacing are one courier, shown as it was written most recently.
 */
async function recentCouriers(_req, res) {
  const rows = await Order.find({ shippedAt: { $ne: null }, 'courier.name': { $nin: [null, ''] } })
    .sort({ shippedAt: -1, _id: -1 })
    .limit(RECENT_SHIPMENTS)
    .select('courier.name')
    .lean();

  const seen = new Set();
  const couriers = [];
  rows.forEach((row) => {
    const name = String(row.courier.name).trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    couriers.push(name);
  });

  return ok(res, { couriers });
}

module.exports = {
  editCourier,
  recentCouriers,
  packagingEstimate,
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
