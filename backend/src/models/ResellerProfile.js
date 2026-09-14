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
    slug: { type: String, required: true, unique: true },
    /*
     * The shop's picture, shown on a public form to a customer who is not
     * logged in. `logoUrl` is what every reader renders and stays a plain
     * string; `logo` carries what is needed to replace or detach the image and
     * is only read by the upload endpoint.
     */
    logoUrl: { type: String },
    logo: { type: publicImageSchema, default: null },

    /*
     * The shopfront. Everything here is written by the reseller and read by a
     * customer who is not logged in, which is the whole reason it exists: an
     * order form carrying only a name and a price list gives a buyer no way to
     * ask a question and no reason to trust the person taking their money.
     *
     * None of it is required. A reseller who fills in nothing still has a
     * working shop, and every one of these is simply left off the public page
     * when it is blank.
     */

    // The number customers ring. Deliberately not the login phone on the User:
    // one is an account credential and the other is printed on a public page,
    // and a reseller may well want them to be different numbers.
    publicPhone: { type: String, trim: true, maxlength: 20 },
    whatsappNumber: { type: String, trim: true, maxlength: 20 },
    facebookUrl: { type: String, trim: true, maxlength: 300 },

    // A sentence or two about the shop, shown above the products.
    about: { type: String, trim: true, maxlength: 600 },

    /*
     * Where a prepaid customer sends the money. On a prepaid order the customer
     * pays the reseller directly, and without these numbers on the page that
     * conversation happens over the phone every single time.
     */
    payment: {
      bkash: { type: String, trim: true, maxlength: 20 },
      nagad: { type: String, trim: true, maxlength: 20 },
    },
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
