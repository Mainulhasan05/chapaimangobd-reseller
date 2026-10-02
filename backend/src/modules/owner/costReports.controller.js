'use strict';

const costing = require('../../services/costing');
const payeeLedger = require('../../services/payeeLedger');
const ledger = require('../../services/ledger');
const Payee = require('../../models/Payee');
const Purchase = require('../../models/Purchase');
const Expense = require('../../models/Expense');
const { ok } = require('../../middleware/error');
const { toTaka } = require('../../utils/money');
const { fromMilli } = require('../../utils/quantity');
const { streamCsv } = require('../../utils/csv');
const { formatDhakaDateTime } = require('../../utils/dhakaTime');
const { purchaseFilter, countedExpenses } = require('../../utils/costFilter');

/**
 * The cost-side reports. See docs/adr/0027.
 *
 * Every figure comes from `services/costing.js`, so these and the dashboard and
 * the printed sheets cannot disagree. Nothing here does arithmetic of its own
 * beyond converting poisha to taka at the boundary.
 */

/** The shelf: what is held, what it is worth, what is running out. */
async function supplies(req, res) {
  const report = await costing.supplyReport(req.query);

  return ok(res, {
    range: report.range,
    totals: {
      items: report.totals.items,
      value: toTaka(report.totals.valuePoisha),
      lowCount: report.totals.lowCount,
      negativeCount: report.totals.negativeCount,
    },
    supplies: report.supplies.map((s) => ({
      supplyId: s.supplyId,
      nameBn: s.nameBn,
      unit: s.unit,
      onHand: fromMilli(s.onHandMilli),
      avgCost: toTaka(s.avgCostPoisha),
      value: toTaka(s.valuePoisha),
      reorderLevel: fromMilli(s.reorderLevelMilli),
      isLow: s.isLow,
      isNegative: s.isNegative,
      received: fromMilli(s.receivedMilli),
      used: fromMilli(s.usedMilli),
      // How much of that was worked out from a recipe rather than counted.
      estimatedUsed: fromMilli(s.estimatedUsedMilli),
    })),
  });
}

/** What was bought, from whom, and what it really cost per unit. */
async function purchases(req, res) {
  const report = await costing.purchaseSummary(req.query);
  const t = report.totals;

  return ok(res, {
    range: report.range,
    totals: {
      purchases: t.purchases,
      goodsCost: toTaka(t.goodsCostPoisha),
      chargeTotal: toTaka(t.chargeTotalPoisha),
      // Paid to somebody other than the seller, so owed to nobody.
      otherCharge: toTaka(t.otherChargePoisha),
      spent: toTaka(t.totalPoisha),
      billedByPayees: toTaka(t.billedPoisha),
    },
    byPayee: report.byPayee.map((r) => ({
      payeeId: r._id,
      nameBn: r.payeeNameBn,
      purchases: r.purchases,
      goodsCost: toTaka(r.goodsCostPoisha),
      chargeTotal: toTaka(r.chargeTotalPoisha),
      spent: toTaka(r.totalPoisha),
      billed: toTaka(r.billedPoisha),
    })),
    bySupply: report.bySupply.map((r) => ({
      supplyId: r._id,
      nameBn: r.supplyNameBn,
      unit: r.unit,
      quantity: fromMilli(r.qtyMilli),
      goodsCost: toTaka(r.goodsCostPoisha),
      landedCost: toTaka(r.landedCostPoisha),
      /*
       * The figure to hold a new quote against: what a unit really cost on
       * average over this range, charges included.
       */
      avgLandedUnitCost: toTaka(r.avgLandedUnitCostPoisha),
    })),
    /*
     * The purchases themselves, oldest first, for the itemised section of the
     * sheet. Cancelled ones appear with their status and are in no total above.
     */
    rows: report.rows.map((r) => ({
      id: r.purchaseId,
      purchaseCode: r.purchaseCode,
      businessDate: r.businessDate,
      invoiceNo: r.invoiceNo,
      payeeId: r.payeeId,
      payeeNameBn: r.payeeNameBn,
      status: r.status,
      supplies: r.supplies,
      goodsCost: toTaka(r.goodsCostPoisha),
      chargeTotal: toTaka(r.chargeTotalPoisha),
      spent: toTaka(r.totalPoisha),
      billed: toTaka(r.payeeTotalPoisha),
    })),
    rowCount: report.rowCount,
    truncated: report.truncated,
  });
}

/**
 * Who the owner owes, now.
 *
 * Takes no date range, for the same reason the reseller due report does not: a
 * due is where an account stands at the moment it is printed, not a property of
 * a period.
 */
async function payables(req, res) {
  const [rows, payees] = await Promise.all([
    payeeLedger.dueBalances(),
    Payee.find({}, { nameBn: 1, kind: 1, phoneE164: 1, isArchived: 1 }).lean(),
  ]);
  const byId = new Map(payees.map((p) => [String(p._id), p]));

  const all = rows
    .map((row) => {
      const payee = byId.get(String(row.payee));
      if (!payee) return null;
      return {
        payeeId: row.payee,
        nameBn: payee.nameBn,
        kind: payee.kind,
        phone: payee.phoneE164 || null,
        isArchived: Boolean(payee.isArchived),
        due: toTaka(row.duePoisha),
        entries: row.entries,
      };
    })
    .filter(Boolean);

  const owed = all.filter((r) => r.due > 0);
  const advances = all.filter((r) => r.due < 0);

  return ok(res, {
    payables: owed,
    // Kept apart, never netted: money already paid out and money still owed are
    // different facts, and one figure hiding both would be misleading.
    advances: advances.map((r) => ({ ...r, advance: -r.due })),
    totals: {
      due: owed.reduce((sum, r) => sum + r.due, 0),
      advance: advances.reduce((sum, r) => sum - r.due, 0),
      payeeCount: owed.length,
    },
  });
}

/** What was spent, by category, order costs and period costs kept apart. */
async function expenses(req, res) {
  const report = await costing.expenseReport(req.query);

  return ok(res, {
    range: report.range,
    byCategory: report.byCategory.map((r) => ({
      categoryId: r.categoryId,
      nameBn: r.categoryNameBn,
      scope: r.scope,
      amount: toTaka(r.amountPoisha),
      count: r.count,
    })),
    totals: {
      order: toTaka(report.totals.orderPoisha),
      period: toTaka(report.totals.periodPoisha),
      all: toTaka(report.totals.allPoisha),
      unpaid: toTaka(report.totals.unpaidPoisha),
    },
    // The expenses themselves, oldest first, for the itemised section.
    rows: report.rows.map((r) => ({
      id: r.expenseId,
      businessDate: r.businessDate,
      categoryId: r.categoryId,
      categoryNameBn: r.categoryNameBn,
      scope: r.scope,
      orderId: r.orderId,
      orderCode: r.orderCode,
      payeeId: r.payeeId,
      payeeNameBn: r.payeeNameBn,
      paymentStatus: r.paymentStatus,
      paidFrom: r.paidFrom,
      amount: toTaka(r.amountPoisha),
      note: r.note,
    })),
    rowCount: report.rowCount,
    truncated: report.truncated,
  });
}

/**
 * The profit and loss. The report this whole plan exists for.
 *
 * `grossMargin` is before period costs and is never called profit. `netProfit` is
 * the one figure that may be.
 */
async function profit(req, res) {
  const report = await costing.periodProfit(req.query);
  const t = report.totals;

  return ok(res, {
    range: report.range,
    totals: {
      orders: t.orders,
      // What the owner billed: goods at cost plus delivery. Never the customer
      // total, which carries the resellers' margin.
      revenue: toTaka(t.revenuePoisha),
      goods: toTaka(t.goodsPoisha),
      packaging: toTaka(t.packagingPoisha),
      orderExpenses: toTaka(t.orderExpensePoisha),
      orderCost: toTaka(t.orderCostPoisha),
      grossMargin: toTaka(t.grossMarginPoisha),
      periodExpenses: toTaka(t.periodExpensePoisha),
      netProfit: toTaka(t.netProfitPoisha),
      // What was billed for delivery, to hold against the courier expense.
      deliveryCharged: toTaka(t.deliveryChargePoisha),
    },
    periodExpenses: report.periodExpenses.map((r) => ({
      categoryId: r._id,
      nameBn: r.categoryNameBn,
      amount: toTaka(r.amountPoisha),
      count: r.count,
    })),
    // Worst margin first: the parcels worth looking at.
    orders: report.orders
      .map((o) => ({
        orderId: o.orderId,
        orderCode: o.orderCode,
        businessDate: o.businessDate,
        status: o.status,
        revenue: toTaka(o.revenuePoisha),
        goods: toTaka(o.goodsPoisha),
        packaging: toTaka(o.packagingPoisha),
        expenses: toTaka(o.expensePoisha),
        cost: toTaka(o.costPoisha),
        margin: toTaka(o.marginPoisha),
      }))
      .sort((a, b) => a.margin - b.margin),
  });
}

/**
 * Receivables and payables side by side, for the dashboard.
 *
 * Presented as two figures and never as one net number: what resellers owe the
 * owner and what the owner owes suppliers are different people's money, and
 * subtracting one from the other describes nobody's position.
 */
async function position(req, res) {
  const [receivablePoisha, payablePoisha] = await Promise.all([
    ledger.totalReceivablePoisha(),
    payeeLedger.totalPayablePoisha(),
  ]);

  return ok(res, {
    receivable: toTaka(receivablePoisha),
    payable: toTaka(payablePoisha),
  });
}

/* ----------------------------------------------------------------- exports */

/**
 * Streamed with a cursor, never buffered: a season of purchases built in memory
 * would take down a small VPS. Same helper the order export uses.
 *
 * One row per purchase LINE rather than per purchase, because the interesting
 * column is the landed unit cost and that is a property of a line.
 */
async function exportPurchases(req, res) {
  // The list's own filters, so a download is the screen it was asked from.
  const filter = purchaseFilter(req.query);

  const headers = [
    'purchaseCode',
    'businessDate',
    'status',
    'payee',
    'invoiceNo',
    'supply',
    'unit',
    'quantity',
    'unitCost',
    'allocatedCharge',
    'landedUnitCost',
    'landedLineCost',
    'purchaseTotal',
    'billedToPayee',
    'createdAt',
  ];

  /*
   * A purchase has many lines, and streamCsv writes one row per document, so the
   * cursor yields lines rather than purchases. `$unwind` does that in the
   * database instead of buffering every purchase to flatten it here.
   */
  const cursor = Purchase.aggregate([
    { $match: filter },
    { $sort: { businessDate: 1, createdAt: 1 } },
    { $unwind: '$lines' },
  ]).cursor();

  const toRow = (p) => [
    p.purchaseCode,
    p.businessDate,
    p.status,
    p.payeeNameBn,
    p.invoiceNo || '',
    p.lines.supplyNameBn,
    p.lines.unit,
    fromMilli(p.lines.qtyMilli),
    toTaka(p.lines.unitCostPoisha),
    toTaka(p.lines.allocatedChargePoisha),
    toTaka(p.lines.landedUnitCostPoisha),
    toTaka(p.lines.landedLineCostPoisha),
    toTaka(p.totalPoisha),
    toTaka(p.payeeTotalPoisha),
    formatDhakaDateTime(p.createdAt),
  ];

  await streamCsv(req, res, { filename: 'purchases.csv', headers, cursor, toRow });
}

async function exportExpenses(req, res) {
  // The list's own filters, never a voided expense.
  const filter = countedExpenses(req.query);

  const headers = [
    'businessDate',
    'category',
    'scope',
    'amount',
    'orderCode',
    'payee',
    'paymentStatus',
    'paidFrom',
    'note',
    'createdAt',
  ];

  const cursor = Expense.find(filter).sort({ businessDate: 1, createdAt: 1 }).lean().cursor();

  const toRow = (e) => [
    e.businessDate,
    e.categoryNameBn,
    e.scope,
    toTaka(e.amountPoisha),
    e.orderCode || '',
    e.payeeNameBn || '',
    e.paymentStatus,
    e.paidFrom || '',
    e.note || '',
    formatDhakaDateTime(e.createdAt),
  ];

  await streamCsv(req, res, { filename: 'expenses.csv', headers, cursor, toRow });
}

module.exports = {
  supplies,
  purchases,
  payables,
  expenses,
  profit,
  position,
  exportPurchases,
  exportExpenses,
};
