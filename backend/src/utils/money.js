'use strict';

const { badRequest } = require('./errors');

/**
 * All money in this system is an integer count of poisha. One taka is 100 poisha.
 * Nothing outside this module performs arithmetic on money. See docs/adr/0001.
 */

const POISHA_PER_TAKA = 100;

/** Convert a taka amount from the API boundary into integer poisha. */
function toPoisha(taka, field = 'amount') {
  const n = typeof taka === 'string' ? Number(taka) : taka;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw badRequest('INVALID_AMOUNT', `${field} must be a number`);
  }
  // Math.round, never Math.trunc: 12.345 taka must not silently become 12.34.
  const poisha = Math.round(n * POISHA_PER_TAKA);
  assertPoisha(poisha, field);
  return poisha;
}

/** Convert integer poisha back to a taka number for the API boundary. */
function toTaka(poisha) {
  assertPoisha(poisha);
  return poisha / POISHA_PER_TAKA;
}

function assertPoisha(value, field = 'amount') {
  if (!Number.isSafeInteger(value)) {
    throw badRequest('INVALID_AMOUNT', `${field} must be a whole number of poisha`);
  }
  return value;
}

/**
 * The single rounding rule for the whole system.
 * An order total is the sum of already-rounded line totals, never a rounded sum.
 */
function lineTotalPoisha(unitPricePoisha, qtyMilli) {
  assertPoisha(unitPricePoisha, 'unitPrice');
  if (!Number.isSafeInteger(qtyMilli)) {
    throw badRequest('INVALID_QUANTITY', 'quantity must be a whole number of milli-units');
  }
  return Math.round((unitPricePoisha * qtyMilli) / 1000);
}

/** Format poisha for display with Latin digits. Never used for values parsed back. */
function formatTakaPlain(poisha) {
  return (poisha / POISHA_PER_TAKA).toFixed(2);
}

const isSafeMoney = (v) => Number.isSafeInteger(v);

module.exports = {
  POISHA_PER_TAKA,
  toPoisha,
  toTaka,
  assertPoisha,
  lineTotalPoisha,
  formatTakaPlain,
  isSafeMoney,
};
