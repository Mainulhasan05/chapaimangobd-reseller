'use strict';

const rateLimit = require('express-rate-limit');
const RateLimitHit = require('../models/RateLimitHit');

/**
 * Rate-limit counters in MongoDB, so a second API instance shares every limit
 * instead of silently doubling it. See docs/adr/0012.
 *
 * Implements the express-rate-limit v7 `Store` interface. Swapping to Redis
 * later is a new class with these five methods and nothing else changes.
 */
class MongoRateLimitStore {
  /**
   * @param {object} opts
   * @param {string} opts.prefix  namespaces this limiter's keys. Required, and
   *   unique per limiter: two limiters on one route count the same client
   *   separately, and express-rate-limit refuses a double count on one key.
   */
  constructor({ prefix, windowMs } = {}) {
    if (!prefix) throw new Error('MongoRateLimitStore needs a prefix');
    this.prefix = `${prefix}:`;
    this.windowMs = windowMs || 60 * 1000;
    // Keys counted here are visible to every instance.
    this.localKeys = false;
  }

  init(options) {
    if (options && options.windowMs) this.windowMs = options.windowMs;
  }

  get collection() {
    return RateLimitHit.collection;
  }

  keyFor(key) {
    return `${this.prefix}${key}`;
  }

  async get(key) {
    const doc = await this.collection.findOne({
      key: this.keyFor(key),
      resetAt: { $gt: new Date() },
    });
    return doc ? { totalHits: doc.count, resetTime: doc.resetAt } : undefined;
  }

  /**
   * One round trip, atomic. The pipeline reads the stored window and either
   * adds one to it or, if it has ended (or never existed), starts a fresh one.
   * A missing `resetAt` sorts below any date, so an upserted document takes the
   * "expired" branch without a separate insert.
   */
  async increment(key) {
    const now = new Date();
    const expired = { $lte: ['$resetAt', now] };
    const update = [
      {
        $set: {
          count: { $cond: [expired, 1, { $add: ['$count', 1] }] },
          resetAt: { $cond: [expired, new Date(now.getTime() + this.windowMs), '$resetAt'] },
        },
      },
    ];

    const run = () =>
      this.collection.findOneAndUpdate({ key: this.keyFor(key) }, update, {
        upsert: true,
        returnDocument: 'after',
      });

    let doc;
    try {
      doc = await run();
    } catch (err) {
      // Two first hits racing on the unique key: one insert wins, the other
      // retries as an ordinary increment.
      if (err && err.code === 11000) doc = await run();
      else throw err;
    }

    return { totalHits: doc.count, resetTime: doc.resetAt };
  }

  async decrement(key) {
    await this.collection.updateOne(
      { key: this.keyFor(key), resetAt: { $gt: new Date() }, count: { $gt: 0 } },
      { $inc: { count: -1 } }
    );
  }

  async resetKey(key) {
    await this.collection.deleteOne({ key: this.keyFor(key) });
  }

  async resetAll() {
    const escaped = this.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await this.collection.deleteMany({ key: { $regex: `^${escaped}` } });
  }
}

const limitMessage = (message) => ({
  ok: false,
  error: { code: 'RATE_LIMITED', message },
});

/**
 * Every limiter in the API is built here, so none can quietly fall back to the
 * per-process memory store. `name` becomes the key prefix and must be unique.
 */
function createLimiter({ name, windowMs, limit, message = 'Too many requests', keyGenerator, skip }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    ...(skip ? { skip } : {}),
    store: new MongoRateLimitStore({ prefix: `rl:${name}`, windowMs }),
    message: limitMessage(message),
  });
}

module.exports = { MongoRateLimitStore, createLimiter, limitMessage };
