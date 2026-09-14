'use strict';

const mongoose = require('mongoose');

/**
 * A browser the owner proved, by OTP, to be theirs. For thirty days a sign-in
 * from it needs only the password. See docs/adr/0014.
 *
 * The browser holds a random token in an httpOnly cookie; only its hash is kept
 * here, bound to one user, so a cookie copied from another account's browser
 * matches nothing.
 */
const trustedDeviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

trustedDeviceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TrustedDevice', trustedDeviceSchema);
