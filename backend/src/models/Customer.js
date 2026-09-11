'use strict';

const mongoose = require('mongoose');
const { isSafeMoney } = require('../utils/money');

/**
 * One buyer, recognised across every order they have ever placed.
 *
 * A customer has no account and never logs in, so there was nothing tying their
 * orders together. The phone number is what actually identifies a person here:
 * it is already normalised to E.164 before an order is written, so 01712345678
 * and +8801712345678 are one buyer and always were. Names are not identity. The
 * same person orders for themselves on Monday and for their brother on Friday,
 * from the same phone, under a different name and to a different address, and
 * every one of those is the same customer placing their second order.
 *
 * So the names and addresses are a history rather than a field. Each variant is
 * kept with how often it was used and when it was last seen, which is what lets
 * the owner look at a number and see that it has ordered eleven times under
 * four names.
 *
 * This document is a projection of the orders collection, not a source of
 * truth. Orders are the truth; every number here is derived from them and can
 * be rebuilt at any time with `scripts/rebuild-customers.js`. That is why
 * writing it is never allowed to fail an order: a lost aggregate is recomputed,
 * a lost order is gone.
 */

/** One value this number has used, with how often and when it was last seen. */
const variantSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, maxlength: 500 },
    count: { type: Number, default: 1, min: 1 },
    firstUsedAt: { type: Date },
    lastUsedAt: { type: Date },
  },
  { _id: false }
);

const money = () => ({
  type: Number,
  default: 0,
  validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
});

const customerSchema = new mongoose.Schema(
  {
    // The identity. Normalised before it ever reaches here; see utils/phone.js.
    phoneE164: { type: String, required: true, unique: true, index: true },

    /*
     * Every name and address this number has ordered under, most used first.
     * Capped when written rather than here, because a schema cannot express
     * "keep the twenty most frequent" and an unbounded array on a busy number
     * is how a document walks into the 16MB limit.
     */
    names: [variantSchema],
    addresses: [variantSchema],
    /** Other numbers given as an alternate contact on this buyer's orders. */
    altPhones: [{ type: String }],

    orderCount: { type: Number, default: 0, min: 0 },
    /*
     * Outcomes, counted separately from the total.
     *
     * A number that orders ten times and refuses six on delivery is not a good
     * customer, and on cash on delivery that is the owner paying a courier six
     * times for nothing. It is the single most useful thing this record knows,
     * and it cannot be seen from an order count alone.
     */
    deliveredCount: { type: Number, default: 0, min: 0 },
    cancelledCount: { type: Number, default: 0, min: 0 },
    returnedCount: { type: Number, default: 0, min: 0 },

    // Counted on delivered orders only, so it is money actually collected
    // rather than money once hoped for.
    totalSpendPoisha: money(),

    firstOrderAt: { type: Date },
    lastOrderAt: { type: Date },

    /*
     * Which shops this number has bought from. The owner sees this; a reseller
     * never does, and their own view of a customer is computed from their own
     * orders alone. One reseller must not learn what a buyer spends at another.
     */
    resellers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile' }],
  },
  { timestamps: true }
);

// The owner's list is sorted by who ordered most recently, and searched by name.
customerSchema.index({ lastOrderAt: -1 });
customerSchema.index({ 'names.value': 1 });

module.exports = mongoose.model('Customer', customerSchema);
