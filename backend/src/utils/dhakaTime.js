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

module.exports = { TZ, businessDate, startOfBusinessDay, endOfBusinessDay, agingCutoff };
