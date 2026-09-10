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

function orderSearchFilter(term) {
  const trimmed = (term || '').trim();
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

  return { $or: or };
}

module.exports = { orderSearchFilter, escapeRegex };
