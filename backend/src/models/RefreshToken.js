'use strict';

const mongoose = require('mongoose');

/**
 * Refresh tokens rotate. Each device gets a family; using a token that has already
 * been rotated means it was stolen, so the whole family is revoked. Rotation is
 * per family so a reseller's phone and laptop do not log each other out.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String },
  },
  { timestamps: true }
);

// Expired rows are useless; let Mongo reap them.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
