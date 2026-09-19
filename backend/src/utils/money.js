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

/**
 * A line total for whole boxes at a price per box.
 *
 * There is nothing to round: a box count is an integer and so is the price, so
 * this exists to say that out loud and to keep the poisha check, rather than
 * having call sites multiply two numbers and hope. See docs/adr/0021.
 */
function boxTotalPoisha(boxPricePoisha, boxes) {
  assertPoisha(boxPricePoisha, 'boxPrice');
  if (!Number.isInteger(boxes) || boxes < 1) {
    throw badRequest('INVALID_QUANTITY', 'quantity must be a whole number of boxes');
  }
  return boxPricePoisha * boxes;
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
  boxTotalPoisha,
  formatTakaPlain,
  isSafeMoney,
};
