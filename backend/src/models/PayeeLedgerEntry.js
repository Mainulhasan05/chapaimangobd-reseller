'use strict';

const mongoose = require('mongoose');
const { PAYEE_LEDGER_KIND, values } = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');

const APPEND_ONLY_MESSAGE =
  'PayeeLedgerEntry is append-only: post a reversal entry instead of editing history';

/**
 * One immutable movement of what the owner owes a payee.
 *
 * Append-only, never updated, never deleted; a correction is a new entry
 * carrying `reversalOf`. This is the record that settles an argument with a
 * crate seller about whether March was paid, so it must not be editable by
 * anyone, including us. The same promises as `LedgerEntry` and for the same
 * reasons — see docs/adr/0002 and docs/adr/0025.
 *
 * What is deliberately *not* here: any guard. A reseller debit is refused past a
 * credit limit because the owner is extending credit and chooses how much. A
 * payee due is a fact that already happened somewhere else and is merely being
 * written down, and an overpayment is an advance rather than an error. That
 * difference is why this is a separate model and a separate service instead of a
 * flag on the existing ones.
 */
const payeeLedgerEntrySchema = new mongoose.Schema(
  {
    payee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payee',
      required: true,
      index: true,
    },
    // Monotonic and gap-free per payee. Produced by the same atomic operation
    // that moved the due, so it cannot disagree with dueAfterPoisha.
    seq: { type: Number, required: true },

    kind: { type: String, enum: values(PAYEE_LEDGER_KIND), required: true },

    // Signed. Positive increases what the owner owes, negative reduces it. The
    // kind says what happened; the sign says which way it moved.
    amountPoisha: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => isSafeMoney(v) && v !== 0,
        message: 'amountPoisha must be a non-zero whole number of poisha',
      },
    },
    dueAfterPoisha: {
      type: Number,
      required: true,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },

    // Deterministic. The unique index is what makes a double posting
    // structurally impossible, independent of any status guard above it.
    idempotencyKey: { type: String, required: true },

    refType: {
      type: String,
      enum: ['purchase', 'expense', 'payment', 'manual'],
      required: true,
    },
    refId: { type: mongoose.Schema.Types.ObjectId },

    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'PayeeLedgerEntry', default: null },

    note: { type: String, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

payeeLedgerEntrySchema.index({ payee: 1, seq: 1 }, { unique: true });
payeeLedgerEntrySchema.index({ payee: 1, createdAt: -1 });
payeeLedgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
payeeLedgerEntrySchema.index({ refType: 1, refId: 1 });

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
  payeeLedgerEntrySchema.pre(op, function refuseMutation(next) {
    next(new Error(APPEND_ONLY_MESSAGE));
  });
});

payeeLedgerEntrySchema.pre('save', function refuseRewrite(next) {
  if (!this.isNew) return next(new Error(APPEND_ONLY_MESSAGE));
  return next();
});

module.exports = mongoose.model('PayeeLedgerEntry', payeeLedgerEntrySchema);
module.exports.APPEND_ONLY_MESSAGE = APPEND_ONLY_MESSAGE;
