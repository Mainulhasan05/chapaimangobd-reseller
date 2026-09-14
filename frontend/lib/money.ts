import { t, type DictKey } from './i18n/bn';

/**
 * The largest taka amount any money field accepts. Matches the API's own
 * ceiling, so a value the form lets through is never refused for size.
 */
export const MONEY_MAX_TAKA = 10_000_000;

/** A taka amount as typed: Latin digits, an optional point and at most two decimals. */
const MONEY_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

export type MoneyCheck = { ok: true; value: number } | { ok: false; error: string };

/**
 * Validates a money field before it is sent.
 *
 * The API validates again and is the authority; this exists so a mistyped
 * amount is caught next to the field, in Bengali, before anything moves. Latin
 * digits only, because the value is parsed back with `Number`, and `১০০` is not
 * a number to it. No sign, no exponent, and no third decimal: a poisha is the
 * smallest unit there is.
 */
export function checkMoney(
  raw: string | number,
  { allowZero = false, max = MONEY_MAX_TAKA }: { allowZero?: boolean; max?: number } = {}
): MoneyCheck {
  const text = String(raw).trim();
  const fail = (key: DictKey): MoneyCheck => ({ ok: false, error: t(key) });

  if (text === '') return fail('money.required');
  if (!MONEY_PATTERN.test(text)) return fail('money.invalid');

  const value = Number(text);
  if (!Number.isFinite(value)) return fail('money.invalid');
  if (allowZero ? value < 0 : value <= 0) return fail(allowZero ? 'money.invalid' : 'money.positive');
  if (value > max) return fail(max < MONEY_MAX_TAKA ? 'money.overAvailable' : 'money.tooLarge');

  return { ok: true, value };
}

/** The error to show under a field, or undefined while it is still empty. */
export function moneyError(
  raw: string,
  options?: { allowZero?: boolean; max?: number }
): string | undefined {
  if (raw.trim() === '') return undefined;
  const result = checkMoney(raw, options);
  return result.ok ? undefined : result.error;
}
