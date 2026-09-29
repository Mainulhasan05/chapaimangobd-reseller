'use strict';

const Supply = require('../models/Supply');
const StockMovement = require('../models/StockMovement');
const { MOVEMENT_KIND } = require('../domain/constants');
const { nextAverage } = require('../domain/supplyValue');
const { conflict, notFound, badRequest } = require('../utils/errors');
const { businessDate } = require('../utils/dhakaTime');
const { assertPoisha } = require('../utils/money');

/**
 * The only code permitted to change a supply's on-hand count. See docs/adr/0022.
 *
 * Every call must be inside a transaction session: a count move and its movement
 * record are one fact and must commit or fail together, exactly as a balance move
 * and its ledger entry are.
 *
 * ## What is different from `services/stock.js`
 *
 * `stock.js` moves product stock and **refuses to oversell**: its update filter
 * requires `stockQty >= qty`, so two concurrent confirms cannot both take the
 * last box. That is right for a product, because selling a mango that does not
 * exist is a promise the business cannot keep.
 *
 * This service does the opposite by default. A supply count may go **negative**,
 * because the thing on the other end is not a promise to a customer but a
 * bookkeeping figure, and refusing to record a parcel that has genuinely gone
 * out would be refusing to write down something that already happened. See
 * docs/adr/0026.
 *
 * A deliberate, owner-initiated take (`RETURN_TO_PAYEE`, sending crates back)
 * passes `allowNegative: false` and is guarded, because that one *is* a promise.
 */

const keys = {
  purchase: (purchaseId, supplyId) => `purchase:${purchaseId}:supply:${supplyId}:v1`,
  purchaseCancel: (purchaseId, supplyId) =>
    `purchase:${purchaseId}:cancel:supply:${supplyId}:v1`,
  // One per order per supply. The order is the unit of consumption, so
  // delivering twice can only ever consume once.
  consume: (orderId, supplyId) => `order:${orderId}:supply:${supplyId}:v1`,
  manual: (nonce) => `supply-manual:${nonce}`,
  reversal: (movementId, reason) => `supply-reversal:${movementId}:${reason}`,
};

/**
 * Posts one movement and moves the count.
 *
 * The count change and the sequence number happen in a single `findOneAndUpdate`.
 * Reading the count and then writing it would let two concurrent deliveries
 * compute the same `onHandAfter`, even inside a transaction.
 *
 * @param {import('mongoose').ClientSession} session
 * @param {object} input
 * @param {number} input.qtyMilli Signed. Negative takes from the shelf.
 * @param {boolean} [input.allowNegative=true] False guards the take, as product
 *   stock is guarded. See the note above about which callers want which.
 * @param {boolean} [input.isEstimated=false] True when the quantity came from a
 *   packaging recipe rather than from somebody counting.
 */
async function postMovement(session, input) {
  const {
    supply,
    kind,
    qtyMilli,
    unitCostPoisha = 0,
    idempotencyKey,
    refType,
    refId = null,
    reversalOf = null,
    isEstimated = false,
    note,
    createdBy = null,
    allowNegative = true,
    date = new Date(),
  } = input;

  if (!session) throw new Error('postMovement must be called inside a transaction session');
  if (!idempotencyKey) throw new Error('postMovement requires an idempotencyKey');
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli === 0) {
    throw badRequest('INVALID_QUANTITY', 'A movement must be a non-zero whole quantity');
  }
  assertPoisha(unitCostPoisha, 'unitCostPoisha');

  const supplyId = supply._id || supply;

  // Fast path: this exact movement was already posted, so the count already moved.
  const existing = await StockMovement.findOne({ idempotencyKey }).session(session);
  if (existing) return existing;

  const filter = { _id: supplyId };
  if (qtyMilli < 0 && !allowNegative) {
    // The same shape of guard `stock.js` uses, and for the same reason.
    filter.onHandMilli = { $gte: -qtyMilli };
  }

  const inc = { onHandMilli: qtyMilli, movementSeq: 1 };

  const updated = await Supply.findOneAndUpdate(filter, { $inc: inc }, { new: true, session });

  if (!updated) {
    const doc = await Supply.findById(supplyId).session(session);
    if (!doc) throw notFound('Supply not found');
    throw conflict(
      'SUPPLY_SHORT',
      `Only ${doc.onHandMilli / 1000} ${doc.unit} of ${doc.nameBn} is left`
    );
  }

  /*
   * A receipt re-averages the cost. Done after the count move and in the same
   * session, using the pre-move count, because the average has to be weighted by
   * what was held *before* this lot arrived.
   */
  if (qtyMilli > 0 && kind !== MOVEMENT_KIND.REVERSAL) {
    const heldBefore = updated.onHandMilli - qtyMilli;
    const avg = nextAverage({
      onHandMilli: heldBefore,
      avgCostPoisha: updated.avgCostPoisha,
      receivedMilli: qtyMilli,
      receivedUnitCostPoisha: unitCostPoisha,
    });
    if (avg !== updated.avgCostPoisha) {
      await Supply.updateOne({ _id: supplyId }, { $set: { avgCostPoisha: avg } }, { session });
      updated.avgCostPoisha = avg;
    }
  }

  try {
    const [movement] = await StockMovement.create(
      [
        {
          supply: supplyId,
          seq: updated.movementSeq,
          kind,
          qtyMilli,
          onHandAfterMilli: updated.onHandMilli,
          // A take is valued at the average; a receipt at what was just paid.
          unitCostPoisha: qtyMilli < 0 ? unitCostPoisha || updated.avgCostPoisha : unitCostPoisha,
          idempotencyKey,
          refType,
          refId,
          reversalOf,
          isEstimated,
          businessDate: businessDate(date),
          note,
          createdBy,
        },
      ],
      { session }
    );
    return movement;
  } catch (err) {
    if (err && err.code === 11000) {
      throw conflict('SUPPLY_MOVEMENT_DUPLICATE', 'This movement was already posted, please refresh');
    }
    throw err;
  }
}

/** Goods arriving from a purchase, valued at their landed cost. */
function receive(session, { supply, qtyMilli, landedUnitCostPoisha, purchaseId, createdBy, date }) {
  return postMovement(session, {
    supply,
    kind: MOVEMENT_KIND.PURCHASE,
    qtyMilli: Math.abs(qtyMilli),
    unitCostPoisha: landedUnitCostPoisha,
    idempotencyKey: keys.purchase(purchaseId, supply._id || supply),
    refType: 'purchase',
    refId: purchaseId,
    createdBy,
    date,
  });
}

/**
 * Packaging used by an order that has gone out, worked out from the variant
 * recipes. Always `isEstimated`, and never guarded: see the note at the top.
 */
function consume(session, { supply, qtyMilli, unitCostPoisha, orderId, note, createdBy, date }) {
  return postMovement(session, {
    supply,
    kind: MOVEMENT_KIND.CONSUMED,
    qtyMilli: -Math.abs(qtyMilli),
    unitCostPoisha,
    idempotencyKey: keys.consume(orderId, supply._id || supply),
    refType: 'order',
    refId: orderId,
    isEstimated: true,
    allowNegative: true,
    note,
    createdBy,
    date,
  });
}

/**
 * A movement the owner typed: an opening balance, breakage, a loss, or a
 * correction. Counted, never estimated — a person looked at the shelf.
 *
 * @param {string} nonce Makes the key unique. The caller supplies it so a
 *   double-submitted form cannot post the same adjustment twice.
 */
function adjust(session, { supply, kind, qtyMilli, nonce, note, createdBy, date, allowNegative = true }) {
  return postMovement(session, {
    supply,
    kind,
    qtyMilli,
    idempotencyKey: keys.manual(nonce),
    refType: 'manual',
    isEstimated: false,
    allowNegative,
    note,
    createdBy,
    date,
  });
}

/**
 * Undoes a movement with an opposite one. The original is never touched.
 *
 * The reversal of a receipt does not restore the previous average cost, and
 * cannot: the average is a running figure with no memory, and movements posted
 * after the one being undone were valued at the blended rate. Cancelling a
 * purchase therefore leaves the average slightly off until the next receipt
 * re-anchors it. This is a known and accepted imprecision of weighted average
 * costing, chosen over a lot-tracking model in docs/adr/0023; a stock take is the
 * remedy if it ever matters.
 */
function reverse(session, movement, { reason, note, createdBy }) {
  if (!movement) throw notFound('Original movement not found');

  return postMovement(session, {
    supply: movement.supply,
    kind: MOVEMENT_KIND.REVERSAL,
    qtyMilli: -movement.qtyMilli,
    unitCostPoisha: movement.unitCostPoisha,
    idempotencyKey: keys.reversal(movement._id, reason),
    refType: movement.refType,
    refId: movement.refId,
    reversalOf: movement._id,
    isEstimated: movement.isEstimated,
    note: note || `Reversal of ${movement.kind}`,
    createdBy,
  });
}

/**
 * A **stock take**: the owner counted the shelf and this is the real number.
 *
 * Posts only the difference, and nothing at all when the count already agrees —
 * a movement of zero is not a fact, and the append-only log should not fill with
 * confirmations that nothing was wrong.
 *
 * This is the only thing that corrects a drifting packaging recipe, which is why
 * it is `isEstimated: false` and why the variance report can tell the two apart.
 */
async function stockTake(session, { supply, countedMilli, nonce, note, createdBy, date }) {
  if (!Number.isSafeInteger(countedMilli) || countedMilli < 0) {
    throw badRequest('INVALID_QUANTITY', 'A counted quantity must be a whole number, not negative');
  }

  const supplyId = supply._id || supply;
  const doc = await Supply.findById(supplyId).session(session);
  if (!doc) throw notFound('Supply not found');

  const deltaMilli = countedMilli - doc.onHandMilli;
  if (deltaMilli === 0) return null;

  return postMovement(session, {
    supply: supplyId,
    kind: MOVEMENT_KIND.ADJUSTMENT,
    qtyMilli: deltaMilli,
    // Valued at the current average whichever way it goes: a stock take finds
    // units, it does not buy them at a new price.
    unitCostPoisha: doc.avgCostPoisha,
    idempotencyKey: keys.manual(nonce),
    refType: 'manual',
    isEstimated: false,
    note: note || `Stock take: counted ${countedMilli / 1000} ${doc.unit}`,
    createdBy,
    date,
  });
}

/** Sums the movements for a supply. The source of truth; on-hand is the cache. */
async function computeOnHand(supplyId) {
  const [row] = await StockMovement.aggregate([
    { $match: { supply: supplyId } },
    { $group: { _id: null, total: { $sum: '$qtyMilli' }, count: { $sum: 1 } } },
  ]);
  return { onHandMilli: row ? row.total : 0, movements: row ? row.count : 0 };
}

/**
 * Verifies one supply end to end: the running count is consistent for every
 * consecutive movement, the sequence has no gaps, and the total matches the
 * denormalised on-hand.
 */
async function reconcile(supplyId) {
  const supply = await Supply.findById(supplyId);
  if (!supply) throw notFound('Supply not found');

  const movements = await StockMovement.find({ supply: supplyId }).sort({ seq: 1 }).lean();

  const problems = [];
  let running = 0;

  movements.forEach((m, i) => {
    running += m.qtyMilli;
    if (m.seq !== i + 1) problems.push(`Movement ${m._id} has seq ${m.seq}, expected ${i + 1}`);
    if (m.onHandAfterMilli !== running) {
      problems.push(
        `Movement ${m._id} records on hand ${m.onHandAfterMilli}, running total is ${running}`
      );
    }
  });

  if (running !== supply.onHandMilli) {
    problems.push(`Movements total ${running} but supply on hand is ${supply.onHandMilli}`);
  }

  return {
    supply: supplyId,
    ok: problems.length === 0,
    movementTotalMilli: running,
    supplyOnHandMilli: supply.onHandMilli,
    movements: movements.length,
    problems,
  };
}

const RECONCILE_BATCH = 50;

/** Reconciles every supply, a batch at a time. Run by the nightly job. */
async function reconcileAll({ batchSize = RECONCILE_BATCH } = {}) {
  const drifted = [];
  let checked = 0;
  let batch = [];

  const flush = async () => {
    const results = await Promise.all(batch.map((id) => reconcile(id)));
    checked += results.length;
    results.filter((r) => !r.ok).forEach((r) => drifted.push(r));
    batch = [];
  };

  const cursor = Supply.find({}, { _id: 1 }).sort({ _id: 1 }).lean().cursor();
  for await (const supply of cursor) {
    batch.push(supply._id);
    // eslint-disable-next-line no-await-in-loop
    if (batch.length >= batchSize) await flush();
  }
  if (batch.length > 0) await flush();

  return { checked, drifted };
}

/**
 * How well the recipes have been predicting reality, per supply, over a range.
 *
 * Estimated consumption against counted corrections. A recipe that understates
 * shows up as counted adjustments that keep going negative: the shelf held less
 * than the books thought, so more was really used than the recipe claimed.
 *
 * Reads the `{ supply, isEstimated, businessDate }` index. See
 * `domain/packaging.js` → `recipeAccuracy` for what the numbers mean.
 */
async function variance({ from, to, supplyId = null } = {}) {
  const match = {};
  if (supplyId) match.supply = supplyId;
  if (from || to) {
    match.businessDate = {};
    if (from) match.businessDate.$gte = from;
    if (to) match.businessDate.$lte = to;
  }

  return StockMovement.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$supply',
        estimatedMilli: {
          $sum: { $cond: [{ $eq: ['$isEstimated', true] }, '$qtyMilli', 0] },
        },
        countedAdjustmentMilli: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$isEstimated', false] },
                  { $eq: ['$kind', MOVEMENT_KIND.ADJUSTMENT] },
                ],
              },
              '$qtyMilli',
              0,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

module.exports = {
  keys,
  postMovement,
  receive,
  consume,
  adjust,
  reverse,
  stockTake,
  computeOnHand,
  reconcile,
  reconcileAll,
  variance,
};
