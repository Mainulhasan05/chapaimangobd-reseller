'use strict';

require('dotenv').config();

const { connect } = require('../src/config/db');
const customers = require('../src/services/customers');

/**
 * Rebuilds every customer record from the orders collection.
 *
 * Run it once after deploying customer tracking, so that orders placed before
 * it existed are counted. It is also safe to run at any time: the records are a
 * projection of the orders, so this simply recomputes them, and if the two ever
 * disagree the orders are the ones that are right.
 *
 *   npm run rebuild:customers
 */
async function main() {
  await connect();
  // eslint-disable-next-line no-console
  console.log('[db] connected');

  const started = Date.now();
  const result = await customers.rebuild({
    // eslint-disable-next-line no-console
    onProgress: (n) => console.log(`[customers] ${n} orders replayed`),
  });

  // eslint-disable-next-line no-console
  console.log(
    `[customers] rebuilt ${result.customers} customers from ${result.orders} orders ` +
      `in ${Math.round((Date.now() - started) / 1000)}s`
  );
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[customers] rebuild failed');
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
