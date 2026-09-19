'use strict';

const mongoose = require('mongoose');
const { UNITS } = require('../utils/quantity');
const { isSafeMoney } = require('../utils/money');
const { MAX_VARIANTS } = require('../domain/variants');
const publicImageSchema = require('./publicImage');

const money = (opts = {}) => ({
  type: Number,
  validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
  ...opts,
});

/**
 * One box a product is sold in: a six-kilo box, an eleven-kilo box.
 *
 * The price lives here and not on the product, because a box is what is bought
 * and the two sizes are not two quantities of one thing at one rate. The `_id`
 * is referenced by an order line and by a reseller's price row, so it is stable
 * for the life of the box and a box is archived rather than deleted once it has
 * been ordered. See domain/variants.js and docs/adr/0021.
 */
const variantSchema = new mongoose.Schema(
  {
    // The owner's own name for it. Blank means the derived one, which is the
    // content and the unit: "6 kg".
    label: { type: String, trim: true, maxlength: 60 },

    // How much is in the box, in the product's unit, in milli-units.
    contentMilli: { type: Number, required: true, min: 1 },

    // Per box, both of them. Not per kilo.
    costPricePoisha: money({ required: true, min: 0 }),
    maxSellPricePoisha: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || isSafeMoney(v),
        message: '{PATH} must be a whole number of poisha',
      },
    },

    /*
     * Whole boxes, and only read while the product tracks stock. A count, not a
     * weight: boxes are counted in a godown, and the six-kilo boxes running out
     * must not stop the eleven-kilo ones going out.
     */
    stockQty: { type: Number, default: 0, min: 0 },

    // A box the owner has stopped offering. Never deleted once ordered: an
    // order line holds this id, and the pick list groups by it.
    isAvailable: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    nameBn: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, maxlength: 2000 },
    /*
     * Public photographs, hosted off-box. Product images used to be an R2 key
     * and nothing else; they are now the shared shape, so a row written before
     * ImgBB still renders. See models/publicImage.js.
     */
    images: [publicImageSchema],

    /*
     * The unit a box's contents are measured in. The product has no price and no
     * quantity rules of its own any more: both belong to a box. See
     * domain/variants.js.
     */
    unit: { type: String, enum: UNITS, required: true },

    variants: {
      type: [variantSchema],
      validate: [
        {
          validator: (v) => v.length > 0,
          message: 'A product needs at least one box',
        },
        {
          validator: (v) => v.length <= MAX_VARIANTS,
          message: `A product can have at most ${MAX_VARIANTS} boxes`,
        },
      ],
    },

    // Unlimited stock is this flag being false, never a null quantity:
    // $inc on null errors, and null-or-missing filters do not use an index.
    // The count itself is per box, on the variant.
    trackStock: { type: Boolean, default: false },

    isAvailable: { type: Boolean, default: true },
    /*
     * A product has no source. Which orchard a crate is collected from is
     * decided per order, at accept, and lives on the order line: the product is
     * fixed and the source is not. See the `source` field on Order's line item.
     */
    isArchived: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

productSchema.index({ isArchived: 1, isAvailable: 1, sortOrder: 1 });
// An order line names a variant; this is how it is found again.
productSchema.index({ 'variants._id': 1 });

module.exports = mongoose.model('Product', productSchema);
