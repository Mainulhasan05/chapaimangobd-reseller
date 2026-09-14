'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

const { logger } = require('../config/logger');
const JobLock = require('../models/JobLock');

/**
 * A MongoDB lock per job, so enabling RUN_JOBS on every instance still runs each
 * job once. See docs/adr/0012. A Redis implementation would replace these two
 * functions and nothing else.
 */

const PROCESS_ID = `${os.hostname()}:${process.pid}`;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Takes the lock in one atomic operation, or returns null.
 *
 * The filter matches only an expired lock (and, with a slot, one whose last
 * finished run was a different occurrence). When nothing matches, the upsert
 * tries to insert a second document with the same unique name and fails with
 * a duplicate key error, which is precisely "somebody else has it".
 */
async function acquire(name, { ttlMs = DEFAULT_TTL_MS, slot = null, now = new Date() } = {}) {
  const owner = `${PROCESS_ID}:${crypto.randomBytes(4).toString('hex')}`;
  const filter = { name, lockedUntil: { $lte: now } };
  if (slot) filter.lastSlot = { $ne: slot };

  try {
    const doc = await JobLock.findOneAndUpdate(
      filter,
      { $set: { lockedUntil: new Date(now.getTime() + ttlMs), owner, lastStartedAt: now } },
      { upsert: true, new: true, lean: true }
    );
    return doc ? owner : null;
  } catch (err) {
    if (err && err.code === 11000) return null;
    throw err;
  }
}

/** Releases only a lock this caller still owns; an expired one may have moved on. */
async function release(name, owner, { slot = null, error = null } = {}) {
  const set = {
    lockedUntil: new Date(),
    lastFinishedAt: new Date(),
    lastError: error ? String(error.message || error).slice(0, 500) : null,
  };
  // A failed run does not claim its slot, so another instance may still try it.
  if (slot && !error) set.lastSlot = slot;
  await JobLock.updateOne({ name, owner }, { $set: set });
}

/**
 * Runs `fn` if and only if this caller wins the lock.
 * Resolves `{ ran: false }` when someone else holds it, otherwise
 * `{ ran: true, result }` or `{ ran: true, error }`. Never throws for a job
 * failure: a scheduler that crashed on one bad night would stop every job.
 */
async function runExclusive(name, fn, { ttlMs, slot } = {}) {
  const owner = await acquire(name, { ttlMs, slot });
  if (!owner) {
    logger.info({ job: name, slot }, 'job: lock held elsewhere, skipping');
    return { ran: false };
  }

  const started = Date.now();
  try {
    const result = await fn();
    await release(name, owner, { slot });
    logger.info({ job: name, slot, ms: Date.now() - started }, 'job: finished');
    return { ran: true, result };
  } catch (error) {
    logger.error({ err: error, job: name, slot }, 'job: failed');
    await release(name, owner, { slot, error }).catch(() => {});
    return { ran: true, error };
  }
}

module.exports = { acquire, release, runExclusive, DEFAULT_TTL_MS };
