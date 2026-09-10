/**
 * Two formatters, distinguished by name, because mixing them corrupts data.
 *
 * Bengali digits (০১২৩) are what a reader expects, and are exactly what must
 * never appear in an input value, a CSV cell, an order code or a phone number:
 * a Bengali-digit string through `parseFloat` is `NaN`.
 */

const BENGALI = new Intl.NumberFormat('bn-BD', {
  maximumFractionDigits: 2,
});

const LATIN = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

/** Display only. Emits Bengali digits. */
export function formatNumber(value: number): string {
  return BENGALI.format(value);
}

/** Display only. Emits Bengali digits with a taka sign. */
export function formatMoney(value: number): string {
  return `৳${BENGALI.format(value)}`;
}

/**
 * Anything that will be parsed back: input values, exports, copied text.
 * Latin digits, no grouping surprises.
 */
export function formatMoneyPlain(value: number): string {
  return LATIN.format(value);
}

export function formatQuantity(value: number, unit: string): string {
  return `${BENGALI.format(value)} ${unit}`;
}

/** Signed, so a ledger row reads as a movement rather than a total. */
export function formatSignedMoney(value: number): string {
  const sign = value < 0 ? '−' : '+';
  return `${sign}৳${BENGALI.format(Math.abs(value))}`;
}

const DATE = new Intl.DateTimeFormat('bn-BD', {
  timeZone: 'Asia/Dhaka',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DATE_TIME = new Intl.DateTimeFormat('bn-BD', {
  timeZone: 'Asia/Dhaka',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Always rendered in Dhaka time, whatever the viewer device is set to. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return DATE.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return DATE_TIME.format(new Date(value));
}

/** How long ago, in words, for the order aging display. */
export function formatAge(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const hours = Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000);
  if (hours < 1) return 'এইমাত্র';
  if (hours < 24) return `${BENGALI.format(hours)} ঘণ্টা আগে`;
  return `${BENGALI.format(Math.floor(hours / 24))} দিন আগে`;
}

/** The Dhaka calendar date as YYYY-MM-DD, for date range inputs. */
export function businessDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date);
}
