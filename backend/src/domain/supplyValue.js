'use strict';

const { MILLI } = require('../utils/quantity');

/**
 * What a supply on the shelf is worth, and what one unit of it cost on average.
 *
 * Valuation is **moving weighted average**, not FIFO. Crates bought at 80 and
 * then at 88 are, from the day the second lot arrives, crates worth something
 * between the two, and the owner counting the pile cannot tell which is which
 * anyway. FIFO would buy precision this business will never read at the price of
 * a whole lot-tracking model. See docs/adr/0023.
 *
 * Everything here is pure. `avgCostPoisha` is per **one whole unit** — per
 * crate, per kilo — while quantities are in milli-units, so the two conversions
 * live here and nowhere else.
 */

/**
 * The new average after a receipt.
 *
 * The weighting is by quantity held, so the old average stops mattering as the
 * old stock runs out. Three cases have to be right and none of them is the
 * formula:
 *
 * - The shelf was empty: the new lot is the whole average, whatever came before.
 * - The shelf was **negative**, which is legal here (docs/adr/0026): more was
 *   consumed than was recorded bought. There is no meaningful old holding to
 *   weight against, so the new lot sets the average outright rather than being
 *   blended with a debt.
 * - The receipt would leave the total at zero or below: nothing sensible to
 *   average, so the old figure stands.
 */
function nextAverage({ onHandMilli, avgCostPoisha, receivedMilli, receivedUnitCostPoisha }) {
  if (!Number.isSafeInteger(receivedMilli) || receivedMilli <= 0) {
    throw new Error('nextAverage needs a positive whole receivedMilli');
  }

  if (onHandMilli <= 0) return receivedUnitCostPoisha;

  const totalMilli = onHandMilli + receivedMilli;
  if (totalMilli <= 0) return avgCostPoisha;

  const heldValue = onHandMilli * avgCostPoisha;
  const receivedValue = receivedMilli * receivedUnitCostPoisha;
  return Math.round((heldValue + receivedValue) / totalMilli);
}

/**
 * What a holding is worth: quantity times the average cost, rounded once.
 *
 * Negative on hand gives a negative value, and that is correct rather than
 * something to clamp: the shelf owes the books, and hiding it behind a zero
 * would make a stock report add up while being wrong.
 */
function holdingValuePoisha(onHandMilli, avgCostPoisha) {
  return Math.round((onHandMilli * avgCostPoisha) / MILLI);
}

/** What a movement of this size is worth at this unit cost. Rounded once. */
function movementValuePoisha(qtyMilli, unitCostPoisha) {
  return Math.round((qtyMilli * unitCostPoisha) / MILLI);
}

/** A supply is worth reordering when it is at or under the level the owner set. */
function isLow(supply) {
  const level = supply.reorderLevelMilli || 0;
  return level > 0 && supply.onHandMilli <= level;
}

module.exports = { nextAverage, holdingValuePoisha, movementValuePoisha, isLow };
