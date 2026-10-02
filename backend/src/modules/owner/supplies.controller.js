'use strict';

const Supply = require('../../models/Supply');
const StockMovement = require('../../models/StockMovement');
const Purchase = require('../../models/Purchase');
const Product = require('../../models/Product');
const Order = require('../../models/Order');
const User = require('../../models/User');

const supplyStock = require('../../services/supplyStock');
const audit = require('../../services/audit');
const { withTransaction } = require('../../services/tx');
const { ok } = require('../../middleware/error');
const { notFound, badRequest } = require('../../utils/errors');
const { toTaka } = require('../../utils/money');
const { toMilli, fromMilli } = require('../../utils/quantity');
const {
  MOVEMENT_KIND,
  MOVEMENT_INCREASES,
  PURCHASE_STATUS,
} = require('../../domain/constants');
const { holdingValuePoisha, isLow } = require('../../domain/supplyValue');
const { recipeAccuracy } = require('../../domain/packaging');
const { startOfBusinessDay } = require('../../utils/dhakaTime');
const { variantLabel } = require('../../domain/variants');

/**
 * Supplies: the things the business buys and uses up. See docs/adr/0022.
 *
 * Quantities cross this boundary as decimals and money as taka, like everywhere
 * else in the API. Nothing above `utils/present.js` and these controllers ever
 * sees a milli-unit or a poisha.
 */

const present = (s) => ({
  id: s._id,
  nameBn: s.nameBn,
  unit: s.unit,
  note: s.note || null,
  onHand: fromMilli(s.onHandMilli),
  // The single number the owner is looking for on this screen.
  avgCost: toTaka(s.avgCostPoisha),
  value: toTaka(holdingValuePoisha(s.onHandMilli, s.avgCostPoisha)),
  reorderLevel: fromMilli(s.reorderLevelMilli || 0),
  isLow: isLow(s),
  /*
   * Negative on hand means more was consumed than was recorded bought. Surfaced
   * as its own flag rather than left for a screen to infer from a minus sign,
   * because it is the one state that needs saying out loud: "হিসাব মেলেনি".
   * See docs/adr/0026.
   */
  isNegative: s.onHandMilli < 0,
  isArchived: s.isArchived,
  sortOrder: s.sortOrder,
});

const presentMovement = (m, refs = EMPTY_REFS) => ({
  id: m._id,
  seq: m.seq,
  kind: m.kind,
  quantity: fromMilli(m.qtyMilli),
  onHandAfter: fromMilli(m.onHandAfterMilli),
  unitCost: toTaka(m.unitCostPoisha),
  // Whether anybody counted, or whether a recipe worked it out. The difference
  // is the whole point of the variance report.
  isEstimated: m.isEstimated,
  refType: m.refType,
  refId: m.refId || null,
  // The purchase code or order code the row links to, so the screen can say
  // which one without a request per row. Null for a manual movement.
  refCode: refs.codes.get(String(m.refId)) || null,
  /*
   * For a purchase row, whether that purchase has since been cancelled: the
   * receipt still stands in the history, beside the reversal that undid it, and
   * a reader needs to know the two belong together. Null on every other row.
   */
  purchaseCancelled:
    m.refType === 'purchase' && refs.cancelled.has(String(m.refId))
      ? refs.cancelled.get(String(m.refId))
      : null,
  // Who recorded it. Null for a consumption, which nobody typed.
  createdBy: refs.users.get(String(m.createdBy)) || null,
  reversalOf: m.reversalOf || null,
  businessDate: m.businessDate,
  note: m.note || null,
  createdAt: m.createdAt,
});

const EMPTY_REFS = { codes: new Map(), cancelled: new Map(), users: new Map() };

/**
 * Everything a page of movements points at, read in three queries rather than
 * one per row: the purchase and order codes, whether each purchase is cancelled,
 * and the names of whoever recorded them.
 */
async function movementRefs(movements) {
  const idsOf = (type) => [
    ...new Set(movements.filter((m) => m.refType === type && m.refId).map((m) => String(m.refId))),
  ];
  const userIds = [
    ...new Set(movements.filter((m) => m.createdBy).map((m) => String(m.createdBy))),
  ];

  const [purchases, orders, users] = await Promise.all([
    Purchase.find({ _id: { $in: idsOf('purchase') } }).select('purchaseCode status').lean(),
    Order.find({ _id: { $in: idsOf('order') } }).select('orderCode').lean(),
    User.find({ _id: { $in: userIds } }).select('name').lean(),
  ]);

  const refs = { codes: new Map(), cancelled: new Map(), users: new Map() };
  purchases.forEach((p) => {
    refs.codes.set(String(p._id), p.purchaseCode);
    refs.cancelled.set(String(p._id), p.status === PURCHASE_STATUS.CANCELLED);
  });
  orders.forEach((o) => refs.codes.set(String(o._id), o.orderCode));
  users.forEach((u) => refs.users.set(String(u._id), { id: u._id, name: u.name }));
  return refs;
}

const presentMovements = async (movements) => {
  const refs = await movementRefs(movements);
  return movements.map((m) => presentMovement(m, refs));
};

async function listSupplies(req, res) {
  /*
   * Live ones by default; `includeArchived` adds the archived ones beside them
   * and `archivedOnly` is the archived filter on its own, where restoring is.
   */
  let filter = { isArchived: false };
  if (req.query.includeArchived === 'true') filter = {};
  if (req.query.archivedOnly === 'true') filter = { isArchived: true };
  if (req.query.q) filter.nameBn = { $regex: req.query.q, $options: 'i' };

  let supplies = await Supply.find(filter).sort({ sortOrder: 1, nameBn: 1 });
  if (req.query.lowOnly === 'true') supplies = supplies.filter(isLow);

  const rows = supplies.map(present);
  return ok(res, {
    supplies: rows,
    // The whole shelf, as one figure, so the screen does not have to add taka
    // strings back up.
    totals: {
      items: rows.length,
      value: rows.reduce((sum, r) => sum + r.value, 0),
      lowCount: rows.filter((r) => r.isLow).length,
      negativeCount: rows.filter((r) => r.isNegative).length,
    },
  });
}

async function createSupply(req, res) {
  const supply = await Supply.create({
    nameBn: req.body.nameBn,
    unit: req.body.unit,
    note: req.body.note,
    reorderLevelMilli: req.body.reorderLevel ? toMilli(req.body.reorderLevel) : 0,
    sortOrder: req.body.sortOrder || 0,
  });

  await audit.record({
    actor: req.user._id,
    action: 'supply.create',
    targetType: 'Supply',
    targetId: supply._id,
    after: { nameBn: supply.nameBn, unit: supply.unit },
    ip: req.ip,
  });
  return ok(res, { supply: present(supply) }, 201);
}

async function updateSupply(req, res) {
  const existing = await Supply.findById(req.params.id);
  if (!existing) throw notFound('Supply not found');

  const patch = {};
  if (req.body.nameBn !== undefined) patch.nameBn = req.body.nameBn;
  if (req.body.note !== undefined) patch.note = req.body.note;
  if (req.body.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;
  if (req.body.isArchived !== undefined) patch.isArchived = req.body.isArchived;
  if (req.body.reorderLevel !== undefined) {
    patch.reorderLevelMilli = req.body.reorderLevel ? toMilli(req.body.reorderLevel) : 0;
  }

  const supply = await Supply.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });

  if (patch.isArchived !== undefined && Boolean(existing.isArchived) !== Boolean(supply.isArchived)) {
    await audit.record({
      actor: req.user._id,
      action: `supply.${supply.isArchived ? 'archive' : 'unarchive'}`,
      targetType: 'Supply',
      targetId: supply._id,
      before: { isArchived: Boolean(existing.isArchived) },
      after: { isArchived: Boolean(supply.isArchived) },
      ip: req.ip,
    });
  }
  return ok(res, { supply: present(supply) });
}

/**
 * Archive, never delete.
 *
 * A supply named by a purchase, a movement or a packaging recipe has to stay
 * resolvable or that history stops making sense — the same rule as a Source.
 */
async function archiveSupply(req, res) {
  const existing = await Supply.findById(req.params.id);
  if (!existing) throw notFound('Supply not found');

  const supply = await Supply.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: true } },
    { new: true }
  );
  if (!existing.isArchived) {
    await audit.record({
      actor: req.user._id,
      action: 'supply.archive',
      targetType: 'Supply',
      targetId: supply._id,
      before: { isArchived: false },
      after: { isArchived: true },
      ip: req.ip,
    });
  }
  return ok(res, { supply: present(supply) });
}

/**
 * One supply, with where it came from, where it went, and which boxes consume it.
 *
 * The recipe list is the answer to "why is this running out": a supply consumed
 * by the eleven-kilo box drains at whatever rate that box sells.
 */
/**
 * Where a supply's two headline numbers came from.
 *
 * Every computed figure on a screen is a figure somebody will eventually
 * disbelieve, and "trust me" is not an answer when the number is money. These two
 * are the ones that get questioned:
 *
 * - **what is on the shelf**, which is a sum of everything that ever moved, and
 * - **what one unit cost**, which is a weighted average of landed costs and is
 *   the least obvious number in the whole system.
 *
 * Both are worked out here rather than in the screen, so the explanation cannot
 * drift from the figure it explains.
 */
async function onHandProvenance(supplyId) {
  const rows = await StockMovement.aggregate([
    { $match: { supply: supplyId } },
    { $group: { _id: '$kind', qtyMilli: { $sum: '$qtyMilli' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({
    kind: row._id,
    quantity: fromMilli(row.qtyMilli),
    count: row.count,
  }));
}

/**
 * The purchase that set the current average, broken into the lines a person
 * would add up on paper: the rate, then each charge, then the division.
 *
 * Only the most recent receipt, because that is the one the owner remembers and
 * the one whose slip is in their hand. A supply whose average came from several
 * lots says so, so nobody reads this as the whole story.
 */
async function avgCostProvenance(supplyId) {
  const purchase = await Purchase.findOne({
    'lines.supply': supplyId,
    status: PURCHASE_STATUS.RECEIVED,
  }).sort({ businessDate: -1, createdAt: -1 });

  if (!purchase) return null;

  const line = purchase.lines.find((l) => String(l.supply) === String(supplyId));
  if (!line) return null;

  const receipts = await StockMovement.countDocuments({
    supply: supplyId,
    kind: { $in: [MOVEMENT_KIND.PURCHASE, MOVEMENT_KIND.OPENING] },
  });

  return {
    purchaseId: purchase._id,
    purchaseCode: purchase.purchaseCode,
    payeeId: purchase.payee,
    payeeNameBn: purchase.payeeNameBn,
    businessDate: purchase.businessDate,
    quantity: fromMilli(line.qtyMilli),
    unit: line.unit,
    // The rate, before anything was spread onto it.
    unitCost: toTaka(line.unitCostPoisha),
    goodsCost: toTaka(line.lineCostPoisha),
    /*
     * Every charge, whether or not it was allocated, because the owner is
     * checking this against a slip that lists all of them. `allocate` false means
     * it was paid but did not raise the per-unit cost.
     */
    charges: (purchase.charges || []).map((c) => ({
      kind: c.kind,
      amount: toTaka(c.amountPoisha),
      allocate: c.allocate,
      paidTo: c.paidTo,
      payeeName: c.payeeName || null,
    })),
    // This line's share of the allocated charges, and the division that follows.
    allocatedCharge: toTaka(line.allocatedChargePoisha),
    landedLineCost: toTaka(line.landedLineCostPoisha),
    landedUnitCost: toTaka(line.landedUnitCostPoisha),
    /*
     * True when more than one lot has ever arrived, so the average is a blend and
     * this single purchase does not explain it on its own. Said out loud rather
     * than left for the owner to wonder why the arithmetic below does not equal
     * the figure above.
     */
    isBlended: receipts > 1,
    receipts,
  };
}

async function getSupply(req, res) {
  const supply = await Supply.findById(req.params.id);
  if (!supply) throw notFound('Supply not found');

  const [movements, purchases, products, health, onHandFrom, avgCostFrom] = await Promise.all([
    StockMovement.find({ supply: supply._id }).sort({ seq: -1 }).limit(20),
    Purchase.find({ 'lines.supply': supply._id }).sort({ businessDate: -1 }).limit(10),
    // Which variants name this supply, so the owner can see what drains it.
    Product.find({ 'variants.packaging.supply': supply._id }, { nameBn: 1, unit: 1, variants: 1 }),
    supplyStock.reconcile(supply._id),
    onHandProvenance(supply._id),
    avgCostProvenance(supply._id),
  ]);

  const usedBy = [];
  products.forEach((product) => {
    (product.variants || []).forEach((variant) => {
      const row = (variant.packaging || []).find(
        (p) => String(p.supply) === String(supply._id)
      );
      if (!row) return;
      usedBy.push({
        productId: product._id,
        productNameBn: product.nameBn,
        variantId: variant._id,
        variantLabel: variantLabel(variant, product.unit),
        perBox: fromMilli(row.qtyMilli),
      });
    });
  });

  return ok(res, {
    supply: present(supply),
    movements: await presentMovements(movements),
    purchases: purchases.map((p) => {
      const line = p.lines.find((l) => String(l.supply) === String(supply._id));
      return {
        id: p._id,
        purchaseCode: p.purchaseCode,
        payeeNameBn: p.payeeNameBn,
        businessDate: p.businessDate,
        status: p.status,
        quantity: line ? fromMilli(line.qtyMilli) : 0,
        unitCost: line ? toTaka(line.unitCostPoisha) : 0,
        // What it really cost, which is the figure worth comparing across sellers.
        landedUnitCost: line ? toTaka(line.landedUnitCostPoisha) : 0,
      };
    }),
    usedBy,
    // Whether the movements and the cached count still agree. Shown because a
    // drift here is a bug, not a business event.
    health: { ok: health.ok, problems: health.problems },
    /*
     * How the two headline figures were arrived at, so the screen can show the
     * working rather than asking to be believed.
     */
    provenance: { onHand: onHandFrom, avgCost: avgCostFrom },
  });
}

async function listMovements(req, res) {
  const supply = await Supply.findById(req.params.id);
  if (!supply) throw notFound('Supply not found');

  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 30), 100);

  const [movements, total] = await Promise.all([
    StockMovement.find({ supply: supply._id })
      .sort({ seq: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    StockMovement.countDocuments({ supply: supply._id }),
  ]);

  return ok(res, { movements: await presentMovements(movements), page, limit, total });
}

/**
 * A movement the owner typed: an opening balance, breakage, a loss, a correction.
 *
 * The one-directional kinds are normalised rather than trusted. `DAMAGED` with a
 * positive quantity is somebody typing what they mean without a minus sign, and
 * honouring the sign literally would add stock to record breakage.
 */
async function adjustSupply(req, res) {
  const supply = await Supply.findById(req.params.id);
  if (!supply) throw notFound('Supply not found');
  if (supply.isArchived) {
    throw badRequest('SUPPLY_ARCHIVED', 'This supply is archived; restore it first');
  }

  const { kind, quantity, nonce, note, date } = req.body;
  const magnitude = toMilli(Math.abs(quantity));

  let qtyMilli;
  if (kind === MOVEMENT_KIND.ADJUSTMENT) {
    // The only kind whose sign the owner really chooses.
    qtyMilli = quantity < 0 ? -magnitude : magnitude;
  } else if (MOVEMENT_INCREASES.includes(kind)) {
    qtyMilli = magnitude;
  } else {
    qtyMilli = -magnitude;
  }

  const movement = await withTransaction((session) =>
    supplyStock.adjust(session, {
      supply: supply._id,
      kind,
      qtyMilli,
      nonce,
      note,
      createdBy: req.user._id,
      date: date ? startOfBusinessDay(date) : new Date(),
      // Returning goods to a supplier is a promise and is guarded; everything
      // else the owner types is a statement about reality and is not.
      allowNegative: kind !== MOVEMENT_KIND.RETURN_TO_PAYEE,
    })
  );

  await audit.record({
    actor: req.user._id,
    action: 'supply.adjust',
    targetType: 'Supply',
    targetId: supply._id,
    after: { kind, qtyMilli, note: note || null },
    ip: req.ip,
  });

  const fresh = await Supply.findById(supply._id);
  const [presented] = await presentMovements([movement]);
  return ok(res, { supply: present(fresh), movement: presented }, 201);
}

/**
 * A stock take: the owner counted the shelf and this is the real number.
 *
 * Takes the counted total, not a difference, because "there are 94" is what
 * somebody with a clipboard knows. The service works out the delta and writes
 * nothing at all when the count already agrees.
 *
 * This is the only thing that corrects a drifting packaging recipe, which is why
 * its movement is counted rather than estimated. See docs/adr/0026.
 */
async function stockTake(req, res) {
  const supply = await Supply.findById(req.params.id);
  if (!supply) throw notFound('Supply not found');

  const { counted, nonce, note, date } = req.body;
  /*
   * `toMilli` refuses zero, because an ordered quantity of nothing is a mistake.
   * A *counted* quantity of nothing is not: an empty shelf is a real and common
   * answer, and it is the one the owner most needs to record.
   */
  const countedMilli = counted === 0 ? 0 : toMilli(counted);

  const movement = await withTransaction((session) =>
    supplyStock.stockTake(session, {
      supply: supply._id,
      countedMilli,
      nonce,
      note,
      createdBy: req.user._id,
      date: date ? startOfBusinessDay(date) : new Date(),
    })
  );

  await audit.record({
    actor: req.user._id,
    action: 'supply.stockTake',
    targetType: 'Supply',
    targetId: supply._id,
    before: { onHandMilli: supply.onHandMilli },
    after: { countedMilli, deltaMilli: movement ? movement.qtyMilli : 0 },
    ip: req.ip,
  });

  const fresh = await Supply.findById(supply._id);
  return ok(res, {
    supply: present(fresh),
    // Null when the count already agreed. A movement of zero is not a fact.
    movement: movement ? (await presentMovements([movement]))[0] : null,
    agreed: movement === null,
  });
}

/**
 * How well the recipes have been predicting reality.
 *
 * The report that makes an estimate trustworthy. Estimated consumption against
 * counted corrections, per supply: a ratio above one means every box really uses
 * more than its recipe claims.
 */
async function variance(req, res) {
  const { from, to } = req.query;
  const supplyId = req.params.id || null;

  const rows = await supplyStock.variance({ from, to, supplyId });
  const supplies = await Supply.find(
    supplyId ? { _id: supplyId } : { _id: { $in: rows.map((r) => r._id) } }
  );
  const byId = new Map(supplies.map((s) => [String(s._id), s]));

  return ok(res, {
    range: { from: from || null, to: to || null },
    rows: rows
      .map((row) => {
        const supply = byId.get(String(row._id));
        if (!supply) return null;
        const accuracy = recipeAccuracy({
          estimatedMilli: row.estimatedMilli,
          countedMilli: row.countedAdjustmentMilli,
        });
        return {
          supplyId: row._id,
          nameBn: supply.nameBn,
          unit: supply.unit,
          estimated: fromMilli(Math.abs(row.estimatedMilli)),
          countedCorrection: fromMilli(row.countedAdjustmentMilli),
          actual: accuracy.actualMilli == null ? null : fromMilli(accuracy.actualMilli),
          /*
           * Null, never 1, when nothing has been compared. No evidence and no
           * error are different statements — the same rule `complaintRate`
           * follows for an orchard nobody has bought from.
           */
          ratio: accuracy.ratio,
        };
      })
      .filter(Boolean)
      // Worst-predicted first: that is the recipe worth fixing.
      .sort((a, b) => Math.abs((b.ratio || 1) - 1) - Math.abs((a.ratio || 1) - 1)),
  });
}

module.exports = {
  present,
  presentMovement,
  listSupplies,
  createSupply,
  updateSupply,
  archiveSupply,
  getSupply,
  listMovements,
  adjustSupply,
  stockTake,
  variance,
};
