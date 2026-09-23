'use strict';

const { ALLOCATION_BASIS, CHARGE_PAID_TO } = require('./constants');
const { assertPoisha } = require('../utils/money');

/**
 * What a purchase actually cost, per unit. "Koto kore porlo".
 *
 * The rate paid for the goods is not what they cost. A hundred crates bought at
 * 80 taka with 600 taka of van hire and 200 taka of loading cost 88 taka each,
 * and 88 is the number the owner wants when they ask what a crate costs. That
 * number is the **landed cost**, and this module is the only place it is worked
 * out.
 *
 * Everything here is pure: integers in, integers out, no database, no clock.
 * See docs/adr/0023.
 */

/**
 * Charges are spread across lines by **largest remainder**.
 *
 * The naive way is to multiply each line's share and round it, which loses or
 * invents a poisha whenever the shares do not divide evenly: three lines
 * splitting 100 poisha equally round to 33 each and the purchase quietly becomes
 * a poisha cheaper than what was paid. Here every line gets the floor of its
 * exact share, and the poisha left over go one each to the lines with the
 * largest discarded fraction. The shares then sum to the charge exactly, always,
 * which is the only property that matters: the books are worth nothing if
 * `sum(lines) !== total`.
 *
 * Ties break toward the earlier line, so the result is deterministic and a
 * purchase re-costed from the same input is identical.
 */
function allocateByWeight(totalPoisha, weights) {
  const count = weights.length;
  if (count === 0) return [];

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Nothing to divide by. Splitting evenly is the only honest answer, and it
  // still has to add up, so it goes through the same remainder pass.
  if (totalWeight <= 0) {
    return allocateByWeight(totalPoisha, new Array(count).fill(1));
  }

  const shares = [];
  let distributed = 0;

  for (let i = 0; i < count; i += 1) {
    // Exact numerator, floored. Integer arithmetic throughout: the product can
    // exceed 2^32 but stays a safe integer for any purchase a person will type.
    const exact = (totalPoisha * weights[i]) / totalWeight;
    const floor = Math.floor(exact);
    shares.push({ index: i, amount: floor, remainder: exact - floor });
    distributed += floor;
  }

  let left = totalPoisha - distributed;

  // Largest discarded fraction first, earlier line wins a tie.
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; left > 0 && i < order.length; i += 1) {
    order[i].amount += 1;
    left -= 1;
  }

  return shares.map((s) => s.amount);
}

/** What a charge weighs on, given the basis the purchase was recorded with. */
function weightsFor(lines, basis) {
  if (basis === ALLOCATION_BASIS.QUANTITY) return lines.map((l) => l.qtyMilli);
  return lines.map((l) => l.lineCostPoisha);
}

/**
 * The whole costing of one purchase, from raw lines and charges.
 *
 * A charge is allocated when `allocate` is not explicitly false: the default is
 * that an extra cost is part of what the goods cost, because that is true of
 * nearly all of them. A charge marked not to allocate still counts toward the
 * purchase total and toward a payee's due; it simply does not raise the per-unit
 * cost of the goods.
 *
 * `paidTo` is a separate axis and does not touch the allocation at all. Whether
 * the van driver was paid in cash at the gate changes who is owed, not what the
 * crates cost.
 *
 * @param {Array<{ qtyMilli: number, unitCostPoisha: number }>} rawLines
 * @param {Array<{ amountPoisha: number, allocate?: boolean, paidTo?: string }>} rawCharges
 * @param {string} basis One of ALLOCATION_BASIS.
 */
function costPurchase(rawLines, rawCharges = [], basis = ALLOCATION_BASIS.VALUE) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error('costPurchase needs at least one line');
  }

  const lines = rawLines.map((line) => {
    assertPoisha(line.unitCostPoisha, 'unitCostPoisha');
    if (!Number.isSafeInteger(line.qtyMilli) || line.qtyMilli <= 0) {
      throw new Error('costPurchase needs a positive whole qtyMilli on every line');
    }
    // The rate is per whole unit and the quantity is in milli-units, so this is
    // the one rounding in the goods cost. Same rule as an order line.
    return { ...line, lineCostPoisha: Math.round((line.unitCostPoisha * line.qtyMilli) / 1000) };
  });

  const charges = rawCharges.map((charge) => {
    assertPoisha(charge.amountPoisha, 'amountPoisha');
    if (charge.amountPoisha < 0) throw new Error('A purchase charge cannot be negative');
    return {
      ...charge,
      allocate: charge.allocate !== false,
      paidTo: charge.paidTo || CHARGE_PAID_TO.PAYEE,
    };
  });

  const allocatablePoisha = charges
    .filter((c) => c.allocate)
    .reduce((sum, c) => sum + c.amountPoisha, 0);

  const shares = allocateByWeight(allocatablePoisha, weightsFor(lines, basis));

  const costedLines = lines.map((line, i) => {
    const allocatedChargePoisha = shares[i];
    const landedLineCostPoisha = line.lineCostPoisha + allocatedChargePoisha;
    return {
      ...line,
      allocatedChargePoisha,
      landedLineCostPoisha,
      // Back to a per-unit figure, which is what a shelf label and an average
      // cost are both stated in. Rounded once, here, and never recomputed from
      // the rounded value.
      landedUnitCostPoisha: Math.round((landedLineCostPoisha * 1000) / line.qtyMilli),
    };
  });

  const goodsCostPoisha = costedLines.reduce((sum, l) => sum + l.lineCostPoisha, 0);
  const chargeTotalPoisha = charges.reduce((sum, c) => sum + c.amountPoisha, 0);
  const payeeChargePoisha = charges
    .filter((c) => c.paidTo === CHARGE_PAID_TO.PAYEE)
    .reduce((sum, c) => sum + c.amountPoisha, 0);

  return {
    lines: costedLines,
    charges,
    goodsCostPoisha,
    chargeTotalPoisha,
    // What reaches the payee's ledger. Deliberately not the total: see
    // PLAN-3 decision 6.
    payeeTotalPoisha: goodsCostPoisha + payeeChargePoisha,
    otherChargePoisha: chargeTotalPoisha - payeeChargePoisha,
    totalPoisha: goodsCostPoisha + chargeTotalPoisha,
  };
}

module.exports = { allocateByWeight, costPurchase };
