'use strict';

const { badRequest } = require('./errors');

/**
 * Phone is identity here, so it is normalised to E.164 before any uniqueness check.
 * 01712345678, 8801712345678, +8801712345678 and +880 1712-345678 are one person.
 * Only the normalised form is ever stored or indexed.
 */

const BD_MOBILE = /^01[3-9]\d{8}$/;

function normalizeBdPhone(input, field = 'phone') {
  if (typeof input !== 'string') {
    throw badRequest('INVALID_PHONE', 'Phone number is required', { [field]: 'Phone number is required' });
  }

  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('880')) digits = digits.slice(3);
  if (digits.startsWith('0') === false && digits.length === 10) digits = `0${digits}`;

  if (!BD_MOBILE.test(digits)) {
    const message = 'Enter a valid Bangladeshi mobile number';
    throw badRequest('INVALID_PHONE', message, { [field]: message });
  }
  return `+880${digits.slice(1)}`;
}

/** The gateway wants the local 01XXXXXXXXX form, not E.164. */
const toLocalBd = (e164) => `0${e164.replace(/^\+880/, '')}`;

const isValidBdPhone = (input) => {
  try {
    normalizeBdPhone(input);
    return true;
  } catch {
    return false;
  }
};

module.exports = { normalizeBdPhone, toLocalBd, isValidBdPhone };
