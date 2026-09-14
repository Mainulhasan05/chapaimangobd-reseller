'use strict';

/**
 * The GSM 03.38 alphabet, and what a text costs in it.
 *
 * A message written entirely in this alphabet is billed at 160 characters a
 * segment; one character outside it, a Bengali letter or a curly quote pasted
 * from a phone keyboard, turns the whole message into UCS-2 at 70. That is why
 * customer SMS templates are held to it (docs/adr/0013) and why the preview
 * counts the way the gateway bills rather than the way `String.length` counts.
 *
 * `frontend/lib/gsm7.ts` is a port of this file. Keep the two in step: the
 * owner's live counter and the server's validation must agree to the character.
 */

/* The basic table. Each of these is one septet. */
const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/* The extension table. Each costs two septets: an escape, then the character. */
const EXTENDED = '^{}\\[~]|€\f';

const BASIC_SET = new Set(BASIC);
const EXTENDED_SET = new Set(EXTENDED);

const SINGLE_SEGMENT = 160;
const MULTI_SEGMENT = 153;
const UNICODE_SINGLE = 70;
const UNICODE_MULTI = 67;

const isGsm7Char = (ch) => BASIC_SET.has(ch) || EXTENDED_SET.has(ch);

/** True when every character of `text` is in the GSM-7 alphabet. */
function isGsm7(text) {
  for (const ch of String(text ?? '')) {
    if (!isGsm7Char(ch)) return false;
  }
  return true;
}

/** The characters that are not GSM-7, each once, in order of appearance. */
function invalidChars(text) {
  const seen = new Set();
  for (const ch of String(text ?? '')) {
    if (!isGsm7Char(ch)) seen.add(ch);
  }
  return [...seen];
}

/** Septets used, counting an extension character as two. Only meaningful for GSM-7 text. */
function septets(text) {
  let count = 0;
  for (const ch of String(text ?? '')) count += EXTENDED_SET.has(ch) ? 2 : 1;
  return count;
}

/**
 * How the gateway will bill `text`.
 *
 * GSM-7: 160 septets fit one segment; a longer message carries a header in every
 * part and fits 153 each. Anything else is UCS-2: 70, then 67 per part, counted
 * in UTF-16 code units, which is what `String.length` already is.
 */
function measure(text) {
  const value = String(text ?? '');
  if (isGsm7(value)) {
    const chars = septets(value);
    const segments = chars <= SINGLE_SEGMENT ? 1 : Math.ceil(chars / MULTI_SEGMENT);
    return { encoding: 'GSM-7', chars, segments: Math.max(1, segments) };
  }
  const chars = value.length;
  const segments = chars <= UNICODE_SINGLE ? 1 : Math.ceil(chars / UNICODE_MULTI);
  return { encoding: 'UCS-2', chars, segments: Math.max(1, segments) };
}

/**
 * Makes an arbitrary value safe to drop into a GSM-7 message.
 *
 * Accents are folded first (NFKD, then the combining marks dropped), typographic
 * punctuation is mapped to its plain form, and whatever is still outside the
 * alphabet is removed. Returns the cleaned string and how much of the original's
 * letters survived, so a caller can tell "Rahim Traders" (all of it) from
 * "রহিম ট্রেডার্স" (none of it) and pick a fallback instead of printing debris.
 */
const PUNCTUATION = new Map([
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  ['–', '-'],
  ['—', '-'],
  ['…', '...'],
  [' ', ' '],
  ['৳', 'Tk'],
]);

function sanitize(value) {
  const original = String(value ?? '');
  let out = '';
  for (const raw of original.normalize('NFC')) {
    // A character already in the alphabet is kept as it is (é stays é); only
    // the rest are folded, so "Zoë" becomes "Zoe" rather than "Zo".
    const candidates = BASIC_SET.has(raw)
      ? raw
      : PUNCTUATION.get(raw) ?? raw.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    for (const ch of candidates) {
      // Newlines and the extension characters are legal but have no place
      // inside a substituted name; they would break the sentence around it.
      if (BASIC_SET.has(ch) && ch !== '\n' && ch !== '\r') out += ch;
    }
  }
  out = out.replace(/\s+/g, ' ').trim();

  const lettersIn = (original.match(/\p{L}/gu) || []).length;
  const lettersOut = (out.match(/\p{L}/gu) || []).length;
  const kept = lettersIn === 0 ? (out ? 1 : 0) : lettersOut / lettersIn;

  return { text: out, kept };
}

module.exports = {
  BASIC,
  EXTENDED,
  SINGLE_SEGMENT,
  MULTI_SEGMENT,
  isGsm7,
  invalidChars,
  septets,
  measure,
  sanitize,
};
