'use strict';

const mongoose = require('mongoose');

/**
 * Runs fn inside a transaction, retrying transient write conflicts.
 *
 * The callback WILL be re-run, so it must be free of side effects: no uploads,
 * no push, no SMS, no counters outside the session. Side effects go to the outbox
 * and are drained after commit.
 *
 * MongoDB defaults a transaction lock request to 5ms, so a contended wallet
 * document gives up almost immediately. The retry loop is mandatory, not optional.
 */
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction };
