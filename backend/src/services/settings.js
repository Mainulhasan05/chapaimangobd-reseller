'use strict';

const Setting = require('../models/Setting');

/**
 * The settings singleton is read on nearly every request, so it is cached in
 * process and invalidated on write. Cache lifetime is short enough that a second
 * app instance converges within a minute.
 */
let cached = null;
let cachedAt = 0;
const TTL_MS = 30 * 1000;

async function getSettings({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < TTL_MS) return cached;

  let doc = await Setting.findOne({ key: 'global' });
  if (!doc) doc = await Setting.create({ key: 'global' });

  cached = doc;
  cachedAt = Date.now();
  return doc;
}

async function updateSettings(patch) {
  const doc = await Setting.findOneAndUpdate(
    { key: 'global' },
    { $set: patch },
    { new: true, upsert: true }
  );
  cached = doc;
  cachedAt = Date.now();
  return doc;
}

const clearCache = () => {
  cached = null;
  cachedAt = 0;
};

module.exports = { getSettings, updateSettings, clearCache };
