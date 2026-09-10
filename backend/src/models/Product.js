'use strict';

const mongoose = require('mongoose');
const { UNITS } = require('../utils/quantity');
const { isSafeMoney } = require('../utils/money');

const money = (opts = {}) => ({
  type: Number,
  validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
  ...opts,
});

const productSchema = new mongoose.Schema(
  {
    nameBn: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, maxlength: 2000 },
    images: [{ _id: false, url: String, publicId: String }],

    unit: { type: String, enum: UNITS, required: true },
    // Smallest orderable increment, in milli-units. Whole units are 1000.
    qtyStepMilli: { type: Number, required: true, min: 1 },
    minOrderQtyMilli: { type: Number, required: true, min: 1 },

    costPricePoisha: money({ required: true, min: 0 }),
    // Optional ceiling protecting the brand from absurd reseller pricing.
    // Nullable means "no ceiling", so the validator has to accept null as well
    // as an integer; the shared money() validator alone would reject it.
    maxSellPricePoisha: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || isSafeMoney(v),
        message: '{PATH} must be a whole number of poisha',
      },
    },

    // Unlimited stock is this flag being false, never a null quantity:
    // $inc on null errors, and null-or-missing filters do not use an index.
    trackStock: { type: Boolean, default: false },
    stockQtyMilli: { type: Number, default: 0, min: 0 },

    isAvailable: { type: Boolean, default: true },
    source: { type: mongoose.Schema.Types.ObjectId, ref: 'Source' },
    isArchived: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

productSchema.index({ isArchived: 1, isAvailable: 1, sortOrder: 1 });

module.exports = mongoose.model('Product', productSchema);
