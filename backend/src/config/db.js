'use strict';

const mongoose = require('mongoose');
const env = require('./env');

// With plain JavaScript there is no compile-time protection, so a mistyped field
// in a filter would otherwise match every document.
mongoose.set('strictQuery', true);

async function connect(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, {
    // Never build indexes on boot in production: it blocks on large collections.
    autoIndex: !env.isProd,
    serverSelectionTimeoutMS: 10000,
  });

  await assertTransactionSupport();
  return mongoose.connection;
}

/**
 * Multi-document transactions require a replica set. A standalone mongod fails at
 * exactly the moment the money code runs, and the tempting fix at that point is to
 * delete the transaction. Fail loudly at boot instead.
 */
async function assertTransactionSupport() {
  const admin = mongoose.connection.db.admin();
  let info;
  try {
    info = await admin.command({ hello: 1 });
  } catch {
    return; // Permission to run hello is not guaranteed; do not block boot on it.
  }
  const isReplicaSet = Boolean(info.setName);
  const isSharded = info.msg === 'isdbgrid';

  if (!isReplicaSet && !isSharded) {
    throw new Error(
      [
        'MongoDB is running as a standalone server, which cannot run transactions.',
        'The ledger requires them. Start a single-node replica set instead:',
        '',
        '  mongod --replSet rs0 --dbpath ./data --bind_ip 127.0.0.1',
        '  mongosh --eval "rs.initiate({_id:\'rs0\',members:[{_id:0,host:\'127.0.0.1:27017\'}]})"',
        '',
        'Then set MONGODB_URI to include ?replicaSet=rs0&directConnection=true',
        'Or point MONGODB_URI at a MongoDB Atlas cluster, which is already a replica set.',
      ].join('\n')
    );
  }
}

const disconnect = () => mongoose.disconnect();

module.exports = { connect, disconnect, assertTransactionSupport };
