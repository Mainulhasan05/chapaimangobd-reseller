'use strict';

/**
 * The business runs in Asia/Dhaka (UTC+6, no DST). Everything is stored in UTC.
 * Never call setHours(0,0,0,0) on a server date: the server runs in UTC and the
 * first six hours of every Dhaka day would fall on the wrong side of midnight.
 */

const TZ = 'Asia/Dhaka';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Dhaka calendar date as YYYY-MM-DD. Denormalised onto every order. */
function businessDate(date = new Date()) {
  return dateFormatter.format(date);
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * A Dhaka wall-clock timestamp as `YYYY-MM-DD HH:mm:ss`, for people reading a
 * spreadsheet. An ISO string in UTC put every morning entry on the previous day.
 */
function formatDhakaDateTime(date) {
  if (!date) return '';
  const parts = Object.fromEntries(
    dateTimeFormatter.formatToParts(new Date(date)).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** UTC instant of midnight starting the given Dhaka business date. */
function startOfBusinessDay(dateStr) {
  return new Date(`${dateStr}T00:00:00+06:00`);
}

/** UTC instant of midnight ending the given Dhaka business date, exclusive. */
function endOfBusinessDay(dateStr) {
  const start = startOfBusinessDay(dateStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Aging is a wall-clock delta, a different notion from the calendar date.
 * Returns the UTC instant before which an order counts as stale.
 */
function agingCutoff(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

module.exports = {
  TZ,
  businessDate,
  formatDhakaDateTime,
  startOfBusinessDay,
  endOfBusinessDay,
  agingCutoff,
};
