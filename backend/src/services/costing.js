'use strict';

const Order = require('../models/Order');
const Expense = require('../models/Expense');
const Purchase = require('../models/Purchase');
const Supply = require('../models/Supply');
const { ORDER_STATUS, EXPENSE_SCOPE } = require('../domain/constants');
const { holdingValuePoisha, isLow } = require('../domain/supplyValue');
const {
  purchaseFilter,
  countedPurchases,
  countedExpenses,
} = require('../utils/costFilter');

/**
 * What it cost, and therefore what was made.
 *
 * The only place a cost or a profit figure is worked out, so the dashboard, the
 * order screen and the printed report cannot disagree about them — the same role
 * `utils/orderFilter.js` plays for which orders a screen is showing.
 *
 * Read-only. Nothing here writes, and nothing here is inside a transaction.
 *
 * ## The three figures, and why they are not interchangeable
 *
 * - **Owner revenue** is the wallet debit: goods at cost plus the delivery charge.
 *   Already defined in `CONTEXT.md`, and deliberately not the customer total,
 *   which carries the reseller's margin and is not the owner's money.
 * - **Order cost** is goods at cost, plus the packaging consumed, plus the
 *   expenses filed against that order.
 * - **Period profit** is the sum of order margins minus the **period** expenses in
 *   the range. Period expenses are never divided across orders: see docs/adr/0027.
 */

/** Orders that actually traded. A cancelled order is not a loss, it is a non-event. */
const COUNTED_STATUSES = [ORDER_STATUS.DELIVERED, ORDER_STATUS.SHIPPED, ORDER_STATUS.RETURNED];

const rangeFilter = (from, to) => {
  if (!from && !to) return {};
  const businessDate = {};
  if (from) businessDate.$gte = from;
  if (to) businessDate.$lte = to;
  return { businessDate };
};

/**
 * What one order cost and what it made.
 *
 * `expenses` is passed in rather than queried per order, so a report over a
 * thousand orders does not make a thousand round trips. Pass an empty array to
 * get the goods-and-packaging figure alone.
 */
function orderCost(order, expenses = []) {
  const goodsPoisha = (order.items || []).reduce((sum, l) => sum + (l.lineCostPoisha || 0), 0);
  const packagingPoisha = order.packagingCostPoisha || 0;
  const expensePoisha = expenses.reduce((sum, e) => sum + (e.amountPoisha || 0), 0);

  // What the owner billed: goods at cost plus delivery. Read from the stored
  // total rather than recomputed, because that is the number the ledger posted.
  const revenuePoisha = (order.totals && order.totals.walletDebitPoisha) || 0;
  const costPoisha = goodsPoisha + packagingPoisha + expensePoisha;

  return {
    goodsPoisha,
    packagingPoisha,
    expensePoisha,
    costPoisha,
    revenuePoisha,
    /*
     * The delivery charge billed, beside it, because the courier expense filed
     * against this order is what it is worth comparing to. The app has always
     * held the first and never the second; the gap is the delivery margin.
     */
    deliveryChargePoisha: order.deliveryChargePoisha || 0,
    marginPoisha: revenuePoisha - costPoisha,
  };
}

/** The order-scope expenses for a set of orders, grouped by order id. */
async function expensesByOrder(orderIds) {
  const rows = await Expense.find({
    order: { $in: orderIds },
    voidedAt: null,
    scope: EXPENSE_SCOPE.ORDER,
  }).lean();

  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.order);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

/** One order's cost, fetching its own expenses. For the order screen. */
async function costForOrder(order) {
  const rows = await Expense.find({
    order: order._id,
    voidedAt: null,
    scope: EXPENSE_SCOPE.ORDER,
  }).lean();
  return { ...orderCost(order, rows), expenses: rows };
}

/**
 * The profit and loss for a range.
 *
 * Revenue and order costs come from the orders that traded; period expenses are
 * subtracted once, at the end, because that is what they are. The two are
 * reported separately as well as netted, so a reader can see which half moved.
 */
async function periodProfit({ from, to } = {}) {
  const range = rangeFilter(from, to);

  const orders = await Order.find(
    { ...range, status: { $in: COUNTED_STATUSES } },
    {
      orderCode: 1,
      businessDate: 1,
      status: 1,
      paymentMode: 1,
      items: 1,
      totals: 1,
      deliveryChargePoisha: 1,
      packagingCostPoisha: 1,
    }
  ).lean();

  const byOrder = await expensesByOrder(orders.map((o) => o._id));

  const totals = {
    orders: orders.length,
    revenuePoisha: 0,
    goodsPoisha: 0,
    packagingPoisha: 0,
    orderExpensePoisha: 0,
    deliveryChargePoisha: 0,
  };

  const rows = orders.map((order) => {
    const cost = orderCost(order, byOrder.get(String(order._id)) || []);
    totals.revenuePoisha += cost.revenuePoisha;
    totals.goodsPoisha += cost.goodsPoisha;
    totals.packagingPoisha += cost.packagingPoisha;
    totals.orderExpensePoisha += cost.expensePoisha;
    totals.deliveryChargePoisha += cost.deliveryChargePoisha;
    return {
      orderId: order._id,
      orderCode: order.orderCode,
      businessDate: order.businessDate,
      status: order.status,
      ...cost,
    };
  });

  // Period costs: real money, not attributable to any one parcel.
  const periodRows = await Expense.aggregate([
    { $match: { ...range, voidedAt: null, scope: EXPENSE_SCOPE.PERIOD } },
    {
      $group: {
        _id: '$category',
        categoryNameBn: { $first: '$categoryNameBn' },
        amountPoisha: { $sum: '$amountPoisha' },
        count: { $sum: 1 },
      },
    },
    { $sort: { amountPoisha: -1 } },
  ]);
  const periodExpensePoisha = periodRows.reduce((sum, r) => sum + r.amountPoisha, 0);

  const orderCostPoisha =
    totals.goodsPoisha + totals.packagingPoisha + totals.orderExpensePoisha;
  const grossMarginPoisha = totals.revenuePoisha - orderCostPoisha;

  return {
    range: { from: from || null, to: to || null },
    totals: {
      ...totals,
      orderCostPoisha,
      // Before period costs. Not profit, and never labelled as such.
      grossMarginPoisha,
      periodExpensePoisha,
      /*
       * The only figure in the system that may be called profit without saying
       * whose or before what. See docs/adr/0027.
       */
      netProfitPoisha: grossMarginPoisha - periodExpensePoisha,
    },
    periodExpenses: periodRows,
    orders: rows,
  };
}

/**
 * What was bought, by payee and by supply, and the purchases themselves.
 *
 * Takes the purchase list's own filters (`utils/costFilter.js`), so the printed
 * sheet is the screen it was printed from. The breakdowns and totals count
 * received purchases only; `rows` lists what the filter matches, cancelled ones
 * included unless `status` excludes them, each carrying its status — listed,
 * never counted, exactly as the list does. `max` caps the rows, and `truncated`
 * says when it did, rather than handing back a short sheet that looks complete.
 */
async function purchaseSummary(query = {}) {
  const { from, to, max = 500 } = query;
  const match = countedPurchases(query);
  const listed = purchaseFilter(query);

  const [byPayee, bySupply, totals, rows, rowCount] = await Promise.all([
    Purchase.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$payee',
          payeeNameBn: { $first: '$payeeNameBn' },
          purchases: { $sum: 1 },
          goodsCostPoisha: { $sum: '$goodsCostPoisha' },
          chargeTotalPoisha: { $sum: '$chargeTotalPoisha' },
          totalPoisha: { $sum: '$totalPoisha' },
          billedPoisha: { $sum: '$payeeTotalPoisha' },
        },
      },
      { $sort: { totalPoisha: -1 } },
    ]),
    Purchase.aggregate([
      { $match: match },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.supply',
          supplyNameBn: { $first: '$lines.supplyNameBn' },
          unit: { $first: '$lines.unit' },
          qtyMilli: { $sum: '$lines.qtyMilli' },
          goodsCostPoisha: { $sum: '$lines.lineCostPoisha' },
          landedCostPoisha: { $sum: '$lines.landedLineCostPoisha' },
        },
      },
      { $sort: { landedCostPoisha: -1 } },
    ]),
    Purchase.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          purchases: { $sum: 1 },
          goodsCostPoisha: { $sum: '$goodsCostPoisha' },
          chargeTotalPoisha: { $sum: '$chargeTotalPoisha' },
          otherChargePoisha: { $sum: '$otherChargePoisha' },
          totalPoisha: { $sum: '$totalPoisha' },
          billedPoisha: { $sum: '$payeeTotalPoisha' },
        },
      },
    ]),
    Purchase.find(listed, {
      purchaseCode: 1,
      businessDate: 1,
      invoiceNo: 1,
      payee: 1,
      payeeNameBn: 1,
      status: 1,
      lines: 1,
      goodsCostPoisha: 1,
      chargeTotalPoisha: 1,
      totalPoisha: 1,
      payeeTotalPoisha: 1,
    })
      .sort({ businessDate: 1, createdAt: 1 })
      .limit(max)
      .lean(),
    Purchase.countDocuments(listed),
  ]);

  // Weighted average landed cost per unit, per supply: what it cost on average
  // over this range, which is the figure to compare against a new quote.
  const supplies = bySupply.map((row) => ({
    ...row,
    avgLandedUnitCostPoisha:
      row.qtyMilli > 0 ? Math.round((row.landedCostPoisha * 1000) / row.qtyMilli) : 0,
  }));

  return {
    range: { from: from || null, to: to || null },
    totals: totals[0] || {
      purchases: 0,
      goodsCostPoisha: 0,
      chargeTotalPoisha: 0,
      otherChargePoisha: 0,
      totalPoisha: 0,
      billedPoisha: 0,
    },
    byPayee,
    bySupply: supplies,
    rows: rows.map((p) => ({
      purchaseId: p._id,
      purchaseCode: p.purchaseCode,
      businessDate: p.businessDate,
      invoiceNo: p.invoiceNo || null,
      payeeId: p.payee,
      payeeNameBn: p.payeeNameBn,
      status: p.status,
      // What was bought, by name, for a sheet that has no room for the lines.
      supplies: (p.lines || []).map((l) => l.supplyNameBn),
      goodsCostPoisha: p.goodsCostPoisha,
      chargeTotalPoisha: p.chargeTotalPoisha,
      totalPoisha: p.totalPoisha,
      payeeTotalPoisha: p.payeeTotalPoisha,
    })),
    rowCount,
    truncated: rowCount > rows.length,
  };
}

/** The shelf: what is held, what it is worth, what is running out. */
async function supplyReport({ from, to } = {}) {
  const supplies = await Supply.find({ isArchived: false }).sort({ nameBn: 1 }).lean();
  const range = rangeFilter(from, to);

  // What left the shelf in the range, per supply, split by whether anybody counted.
  const StockMovement = require('../models/StockMovement');
  const moved = await StockMovement.aggregate([
    { $match: { ...range, supply: { $in: supplies.map((s) => s._id) } } },
    {
      $group: {
        _id: '$supply',
        inMilli: { $sum: { $cond: [{ $gt: ['$qtyMilli', 0] }, '$qtyMilli', 0] } },
        outMilli: { $sum: { $cond: [{ $lt: ['$qtyMilli', 0] }, '$qtyMilli', 0] } },
        estimatedOutMilli: {
          $sum: { $cond: [{ $eq: ['$isEstimated', true] }, '$qtyMilli', 0] },
        },
      },
    },
  ]);
  const byId = new Map(moved.map((m) => [String(m._id), m]));

  const rows = supplies.map((s) => {
    const m = byId.get(String(s._id)) || { inMilli: 0, outMilli: 0, estimatedOutMilli: 0 };
    return {
      supplyId: s._id,
      nameBn: s.nameBn,
      unit: s.unit,
      onHandMilli: s.onHandMilli,
      avgCostPoisha: s.avgCostPoisha,
      valuePoisha: holdingValuePoisha(s.onHandMilli, s.avgCostPoisha),
      reorderLevelMilli: s.reorderLevelMilli || 0,
      isLow: isLow(s),
      isNegative: s.onHandMilli < 0,
      receivedMilli: m.inMilli,
      usedMilli: Math.abs(m.outMilli),
      estimatedUsedMilli: Math.abs(m.estimatedOutMilli),
    };
  });

  return {
    range: { from: from || null, to: to || null },
    totals: {
      items: rows.length,
      valuePoisha: rows.reduce((sum, r) => sum + r.valuePoisha, 0),
      lowCount: rows.filter((r) => r.isLow).length,
      negativeCount: rows.filter((r) => r.isNegative).length,
    },
    supplies: rows,
  };
}

/**
 * What was spent, by category, split by scope, and the expenses themselves.
 *
 * Takes the expense list's filters (`utils/costFilter.js`), so the printed sheet
 * is the screen it was printed from. Voided expenses are never on it: a report
 * is a total, and a voided expense is kept for the audit trail, not for a total.
 * `max` caps the rows and `truncated` says when it did.
 */
async function expenseReport(query = {}) {
  const { from, to, max = 500 } = query;
  const match = countedExpenses(query);

  const [byCategory, totals, rows, rowCount] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: { category: '$category', scope: '$scope' },
          categoryNameBn: { $first: '$categoryNameBn' },
          amountPoisha: { $sum: '$amountPoisha' },
          count: { $sum: 1 },
        },
      },
      { $sort: { amountPoisha: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$scope',
          amountPoisha: { $sum: '$amountPoisha' },
          count: { $sum: 1 },
          unpaidPoisha: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'unpaid'] }, '$amountPoisha', 0] },
          },
        },
      },
    ]),
    Expense.find(match).sort({ businessDate: 1, createdAt: 1 }).limit(max).lean(),
    Expense.countDocuments(match),
  ]);

  const scope = (name) => totals.find((t) => t._id === name) || {
    amountPoisha: 0,
    count: 0,
    unpaidPoisha: 0,
  };

  return {
    range: { from: from || null, to: to || null },
    byCategory: byCategory.map((row) => ({
      categoryId: row._id.category,
      scope: row._id.scope,
      categoryNameBn: row.categoryNameBn,
      amountPoisha: row.amountPoisha,
      count: row.count,
    })),
    totals: {
      orderPoisha: scope(EXPENSE_SCOPE.ORDER).amountPoisha,
      periodPoisha: scope(EXPENSE_SCOPE.PERIOD).amountPoisha,
      allPoisha: scope(EXPENSE_SCOPE.ORDER).amountPoisha + scope(EXPENSE_SCOPE.PERIOD).amountPoisha,
      unpaidPoisha:
        scope(EXPENSE_SCOPE.ORDER).unpaidPoisha + scope(EXPENSE_SCOPE.PERIOD).unpaidPoisha,
    },
    rows: rows.map((e) => ({
      expenseId: e._id,
      businessDate: e.businessDate,
      categoryId: e.category,
      categoryNameBn: e.categoryNameBn,
      scope: e.scope,
      orderId: e.order || null,
      orderCode: e.orderCode || null,
      payeeId: e.payee || null,
      payeeNameBn: e.payeeNameBn || null,
      paymentStatus: e.paymentStatus,
      paidFrom: e.paidFrom || null,
      amountPoisha: e.amountPoisha,
      note: e.note || null,
    })),
    rowCount,
    truncated: rowCount > rows.length,
  };
}

module.exports = {
  COUNTED_STATUSES,
  orderCost,
  costForOrder,
  expensesByOrder,
  periodProfit,
  purchaseSummary,
  supplyReport,
  expenseReport,
};
