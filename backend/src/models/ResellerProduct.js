'use strict';

const mongoose = require('mongoose');
const { isSafeMoney } = require('../utils/money');

/**
 * One reseller's activation of one product. A separate collection rather than an
 * array on Product: an array would serialise every catalog read, make concurrent
 * price edits conflict, and eventually hit the 16 MB document limit.
 *
 * A product reaches a public form only through a listed row here.
 */

/**
 * This reseller's price for one of the product's boxes.
 *
 * An array here, unlike the resellers-on-a-product case above, because a product
 * has a handful of boxes and this reseller reads and writes all of their prices
 * in one go: it is one row on one screen. A box with no entry has no price and
 * is therefore not on sale in this shop, which is how a reseller who wants to
 * carry only the six-kilo box says so.
 *
 * See domain/variants.js and docs/adr/0021.
 */
const variantPriceSchema = new mongoose.Schema(
  {
    // The `_id` of a variant on the Product. Not a ref: it is a subdocument.
    variant: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Per box.
    sellPricePoisha: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },
    /*
     * The "was" price a landing page strikes through, beside the sell price.
     * Optional, and only ever shown when it is above the sell price: a regular
     * price at or below what the customer pays is not a discount, and printing
     * one would be a false claim on the reseller's own page.
     */
    regularPricePoisha: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator: (v) => v == null || isSafeMoney(v),
        message: '{PATH} must be a whole number of poisha',
      },
    },
    // A box this reseller has taken off their own form while keeping its price.
    isListed: { type: Boolean, default: true },
  },
  { _id: false }
);

const resellerProductSchema = new mongoose.Schema(
  {
    reseller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResellerProfile',
      required: true,
      index: true,
    },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },

    /*
     * A price per box. At least one, because a listing with no priced box is a
     * product that cannot be ordered and should not be a row at all.
     */
    variants: {
      type: [variantPriceSchema],
      validate: {
        validator: (v) => v.length > 0,
        message: 'Price at least one box',
      },
    },

    // The price is still stored, only withheld from the public response body.
    // Product-wide: it is how the shopfront is drawn, not a fact about one box.
    hidePrice: { type: Boolean, default: false },
    isListed: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

resellerProductSchema.index({ reseller: 1, product: 1 }, { unique: true });
resellerProductSchema.index({ reseller: 1, isListed: 1 });

module.exports = mongoose.model('ResellerProduct', resellerProductSchema);
