'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { connect } = require('../src/config/db');

/**
 * Makes the database's indexes match the schemas. A mandatory deploy step.
 *
 * Production connects with autoIndex off, because building an index on boot
 * blocks on a large collection. The price is that nothing else ever creates
 * them: without this, the unique index on a ledger idempotency key or a public
 * submission id simply does not exist, and the duplicate it was meant to stop
 * gets written. Run it before starting a new release:
 *
 *   npm run db:sync-indexes
 *
 * It also drops indexes no schema declares any more, and says which. Every
 * collection is created first, because a transaction cannot create one and the
 * first order ever placed would otherwise fail.
 */

// eslint-disable-next-line no-console
const say = (line) => console.log(line);

function loadModels() {
  const dir = path.join(__dirname, '..', 'src', 'models');
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    // eslint-disable-next-line global-require, import/no-dynamic-require
    .forEach((f) => require(path.join(dir, f)));
}

async function main() {
  await connect();
  loadModels();
  say(`[indexes] connected to ${mongoose.connection.name}`);

  const models = Object.values(mongoose.models).sort((a, b) =>
    a.modelName.localeCompare(b.modelName)
  );

  let created = 0;
  let dropped = 0;

  for (const model of models) {
    /* eslint-disable no-await-in-loop */
    await model.createCollection();
    const diff = await model.diffIndexes();
    const droppedNames = await model.syncIndexes();
    /* eslint-enable no-await-in-loop */

    const toCreate = diff.toCreate.map((spec) => JSON.stringify(spec));
    created += toCreate.length;
    dropped += droppedNames.length;

    const changes = [
      ...toCreate.map((s) => `+ ${s}`),
      ...droppedNames.map((name) => `- ${name}`),
    ];
    say(`[indexes] ${model.modelName.padEnd(18)} ${changes.length ? `${changes.length} change(s)` : 'up to date'}`);
    changes.forEach((c) => say(`             ${c}`));
  }

  say(`[indexes] done: ${models.length} models, ${created} created, ${dropped} dropped`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('[indexes] sync failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
