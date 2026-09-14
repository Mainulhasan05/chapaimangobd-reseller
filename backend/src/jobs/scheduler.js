'use strict';

const { businessDate, startOfBusinessDay } = require('../utils/dhakaTime');

/**
 * The smallest scheduler that does the job: a timer to the next Dhaka wall-clock
 * time, re-armed after each run. Dhaka has no daylight saving, so "02:00 every
 * day" is always exactly 24 hours after the last one and no cron library earns
 * its place.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

/** The next instant, strictly after `now`, at which Dhaka's clock reads hour:minute. */
function nextDhakaRun({ hour, minute = 0 }, now = new Date()) {
  const midnight = startOfBusinessDay(businessDate(now)).getTime();
  let at = midnight + (hour * 60 + minute) * 60 * 1000;
  if (at <= now.getTime()) at += DAY_MS;
  return new Date(at);
}

/**
 * Names one scheduled occurrence, e.g. `2026-09-14T09:00`, so two instances
 * whose timers fire moments apart recognise it as the same run.
 */
function slotFor({ hour, minute = 0 }, at) {
  return `${businessDate(at)}T${pad(hour)}:${pad(minute)}`;
}

/**
 * Arms a daily timer. `run(slot)` is awaited before the next timer is set, so a
 * run that overshoots its own interval cannot overlap itself.
 * Returns a handle with `stop()`, which resolves once any run in progress ends.
 */
function scheduleDaily(at, run) {
  let timer = null;
  let inFlight = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    const next = nextDhakaRun(at);
    // setTimeout caps at about 24.8 days; a day is well within it.
    timer = setTimeout(async () => {
      inFlight = Promise.resolve()
        .then(() => run(slotFor(at, next)))
        .catch(() => {})
        .finally(() => {
          inFlight = null;
        });
      await inFlight;
      arm();
    }, Math.max(0, next.getTime() - Date.now()));
    timer.unref();
  };

  arm();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    },
  };
}

module.exports = { nextDhakaRun, slotFor, scheduleDaily, DAY_MS };
