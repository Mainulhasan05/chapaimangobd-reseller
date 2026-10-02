'use strict';

const Purchase = require('../../models/Purchase');
const purchaseService = require('../../services/purchaseService');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const { toMilli, fromMilli } = require('../../utils/quantity');
const { startOfBusinessDay } = require('../../utils/dhakaTime');
const { purchaseFilter, countedPurchases } = require('../../utils/costFilter');

/**
 * Purchases: what was bought, from whom, and what it really cost.
 * See docs/adr/0023 and docs/adr/0024.
 */

const presentLine = (l) => ({
  id: l._id,
  supply: l.supply,
  supplyNameBn: l.supplyNameBn,
  unit: l.unit,
  quantity: fromMilli(l.qtyMilli),
  // The rate agreed.
  unitCost: toTaka(l.unitCostPoisha),
  lineCost: toTaka(l.lineCostPoisha),
  // This line's share of the van, the loading and the rest.
  allocatedCharge: toTaka(l.allocatedChargePoisha),
  /*
   * What it actually cost per unit: "koto kore porlo". The figure worth comparing
   * between sellers, and the one that feeds the supply's average cost. Always
   * presented beside `unitCost` so the difference is visible rather than implied.
   */
  landedUnitCost: toTaka(l.landedUnitCostPoisha),
  landedLineCost: toTaka(l.landedLineCostPoisha),
});

const presentCharge = (c) => ({
  id: c._id,
  kind: c.kind,
  amount: toTaka(c.amountPoisha),
  // Whether the payee billed this, or somebody else was paid on the spot.
  paidTo: c.paidTo,
  payeeName: c.payeeName || null,
  allocate: c.allocate,
  note: c.note || null,
});

const present = (p) => ({
  id: p._id,
  purchaseCode: p.purchaseCode,
  payee: p.payee,
  payeeNameBn: p.payeeNameBn,
  businessDate: p.businessDate,
  invoiceNo: p.invoiceNo || null,
  status: p.status,
  lines: (p.lines || []).map(presentLine),
  charges: (p.charges || []).map(presentCharge),
  allocationBasis: p.allocationBasis,
  goodsCost: toTaka(p.goodsCostPoisha),
  chargeTotal: toTaka(p.chargeTotalPoisha),
  /*
   * `payeeTotal` is what this seller is owed; `total` is what the purchase cost
   * the business. They differ by whatever was paid to a third party at the gate,
   * and presenting only one of them is how a due ends up overstated.
   */
  payeeTotal: toTaka(p.payeeTotalPoisha),
  otherCharge: toTaka(p.otherChargePoisha),
  total: toTaka(p.totalPoisha),
  cancelledAt: p.cancelledAt || null,
  cancelReason: p.cancelReason || null,
  note: p.note || null,
  createdAt: p.createdAt,
});

async function listPurchases(req, res) {
  const { page, limit } = req.query;
  const filter = purchaseFilter(req.query);

  const [purchases, total, [sums]] = await Promise.all([
    Purchase.find(filter)
      .sort({ businessDate: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Purchase.countDocuments(filter),
    /*
     * Summed over the whole filter in the database, not over the page in hand.
     * Reducing the twenty rows on screen made the figure above the list change as
     * the owner scrolled, and on any range longer than a page it was simply the
     * wrong number under the right heading.
     */
    Purchase.aggregate([
      { $match: countedPurchases(req.query) },
      {
        $group: {
          _id: null,
          goodsCostPoisha: { $sum: '$goodsCostPoisha' },
          chargeTotalPoisha: { $sum: '$chargeTotalPoisha' },
          totalPoisha: { $sum: '$totalPoisha' },
          payeeTotalPoisha: { $sum: '$payeeTotalPoisha' },
        },
      },
    ]),
  ]);

  const t = sums || {};
  return ok(res, {
    purchases: purchases.map(present),
    page,
    limit,
    total,
    // Cancelled purchases are listed but never counted: they were undone.
    totals: {
      goodsCost: toTaka(t.goodsCostPoisha || 0),
      chargeTotal: toTaka(t.chargeTotalPoisha || 0),
      spent: toTaka(t.totalPoisha || 0),
      billedByPayees: toTaka(t.payeeTotalPoisha || 0),
    },
  });
}

async function getPurchase(req, res) {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) throw notFound('Purchase not found');
  return ok(res, { purchase: present(purchase) });
}

/**
 * Records a purchase. Moves the stock and posts the due in one transaction, so
 * there is no window where the crates are on the shelf and nobody is owed.
 */
async function createPurchase(req, res) {
  const purchase = await purchaseService.recordPurchase({
    payeeId: req.body.payeeId,
    lines: req.body.lines.map((l) => ({
      supplyId: l.supplyId,
      qtyMilli: toMilli(l.quantity),
      unitCostPoisha: toPoisha(l.unitCost),
    })),
    charges: (req.body.charges || []).map((c) => ({
      kind: c.kind,
      amountPoisha: toPoisha(c.amount),
      paidTo: c.paidTo,
      payeeName: c.payeeName,
      allocate: c.allocate,
      note: c.note,
    })),
    allocationBasis: req.body.allocationBasis,
    date: req.body.date ? startOfBusinessDay(req.body.date) : new Date(),
    invoiceNo: req.body.invoiceNo,
    note: req.body.note,
    actorUser: req.user,
    ip: req.ip,
  });

  return ok(res, { purchase: present(purchase) }, 201);
}

/** Cancels a purchase: reverses the stock and the due together. Never an edit. */
async function cancelPurchase(req, res) {
  const purchase = await purchaseService.cancelPurchase({
    purchaseId: req.params.id,
    reason: req.body.reason,
    actorUser: req.user,
    ip: req.ip,
  });
  return ok(res, { purchase: present(purchase) });
}

module.exports = { present, listPurchases, getPurchase, createPurchase, cancelPurchase };
