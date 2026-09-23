'use strict';

const { MILLI } = require('../utils/quantity');
const { badRequest } = require('../utils/errors');

/**
 * What packing a box consumes.
 *
 * A **packaging recipe** lives on a **variant**, not on a product, because the
 * box is the thing that gets packed. Sending an eleven-kilo box of mangoes takes
 * one ক্যারেট, some sheets of কাগজ and a সুই to stitch it; a six-kilo box takes
 * less of each. The recipe is that list, per one box.
 *
 * **The recipe is an estimate and the system never pretends otherwise.**
 *
 * Nobody counts sheets of paper into a crate. The owner knows an eleven-kilo box
 * takes "about one and a half sheets", and that is a real, useful number: over
 * four hundred parcels it predicts the paper bill closely, and it is the only
 * way to get a per-order packaging cost without somebody tallying stationery at
 * a packing table. What it is not is a measurement, so:
 *
 * - every movement it produces is flagged `isEstimated`, and
 * - the truth is a **stock take**: the owner counts the shelf and the difference
 *   posts as a counted adjustment.
 *
 * The gap between the two is the useful output. If a month of estimates says 600
 * sheets and the stock takes keep correcting downwards, the recipe is wrong and
 * the variance report is what says so. An estimate nobody ever checks would
 * quietly drift; an estimate that is checked gets better. See docs/adr/0026.
 *
 * The recipe is read exactly once in an order's life, at the moment the parcel's
 * fate is settled — **deliver** or **return** — and what it produced is
 * snapshotted onto the line. It is never read again, so correcting the recipe
 * tomorrow cannot change what last week's order cost. See docs/adr/0026.
 *
 * Pure. No database: the caller has already loaded the product and the supplies.
 */

/** How many different supplies one box may consume. Six is already a long list. */
const MAX_RECIPE_ROWS = 6;

/**
 * Checks a recipe the owner has typed.
 *
 * Duplicates are refused rather than added together, for the same reason two
 * boxes of one product may not hold the same amount: a repeat is the owner
 * having picked the same supply twice, and silently summing them would hide
 * whichever quantity was typed second.
 */
function assertRecipe(rows, field = 'packaging') {
  if (!Array.isArray(rows) || rows.length === 0) return;

  if (rows.length > MAX_RECIPE_ROWS) {
    const message = `A box can use at most ${MAX_RECIPE_ROWS} different supplies`;
    throw badRequest('TOO_MANY_PACKAGING_ROWS', message, { [field]: message });
  }

  const seen = new Set();
  rows.forEach((row, index) => {
    if (!Number.isSafeInteger(row.qtyMilli) || row.qtyMilli < 1) {
      const message = 'Use more than nothing of a supply, or remove it';
      throw badRequest('INVALID_QUANTITY', message, { [`${field}.${index}.qty`]: message });
    }
    const key = String(row.supply);
    if (seen.has(key)) {
      const message = 'This supply is already on the list for this box';
      throw badRequest('DUPLICATE_PACKAGING_ROW', message, {
        [`${field}.${index}.supply`]: message,
      });
    }
    seen.add(key);
  });
}

/**
 * What one line consumes, expanded from its variant's recipe.
 *
 * Returns an empty array for a variant with no recipe, which is what every
 * variant written before this feature existed has, and for a line with no
 * variant, which is what every order written before boxes existed has. Both mean
 * "nothing is counted here", and neither is an error: a system that refused to
 * pack an order because it predates a feature would be broken by its own history.
 *
 * @param {object|null} variant The variant, or null.
 * @param {number} boxes How many boxes of it this line carries.
 * @returns {Array<{ supply, qtyMilli }>} One row per supply, quantity for the
 *   whole line. Never a zero or negative quantity.
 */
function expand(variant, boxes) {
  if (!variant || !Array.isArray(variant.packaging) || variant.packaging.length === 0) return [];
  if (!Number.isInteger(boxes) || boxes < 1) return [];

  return variant.packaging
    .filter((row) => row && row.supply && row.qtyMilli > 0)
    .map((row) => ({ supply: row.supply, qtyMilli: row.qtyMilli * boxes }));
}

/**
 * Everything an order consumes, rolled up per supply.
 *
 * Rolled up rather than left per line because stock moves per supply: a six-kilo
 * box and an eleven-kilo box in one order that both take a ক্যারেট are one
 * movement of two, not two movements of one. The per-line detail is still
 * written to the lines themselves, which is where a cost has to sit.
 *
 * @param {Array<{ variant, qty }>} lines Order lines.
 * @param {(variantId) => object|null} lookup Resolves a line's variant.
 * @returns {Array<{ supply, qtyMilli }>}
 */
function forOrder(lines, lookup) {
  const totals = new Map();

  lines.forEach((line) => {
    expand(lookup(line.variant), line.qty).forEach((row) => {
      const key = String(row.supply);
      const seen = totals.get(key);
      if (seen) seen.qtyMilli += row.qtyMilli;
      else totals.set(key, { supply: row.supply, qtyMilli: row.qtyMilli });
    });
  });

  return [...totals.values()];
}

/**
 * The snapshot rows for one line: what it consumed and what that was worth at
 * the moment the parcel's fate was settled.
 *
 * @param {Array<{ supply, qtyMilli }>} rows From `expand`.
 * @param {(supplyId) => object|null} lookup Resolves the supply, for its name
 *   and its average cost right now.
 */
function snapshot(rows, lookup) {
  return rows.map((row) => {
    const supply = lookup(row.supply) || {};
    const unitCostPoisha = supply.avgCostPoisha || 0;
    return {
      supply: row.supply,
      supplyNameBn: supply.nameBn || '',
      qtyMilli: row.qtyMilli,
      unitCostPoisha,
      costPoisha: Math.round((row.qtyMilli * unitCostPoisha) / MILLI),
    };
  });
}

/** What a set of snapshot rows cost together. */
function totalCostPoisha(rows) {
  return (rows || []).reduce((sum, row) => sum + (row.costPoisha || 0), 0);
}

/**
 * What packing this order is expected to take, before anybody packs it.
 *
 * The same arithmetic as the real thing, run early and stored nowhere, so the
 * owner can see "এই অর্ডার প্যাক করলে: ২ ক্যারেট, ৩ শিট কাগজ, ২ সুই — ২৫০ টাকা"
 * on the order screen and find out about a supply that has run out before
 * standing at the packing table. Every figure is marked estimated, because it is.
 *
 * Shown from accept onwards, long before anything is deducted: the deduction
 * waits for the parcel to arrive, but the owner needs the number while there is
 * still time to buy more কাগজ.
 *
 * @returns {{ rows, totalCostPoisha, isEstimated, shortages }} `shortages` names
 *   the supplies the shelf cannot currently cover. It is information, never a
 *   refusal: a short count does not block a pack (docs/adr/0026).
 */
function estimateForOrder(lines, variantLookup, supplyLookup) {
  const rows = snapshot(forOrder(lines, variantLookup), supplyLookup);

  const shortages = rows
    .map((row) => {
      const supply = supplyLookup(row.supply);
      if (!supply) return null;
      const shortMilli = row.qtyMilli - supply.onHandMilli;
      if (shortMilli <= 0) return null;
      return {
        supply: row.supply,
        supplyNameBn: row.supplyNameBn,
        needMilli: row.qtyMilli,
        onHandMilli: supply.onHandMilli,
        shortMilli,
      };
    })
    .filter(Boolean);

  return {
    rows,
    totalCostPoisha: totalCostPoisha(rows),
    isEstimated: true,
    shortages,
  };
}

/**
 * How well a recipe has been predicting reality, for one supply over a range.
 *
 * `estimatedMilli` is what the recipes said went out. `countedMilli` is what the
 * stock takes had to correct by, signed the way the movements are: negative
 * means the shelf held less than the books thought, so the recipe is
 * **understating** what a box really uses.
 *
 * The ratio is what the owner acts on: 1.2 means every box is actually using
 * about a fifth more than the recipe claims, and the recipe should be raised.
 * Null rather than 1 when there is nothing to compare, because "no evidence" and
 * "no error" are different statements — the same reasoning `complaintRate`
 * already uses for an orchard nobody has bought from.
 */
function recipeAccuracy({ estimatedMilli, countedMilli }) {
  const estimated = Math.abs(estimatedMilli || 0);
  if (estimated === 0) return { estimatedMilli: 0, countedMilli: countedMilli || 0, ratio: null };

  // A negative correction means more was really used than was estimated.
  const actual = estimated - (countedMilli || 0);
  return {
    estimatedMilli: estimated,
    countedMilli: countedMilli || 0,
    actualMilli: actual,
    ratio: actual / estimated,
  };
}

module.exports = {
  MAX_RECIPE_ROWS,
  // Kept under its old name too: the field on the variant is `packaging`.
  MAX_PACKAGING_ROWS: MAX_RECIPE_ROWS,
  assertRecipe,
  expand,
  forOrder,
  snapshot,
  totalCostPoisha,
  estimateForOrder,
  recipeAccuracy,
};
