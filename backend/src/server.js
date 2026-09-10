'use strict';

const env = require('./config/env');
const { connect } = require('./config/db');
const app = require('./app');
const { startOutboxWorker } = require('./services/outbox');

async function main() {
  await connect();
  // eslint-disable-next-line no-console
  console.log('[db] connected');

  startOutboxWorker();

  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[boot] failed to start');
  // eslint-disable-next-line no-console
  console.error(err.message);
  process.exit(1);
});
