'use strict';

/*
 * Must run before anything requires config/env, which validates these at import.
 * dotenv does not overwrite variables that are already set, so these win over .env.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/placeholder';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-long-enough-for-zod';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-long-enough-for-zod';
process.env.COOKIE_SECURE = 'false';
process.env.OWNER_PHONE = '01700000000';
process.env.OWNER_PASSWORD = 'ownerpass123';

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replset = null;

/** Loading every model up front lets us pre-create their collections. */
function loadModels() {
  const dir = path.join(__dirname, '..', '..', 'src', 'models');
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    // eslint-disable-next-line global-require, import/no-dynamic-require
    .forEach((f) => require(path.join(dir, f)));
}

/**
 * A single-member replica set, because transactions do not run on a standalone
 * server and the ledger is built entirely on them. One member is enough and is
 * much faster to start than three.
 */
async function startDb() {
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  await mongoose.connect(replset.getUri(), { dbName: 'test' });
  loadModels();

  // Implicit collection creation is not allowed inside a transaction, so the
  // very first test touching a fresh collection would otherwise fail while a
  // second identical run passed.
  const models = Object.values(mongoose.models);
  await Promise.all(models.map((m) => m.createCollection()));
  await Promise.all(models.map((m) => m.syncIndexes()));
}

async function stopDb() {
  await mongoose.disconnect();
  if (replset) await replset.stop();
  replset = null;
}

/** Empties every collection without dropping indexes. */
async function resetDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  // The settings cache would otherwise hand out a document that no longer exists.
  require('../../src/services/settings').clearCache();
}

module.exports = { startDb, stopDb, resetDb, mongoose };
