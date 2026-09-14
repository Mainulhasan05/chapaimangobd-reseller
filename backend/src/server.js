'use strict';

const mongoose = require('mongoose');
const env = require('./config/env');
const { logger } = require('./config/logger');
const { connect } = require('./config/db');
const app = require('./app');
const { startOutboxWorker, stopOutboxWorker } = require('./services/outbox');
const { startJobs, stopJobs } = require('./jobs');

// Long enough for an in-flight order confirm to commit, short enough that a
// deploy does not stall waiting on a phone with a dead connection.
const SHUTDOWN_TIMEOUT_MS = 10 * 1000;

let server = null;
let shuttingDown = false;

/**
 * Stops in the reverse order of boot. New connections are refused first, then
 * the background worker, then the database once the last request has finished.
 * A hard timeout guarantees the process leaves even if something hangs, because
 * an orchestrator that sent SIGTERM will send SIGKILL anyway, mid-transaction.
 */
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const force = setTimeout(() => {
    logger.error('shutdown timed out, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  try {
    // Timers stop now; the promise settles once a digest or a send already in
    // progress finishes, which is awaited below, before the database closes.
    const background = Promise.all([stopJobs(), stopOutboxWorker()]);
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
        // Keep-alive sockets otherwise hold server.close open until they idle out.
        if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
      });
    }
    await background;
    await mongoose.disconnect();
    logger.info('shutdown complete');
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    exitCode = 1; // eslint-disable-line no-param-reassign
  }
  clearTimeout(force);
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A forgotten await is a bug to fix, not a reason to drop every live request.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

// After an uncaught exception the process state is unknown. Log, then leave, and
// let the supervisor start a clean one.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  shutdown('uncaughtException', 1);
});

async function main() {
  await connect();
  logger.info('db connected');

  startOutboxWorker();
  // Scheduled jobs only where RUN_JOBS=true. See src/jobs/index.js.
  startJobs();

  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
