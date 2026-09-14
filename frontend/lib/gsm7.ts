/**
 * The GSM 03.38 alphabet, and what a text costs in it.
 *
 * A port of `backend/src/utils/gsm7.js`. Keep the two in step: the owner's live
 * counter on the settings page must agree to the character with the server's
 * template validation and with the preview a modal shows.
 */

const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/* Each of these costs two septets: an escape, then the character. */
const EXTENDED = '^{}\\[~]|€\f';

const BASIC_SET = new Set(BASIC);
const EXTENDED_SET = new Set(EXTENDED);

export const SINGLE_SEGMENT = 160;
export const MULTI_SEGMENT = 153;

const isGsm7Char = (ch: string) => BASIC_SET.has(ch) || EXTENDED_SET.has(ch);

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!isGsm7Char(ch)) return false;
  }
  return true;
}

/** The characters that are not GSM-7, each once, in order of appearance. */
export function invalidChars(text: string): string[] {
  const seen = new Set<string>();
  for (const ch of text) {
    if (!isGsm7Char(ch)) seen.add(ch);
  }
  return [...seen];
}

export type SmsMeasure = { encoding: 'GSM-7' | 'UCS-2'; chars: number; segments: number };

/** How the gateway bills `text`: 160 then 153 per part in GSM-7, 70 then 67 otherwise. */
export function measure(text: string): SmsMeasure {
  if (isGsm7(text)) {
    let chars = 0;
    for (const ch of text) chars += EXTENDED_SET.has(ch) ? 2 : 1;
    const segments = chars <= SINGLE_SEGMENT ? 1 : Math.ceil(chars / MULTI_SEGMENT);
    return { encoding: 'GSM-7', chars, segments: Math.max(1, segments) };
  }
  const chars = text.length;
  const segments = chars <= 70 ? 1 : Math.ceil(chars / 67);
  return { encoding: 'UCS-2', chars, segments: Math.max(1, segments) };
}
