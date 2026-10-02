'use strict';

/**
 * The free text search behind the order lists.
 *
 * A reseller with a customer on the phone knows one of three things: the order
 * code they were read out, the customer's name, or the number they are calling
 * from. All three go in the same box, because asking someone to pick a field
 * first is asking them to think about the database.
 *
 * Returns null for an empty term so the caller can spread it unconditionally.
 */

/** A user typed string reaching `new RegExp` is an injection unless escaped. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bengali digits to Latin ones. A phone keyboard set to Bangla types ০১৭১২,
 * every code and phone number is stored in Latin digits, and a search box that
 * finds nothing for the number the customer just read out is a search box that
 * is wrong, not a user who typed it wrong.
 */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function toLatinDigits(value) {
  return String(value).replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/**
 * `resellerIds` are the shops whose name matched the term, looked up by the
 * caller (see utils/orderFilter.js), because finding them is a query and this
 * function builds a filter without asking the database anything.
 */
function orderSearchFilter(term, { resellerIds = [] } = {}) {
  const trimmed = toLatinDigits(term || '').trim();
  if (!trimmed) return null;

  const escaped = escapeRegex(trimmed);

  // Anchored, because an order code is short and a contains-match over every
  // code is a collection scan that returns noise.
  const or = [
    { orderCode: new RegExp(`^${escaped}`, 'i') },
    { 'customer.name': new RegExp(escaped, 'i') },
  ];

  /*
   * Phones are stored E.164 but nobody types +880. Matching the tail lets
   * 01712345678, 1712345678 and 712345678 all find +8801712345678. Four digits
   * is the floor: fewer matches most of the collection.
   */
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 4) {
    or.push({ 'customer.phoneE164': new RegExp(`${escapeRegex(digits)}$`) });
  }

  /*
   * The courier's number, read off the slip or a courier's SMS when a customer
   * rings asking where their parcel is. Not anchored, since people quote the
   * tail of a long number as often as its head, and held to the same four
   * character floor as a phone for the same reason.
   */
  if (trimmed.length >= 4) {
    or.push({ 'courier.trackingNumber': new RegExp(escaped, 'i') });
  }

  if (resellerIds.length > 0) or.push({ reseller: { $in: resellerIds } });

  return { $or: or };
}

module.exports = { orderSearchFilter, escapeRegex, toLatinDigits };
