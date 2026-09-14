'use strict';

const mongoose = require('mongoose');

/**
 * One counter per rate-limit key, shared by every API instance. See docs/adr/0012.
 *
 * Written only through the native driver in services/rateLimitStore.js, with a
 * single atomic pipeline update, so the model exists to declare the collection
 * and its indexes. The TTL index removes a window once it is over; the store
 * does not rely on that for correctness, because the TTL monitor runs about once
 * a minute and an expired counter is simply restarted on the next hit.
 */
const rateLimitHitSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false }
);

rateLimitHitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitHit', rateLimitHitSchema);
