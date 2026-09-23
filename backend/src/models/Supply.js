'use strict';

const mongoose = require('mongoose');
const { UNITS } = require('../utils/quantity');
const { isSafeMoney } = require('../utils/money');

/**
 * Something the business buys and uses up but never sells: a ক্যারেট, a roll of
 * tape, polythene, labels.
 *
 * A **Supply** and a **Product** are deliberately two models. A Product is sold:
 * it has boxes, a cost price and a ceiling, a reseller price row, and a place on
 * a public form. A Supply has none of those and never will, because nobody buys
 * a crate from the shop. Folding them together would mean a Product with half
 * its fields meaningless and a shop query that has to remember to exclude the
 * packaging. See docs/adr/0022.
 *
 * Every supply is stock-tracked. There is no `trackStock` flag here, unlike on
 * Product, because counting it is the entire reason the row exists.
 */
const supplySchema = new mongoose.Schema(
  {
    nameBn: { type: String, required: true, trim: true, maxlength: 160 },
    unit: { type: String, enum: UNITS, required: true },
    note: { type: String, maxlength: 1000 },

    /*
     * How many there are, in milli-units like every other quantity in the
     * system: 340 crates is 340000. Denormalised for query speed and moved only
     * by services/supplyStock.js, exactly as a wallet balance is moved only by
     * the ledger. The movements are the truth and reconciliation asserts they
     * agree.
     *
     * No `min: 0`. A supply may go negative, which means more was consumed than
     * was recorded bought — a fact the owner needs to see rather than one the
     * database should refuse. See docs/adr/0026.
     */
    onHandMilli: { type: Number, default: 0 },

    // Monotonic and gap-free per supply. Produced by the same atomic operation
    // that moved the count, so it cannot disagree with onHandAfterMilli.
    movementSeq: { type: Number, default: 0 },

    /*
     * Moving weighted average landed cost, per ONE whole unit — per crate, per
     * kilo — not per milli. What a consumed unit is valued at. Recomputed on
     * every receipt by domain/supplyValue.js and never edited by hand.
     */
    avgCostPoisha: {
      type: Number,
      default: 0,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },

    // Warn at or below this. Zero means no alert, never null: a null-or-missing
    // filter cannot use an index, the same reasoning as Product.trackStock.
    reorderLevelMilli: { type: Number, default: 0, min: 0 },

    isArchived: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

supplySchema.index({ isArchived: 1, sortOrder: 1, nameBn: 1 });

module.exports = mongoose.model('Supply', supplySchema);
