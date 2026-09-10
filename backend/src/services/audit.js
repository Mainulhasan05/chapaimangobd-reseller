'use strict';

const AuditLog = require('../models/AuditLog');

/**
 * Never throws. An audit write failing must not roll back the thing being audited,
 * and must not turn a successful business action into a 500 for the user.
 */
async function record({ actor, action, targetType, targetId, before, after, ip }) {
  try {
    await AuditLog.create({ actor, action, targetType, targetId, before, after, ip });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record', action, err.message);
  }
}

/** Reduces a mongoose document to the fields worth keeping in a before/after pair. */
function snapshot(doc, fields) {
  if (!doc) return null;
  const out = {};
  fields.forEach((f) => {
    const value = f.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), doc);
    if (value !== undefined) out[f] = value;
  });
  return out;
}

module.exports = { record, snapshot };
