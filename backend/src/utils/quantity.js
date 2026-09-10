'use strict';

const { badRequest } = require('./errors');

/**
 * Quantity is an integer count of milli-units. 2.5 kg is 2500.
 * Whole-unit products are enforced to a 1000 step so nobody orders half a piece.
 */

const MILLI = 1000;

/** Units that only make sense in whole numbers. */
const WHOLE_UNITS = new Set(['pcs', 'dozen', 'box']);
const UNITS = ['kg', 'gram', 'litre', 'pcs', 'dozen', 'box'];

function toMilli(qty, field = 'quantity') {
  const n = typeof qty === 'string' ? Number(qty) : qty;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw badRequest('INVALID_QUANTITY', `${field} must be a positive number`);
  }
  const milli = Math.round(n * MILLI);
  if (!Number.isSafeInteger(milli)) {
    throw badRequest('INVALID_QUANTITY', `${field} is out of range`);
  }
  return milli;
}

const fromMilli = (milli) => milli / MILLI;

/** The smallest increment a product may be ordered in, given its unit. */
function defaultStepMilli(unit) {
  return WHOLE_UNITS.has(unit) ? MILLI : 250;
}

/**
 * Validates an ordered quantity against the product it belongs to.
 * Returns nothing; throws with a field-level message the UI can show.
 */
function assertOrderable(qtyMilli, { unit, minOrderQtyMilli, qtyStepMilli }, field = 'quantity') {
  const step = qtyStepMilli || defaultStepMilli(unit);

  if (qtyMilli < minOrderQtyMilli) {
    throw badRequest(
      'BELOW_MINIMUM',
      `Minimum order is ${fromMilli(minOrderQtyMilli)} ${unit}`,
      { [field]: `Minimum order is ${fromMilli(minOrderQtyMilli)} ${unit}` }
    );
  }
  if (qtyMilli % step !== 0) {
    throw badRequest('INVALID_STEP', `Quantity must be a multiple of ${fromMilli(step)} ${unit}`, {
      [field]: `Quantity must be a multiple of ${fromMilli(step)} ${unit}`,
    });
  }
}

module.exports = { MILLI, UNITS, WHOLE_UNITS, toMilli, fromMilli, defaultStepMilli, assertOrderable };
