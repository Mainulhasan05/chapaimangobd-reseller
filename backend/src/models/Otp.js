'use strict';

const mongoose = require('mongoose');
const { OTP_PURPOSE, values } = require('../domain/constants');

/**
 * One one-time code sent by SMS. See docs/adr/0014 and services/otp.js.
 *
 * The code itself is never stored, only an HMAC of it, so a copy of this
 * collection is not a list of working codes. A row is live while it is neither
 * consumed nor voided and `expiresAt` is in the future; everything else about it
 * is history.
 */
const otpSchema = new mongoose.Schema(
  {
    phoneE164: { type: String, required: true },
    purpose: { type: String, enum: values(OTP_PURPOSE), required: true },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    /** Set when a newer code replaced this one, or the wrong-attempt cap was hit. */
    voidedAt: { type: Date, default: null },
    /** The account the code is bound to, when one already exists. */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /*
     * For the owner's new-device sign-in: the hash of the random challenge id
     * handed to the browser after the password check. Proves the code is being
     * redeemed by whoever passed that check, not by someone guessing ids.
     */
    challengeHash: { type: String, default: null, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

otpSchema.index({ phoneE164: 1, purpose: 1, createdAt: -1 });
otpSchema.index({ challengeHash: 1 }, { sparse: true });
/*
 * Kept an hour past expiry rather than reaped the moment it expires, so a row
 * still says what happened when someone asks why a code did not work.
 */
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 });

module.exports = mongoose.model('Otp', otpSchema);
