'use strict';

const mongoose = require('mongoose');

/**
 * One document per scheduled job. Whoever moves `lockedUntil` into the future
 * first runs the job; everyone else skips. The lock expires on its own, so a
 * process killed mid-job does not block the next day's run. See docs/adr/0012.
 *
 * `lastSlot` is the scheduled occurrence that last finished, e.g.
 * `2026-09-14T09:00`. Two instances whose timers fire a few milliseconds apart
 * would otherwise run the digest twice, one after the other, each holding the
 * lock in turn.
 */
const jobLockSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    lockedUntil: { type: Date, default: () => new Date(0) },
    owner: { type: String, default: null },
    lastSlot: { type: String, default: null },
    lastStartedAt: { type: Date, default: null },
    lastFinishedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.model('JobLock', jobLockSchema);
