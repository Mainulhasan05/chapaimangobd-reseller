'use strict';

const mongoose = require('mongoose');
const { KYC_STATUS, values } = require('../domain/constants');
const { kycBlocks } = require('../domain/kyc');
const { isSafeMoney } = require('../utils/money');
const publicImageSchema = require('./publicImage');
const {
  TEMPLATES: LANDING_TEMPLATES,
  DEFAULT_TEMPLATE: DEFAULT_LANDING_TEMPLATE,
} = require('../domain/landing');

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

    /*
     * Which design the public page is drawn with. Only the design: the content
     * is the owner's and the contact details above are the reseller's own. See
     * domain/landing.js.
     */
    landingTemplate: {
      type: String,
      enum: Object.values(LANDING_TEMPLATES),
      default: DEFAULT_LANDING_TEMPLATE,
    },

    /*
     * Whether the owner has asked this reseller to verify their identity.
     *
     * Off for everyone until the owner turns it on, one reseller at a time.
     * While it is off the KYC module is not on their screens at all and nothing
     * is gated by it: a national ID is not the price of opening an account, it
     * is something the owner asks for when they have a reason to. Read it
     * through domain/kyc.js, never directly. See docs/adr/0017.
     */
    kycRequired: { type: Boolean, default: false, index: true },

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
    /*
     * What `formActive` was when the owner deactivated the reseller, so that
     * reactivating puts the shop back exactly as the reseller left it rather
     * than opening a form they had closed. Null while the account is active.
     * See docs/adr/0011 and services/resellerLifecycle.js.
     */
    formActiveBeforeDeactivation: { type: Boolean, default: null },

    channelPrefs: {
      webPush: { type: Boolean, default: true },
      telegram: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

/** The public form is live when the reseller enabled it and no KYC gate holds it shut. */
resellerProfileSchema.virtual('isFormLive').get(function isFormLive() {
  return !kycBlocks(this) && this.formActive;
});

module.exports = mongoose.model('ResellerProfile', resellerProfileSchema);
