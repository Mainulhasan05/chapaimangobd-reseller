/**
 * Bangladeshi mobile numbers, on the browser side.
 *
 * The API already normalises and rejects, but a number typed wrong is only
 * discovered on submit, which on a customer-facing order form is the worst place
 * to learn it. This is the same rule stated early enough to be useful, and it
 * never disagrees with the server: anything this calls valid, `normalizeBdPhone`
 * accepts.
 *
 * A local number is eleven digits, `01` followed by an operator digit in 3 to 9
 * and eight more. Grameenphone is 017 and 013, Robi 018 and 016, Banglalink 019
 * and 014, Airtel 016, Teletalk 015. There is no 010, 011 or 012.
 */

export const PHONE_LENGTH = 11;

const BENGALI_ZERO = 0x09e6;

/**
 * Bengali digits to Latin.
 *
 * A Bengali keyboard is the default on many of these phones, so ০১৭ is what
 * actually arrives in the field. Left alone it reaches `parseFloat` as NaN and
 * the server as a number it cannot parse, which is the same class of bug
 * `lib/format.ts` exists to prevent on the way out.
 */
export function toLatinDigits(input: string): string {
  return input.replace(/[০-৯]/g, (digit) =>
    String(digit.charCodeAt(0) - BENGALI_ZERO)
  );
}

/**
 * Everything a person might paste, reduced to at most eleven local digits.
 *
 * Handles `+8801712345678`, `8801712345678` and `1712345678`, because all three
 * are what people copy out of their own contacts app.
 */
export function normalizeBdPhoneInput(input: string): string {
  let digits = toLatinDigits(input).replace(/\D/g, '');

  // Country code, with or without the plus that has already been stripped.
  if (digits.startsWith('880')) digits = digits.slice(3);

  // A number written without its leading zero, as it appears after +880.
  if (digits.length > 0 && digits[0] !== '0') digits = `0${digits}`;

  return digits.slice(0, PHONE_LENGTH);
}

export function isValidBdPhone(digits: string): boolean {
  return /^01[3-9]\d{8}$/.test(digits);
}

/** Why a number is not yet valid, or null once it is. */
export type PhoneProblem = 'empty' | 'incomplete' | 'prefix' | null;

export function phoneProblem(digits: string): PhoneProblem {
  if (digits.length === 0) return 'empty';
  if (digits.length < PHONE_LENGTH) return 'incomplete';
  // Full length but wrong network prefix, which is the typo people actually make.
  return isValidBdPhone(digits) ? null : 'prefix';
}
