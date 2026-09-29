'use strict';

const Supply = require('../../models/Supply');
const StockMovement = require('../../models/StockMovement');
const Purchase = require('../../models/Purchase');
const Product = require('../../models/Product');

const supplyStock = require('../../services/supplyStock');
const audit = require('../../services/audit');
const { withTransaction } = require('../../services/tx');
const { ok } = require('../../middleware/error');
const { notFound, badRequest } = require('../../utils/errors');
const { toTaka } = require('../../utils/money');
const { toMilli, fromMilli } = require('../../utils/quantity');
const { MOVEMENT_KIND, MOVEMENT_INCREASES } = require('../../domain/constants');
const { holdingValuePoisha, isLow } = require('../../domain/supplyValue');
const { recipeAccuracy } = require('../../domain/packaging');
const { startOfBusinessDay } = require('../../utils/dhakaTime');

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

const presentMovement = (m) => ({
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
  reversalOf: m.reversalOf || null,
  businessDate: m.businessDate,
  note: m.note || null,
  createdAt: m.createdAt,
});

async function listSupplies(req, res) {
  const filter = req.query.includeArchived === 'true' ? {} : { isArchived: false };
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
async function getSupply(req, res) {
  const supply = await Supply.findById(req.params.id);
  if (!supply) throw notFound('Supply not found');

  const [movements, purchases, products, health] = await Promise.all([
    StockMovement.find({ supply: supply._id }).sort({ seq: -1 }).limit(20),
    Purchase.find({ 'lines.supply': supply._id }).sort({ businessDate: -1 }).limit(10),
    // Which variants name this supply, so the owner can see what drains it.
    Product.find({ 'variants.packaging.supply': supply._id }, { nameBn: 1, unit: 1, variants: 1 }),
    supplyStock.reconcile(supply._id),
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
        variantLabel: variant.label || `${fromMilli(variant.contentMilli)} ${product.unit}`,
        perBox: fromMilli(row.qtyMilli),
      });
    });
  });

  return ok(res, {
    supply: present(supply),
    movements: movements.map(presentMovement),
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

  return ok(res, { movements: movements.map(presentMovement), page, limit, total });
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
  return ok(res, { supply: present(fresh), movement: presentMovement(movement) }, 201);
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
    movement: movement ? presentMovement(movement) : null,
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
