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
const resellerProductSchema = new mongoose.Schema(
  {
    reseller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResellerProfile',
      required: true,
      index: true,
    },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sellPricePoisha: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },
    // The price is still stored, only withheld from the public response body.
    hidePrice: { type: Boolean, default: false },
    isListed: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

resellerProductSchema.index({ reseller: 1, product: 1 }, { unique: true });
resellerProductSchema.index({ reseller: 1, isListed: 1 });

module.exports = mongoose.model('ResellerProduct', resellerProductSchema);
