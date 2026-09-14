'use strict';

const mongoose = require('mongoose');
const { ROLES, values } = require('../domain/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Always E.164. The raw input the user typed is never stored or indexed.
    phoneE164: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: values(ROLES), required: true, index: true },
    isActive: { type: Boolean, default: true },
    // When isActive last went false; null while active. Approved KYC scans are
    // kept for a year from here, then purged. See docs/adr/0016.
    deactivatedAt: { type: Date, default: null },
    lastLoginAt: { type: Date },

    /*
     * Per-account lockout (docs/adr/0014), on top of the per-IP limiter: five
     * wrong passwords inside the window lock the account for fifteen minutes.
     * Both moved only by atomic updates in the auth controller.
     */
    failedLoginCount: { type: Number, default: 0 },
    lastFailedLoginAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },

    /** Set when the owner issued a temporary password; cleared by a password change. */
    mustChangePassword: { type: Boolean, default: false },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.failedLoginCount;
    delete ret.lastFailedLoginAt;
    delete ret.lockedUntil;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
