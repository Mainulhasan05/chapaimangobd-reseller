'use strict';

const env = require('../config/env');
const { logger } = require('../config/logger');
const { runExclusive } = require('./lock');
const { scheduleDaily } = require('./scheduler');
const { nightlyReconcile } = require('./nightlyReconcile');
const { dailyDigest } = require('./dailyDigest');
const { kycPurge } = require('./kycPurge');

/**
 * Scheduled work. Runs only in a process started with RUN_JOBS=true, and each
 * run takes a MongoDB lock for its slot, so enabling it everywhere still runs
 * each job once. Tests call the job functions directly. See docs/adr/0012.
 */
const JOBS = [
  { name: 'nightlyReconcile', at: { hour: 2, minute: 0 }, run: nightlyReconcile },
  { name: 'kycPurge', at: { hour: 3, minute: 0 }, run: kycPurge },
  { name: 'dailyDigest', at: { hour: 9, minute: 0 }, run: dailyDigest },
];

let handles = [];

/** Runs one job now, under its lock. For an owner-triggered or manual run. */
const runJob = (job, { slot } = {}) => runExclusive(job.name, () => job.run(), { slot });

function startJobs({ force = false } = {}) {
  if (!env.runJobs && !force) {
    logger.info('jobs: RUN_JOBS is not set, scheduled jobs disabled in this process');
    return false;
  }
  if (handles.length > 0) return true;

  handles = JOBS.map((job) => scheduleDaily(job.at, (slot) => runJob(job, { slot })));
  logger.info({ jobs: JOBS.map((j) => j.name) }, 'jobs: scheduled');
  return true;
}

/** Stops the timers and waits for any job in progress to finish. */
async function stopJobs() {
  const stopping = handles.map((h) => h.stop());
  handles = [];
  await Promise.all(stopping);
}

module.exports = { JOBS, startJobs, stopJobs, runJob };
