'use strict';

const mongoose = require('mongoose');
const { KYC_STATUS, values } = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');
const publicImageSchema = require('./publicImage');

const money = (def = 0) => ({
  type: Number,
  default: def,
  validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
});

const resellerProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    shopName: { type: String, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, index: true },
    /*
     * The shop's picture, shown on a public form to a customer who is not
     * logged in. `logoUrl` is what every reader renders and stays a plain
     * string; `logo` carries what is needed to replace or detach the image and
     * is only read by the upload endpoint.
     */
    logoUrl: { type: String },
    logo: { type: publicImageSchema, default: null },
    address: { type: String, maxlength: 500 },

    kycStatus: {
      type: String,
      enum: values(KYC_STATUS),
      default: KYC_STATUS.NOT_SUBMITTED,
      index: true,
    },

    // Net position with the owner. Negative means the reseller owes.
    // Only services/ledger.js may change this. See docs/adr/0002.
    balancePoisha: money(0),
    creditLimitPoisha: money(0),
    // Monotonic, gap-free counter incremented in the same atomic op as the balance.
    ledgerSeq: { type: Number, default: 0 },

    smsCredits: { type: Number, default: 0, min: 0 },
    formActive: { type: Boolean, default: false },

    channelPrefs: {
      webPush: { type: Boolean, default: true },
      telegram: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

/** The public form is live only when KYC passed and the reseller enabled it. */
resellerProfileSchema.virtual('isFormLive').get(function isFormLive() {
  return this.kycStatus === KYC_STATUS.APPROVED && this.formActive;
});

module.exports = mongoose.model('ResellerProfile', resellerProfileSchema);
