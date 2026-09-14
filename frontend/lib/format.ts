/**
 * Two formatters, distinguished by name, because mixing them corrupts data.
 *
 * Bengali digits (০১২৩) are what a reader expects, and are exactly what must
 * never appear in an input value, a CSV cell, an order code or a phone number:
 * a Bengali-digit string through `parseFloat` is `NaN`.
 */

import { tUnit } from '@/lib/i18n/bn';

const BENGALI = new Intl.NumberFormat('bn-BD', {
  maximumFractionDigits: 2,
});

const LATIN = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  // `10,000` is not a number to an `<input type="number">` or to `Number()`,
  // so a value of a thousand or more rendered as an empty field.
  useGrouping: false,
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
  return `${BENGALI.format(value)} ${tUnit(unit)}`;
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

/**
 * The hour of the day in Dhaka, 0 to 23.
 *
 * Read from the formatter rather than from the device clock, because a reseller
 * whose phone is set to the wrong timezone should still be greeted with the hour
 * their own business is living in.
 */
export function dhakaHour(date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: 'numeric',
    hour12: false,
  }).format(date);
  return Number(hour) % 24;
}

/** A business date string, as the short day-and-month a chart axis wants. */
export function formatDayShort(value: string): string {
  // The string is already a Dhaka calendar date, so it is parsed as local noon
  // to keep a timezone shift from moving it onto the day before.
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'short' }).format(
    new Date(year, month - 1, day, 12)
  );
}

/** The Dhaka calendar date as YYYY-MM-DD, for date range inputs. */
export function businessDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date);
}

/**
 * Today, in Dhaka, as a person would say it: weekday, day, month.
 *
 * The app runs on business dates and half its screens say "today", so the top
 * bar says which day that is. Read from the formatter rather than the device
 * clock, for the same reason `dhakaHour` is: a phone set to the wrong timezone
 * should not quietly move the business into yesterday.
 */
export function formatToday(date = new Date()): string {
  return new Intl.DateTimeFormat('bn-BD', {
    timeZone: 'Asia/Dhaka',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}
