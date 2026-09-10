'use strict';

const crypto = require('node:crypto');

/**
 * Order codes are random, never sequential. A sequential code leaks daily volume
 * to anyone who can count, and turns the public lookup into an enumeration oracle.
 * A counter document would also be a global hot spot conflicting with every
 * concurrent confirm, which is exactly what the money transaction cannot afford.
 *
 * Crockford base32 without I, L, O and U: unambiguous when read over the phone.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateOrderCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Accepts what a customer typed: lowercase, spaces, and O/I mistyped for 0/1. */
function normalizeOrderCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

module.exports = { ALPHABET, generateOrderCode, normalizeOrderCode };
