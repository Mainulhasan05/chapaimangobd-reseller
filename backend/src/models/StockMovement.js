'use strict';

const mongoose = require('mongoose');
const { MOVEMENT_KIND, values } = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');

const APPEND_ONLY_MESSAGE =
  'StockMovement is append-only: post a correcting movement instead of editing history';

/**
 * One immutable change to a supply's on-hand count.
 *
 * Append-only, for the same reason `LedgerEntry` is: the owner's question is
 * never only "how many crates are there" but "where did four hundred go", and a
 * number that is overwritten cannot answer the second one. A recount is a new
 * `ADJUSTMENT`, not an edit; a purchase entered twice is fixed by cancelling
 * one, not by subtracting.
 *
 * See docs/adr/0022 and docs/adr/0026.
 */
const stockMovementSchema = new mongoose.Schema(
  {
    supply: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supply',
      required: true,
      index: true,
    },
    // Monotonic and gap-free per supply, produced by the same atomic operation
    // that moved the count.
    seq: { type: Number, required: true },

    kind: { type: String, enum: values(MOVEMENT_KIND), required: true },

    // Signed: negative takes from the shelf, positive adds to it. The sign is
    // the direction and the kind is the reason.
    qtyMilli: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isSafeInteger(v) && v !== 0,
        message: 'qtyMilli must be a non-zero whole number of milli-units',
      },
    },
    // Deliberately unbounded below: consumption may take a supply negative
    // rather than refuse to record a parcel that has genuinely gone out. See
    // docs/adr/0026.
    onHandAfterMilli: { type: Number, required: true },

    /*
     * Whether this quantity was **worked out** or **counted**.
     *
     * A consumption posted when a parcel is delivered or returned is an estimate:
     * it comes from the variant's packaging recipe, which says an eleven-kilo box
     * takes about one and a half sheets of কাগজ. Nobody counted the sheets. A
     * stock take, where the owner counts the shelf and enters the real number, is
     * not an estimate.
     *
     * Recorded rather than assumed, because the two must be told apart to be
     * useful: the recipe is only worth trusting if the counted corrections can be
     * compared against what the estimates predicted. That comparison is the
     * variance report, and it is how the owner finds out the recipe says 1.5
     * sheets when the shelf says 1.8. See docs/adr/0026.
     */
    isEstimated: { type: Boolean, default: false },

    /*
     * What these units were worth, per ONE whole unit. On a receipt it is the
     * landed cost just paid; on a consumption it is the average at that moment.
     * Snapshotted so a later purchase at a different rate cannot restate what
     * last week's packing cost.
     */
    unitCostPoisha: {
      type: Number,
      default: 0,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },

    // Deterministic. The unique index is what makes a double consumption
    // structurally impossible, independent of any status guard above it.
    idempotencyKey: { type: String, required: true },

    refType: { type: String, enum: ['purchase', 'order', 'manual'], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId },

    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'StockMovement', default: null },

    // Dhaka calendar date, denormalised so "what went out today" is an index
    // scan, exactly as on Order.
    businessDate: { type: String, required: true, index: true },

    note: { type: String, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockMovementSchema.index({ supply: 1, seq: 1 }, { unique: true });
stockMovementSchema.index({ supply: 1, createdAt: -1 });
stockMovementSchema.index({ idempotencyKey: 1 }, { unique: true });
stockMovementSchema.index({ refType: 1, refId: 1 });
stockMovementSchema.index({ businessDate: 1, kind: 1 });
// The variance report: estimated consumption against counted corrections, per
// supply, over a range.
stockMovementSchema.index({ supply: 1, isEstimated: 1, businessDate: 1 });

// Append-only enforced by the model rather than by discipline, so a future
// controller cannot quietly rewrite a count.
const MUTATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

MUTATIONS.forEach((op) => {
  stockMovementSchema.pre(op, function refuseMutation(next) {
    next(new Error(APPEND_ONLY_MESSAGE));
  });
});

stockMovementSchema.pre('save', function refuseRewrite(next) {
  if (!this.isNew) return next(new Error(APPEND_ONLY_MESSAGE));
  return next();
});

module.exports = mongoose.model('StockMovement', stockMovementSchema);
module.exports.APPEND_ONLY_MESSAGE = APPEND_ONLY_MESSAGE;
