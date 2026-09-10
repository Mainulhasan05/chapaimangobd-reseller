'use strict';

const mongoose = require('mongoose');
const { LEDGER_KIND, values } = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');

const APPEND_ONLY_MESSAGE =
  'LedgerEntry is append-only: post a reversal entry instead of editing history';

/**
 * Append-only. Never updated, never deleted. A correction is a new entry carrying
 * reversalOf. This is the record that settles a dispute with a reseller, so it
 * must not be editable by anyone, including us. See docs/adr/0002.
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    reseller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResellerProfile',
      required: true,
      index: true,
    },
    // Monotonic and gap-free per reseller. Produced by the same atomic operation
    // that moved the balance, so it cannot disagree with balanceAfterPoisha.
    seq: { type: Number, required: true },

    kind: { type: String, enum: values(LEDGER_KIND), required: true },
    // Signed: negative debits, positive credits. The sign is the direction.
    amountPoisha: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => isSafeMoney(v) && v !== 0,
        message: 'amountPoisha must be a non-zero whole number of poisha',
      },
    },
    balanceAfterPoisha: {
      type: Number,
      required: true,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },

    // Deterministic. The unique index is what makes a double credit structurally
    // impossible, independent of any status guard above it.
    idempotencyKey: { type: String, required: true },

    refType: {
      type: String,
      enum: ['order', 'deposit', 'withdrawal', 'sms', 'manual'],
      required: true,
    },
    refId: { type: mongoose.Schema.Types.ObjectId },

    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
    // Reserved so partial returns can ship later without migrating immutable data.
    reversedLineItemId: { type: mongoose.Schema.Types.ObjectId, default: null },

    note: { type: String, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ledgerEntrySchema.index({ reseller: 1, seq: 1 }, { unique: true });
ledgerEntrySchema.index({ reseller: 1, createdAt: -1 });
ledgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
ledgerEntrySchema.index({ refType: 1, refId: 1 });

// Append-only enforced by the model rather than by discipline: every mutation
// path throws, so a future controller cannot quietly rewrite a balance.
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
  ledgerEntrySchema.pre(op, function refuseMutation(next) {
    next(new Error(APPEND_ONLY_MESSAGE));
  });
});

ledgerEntrySchema.pre('save', function refuseRewrite(next) {
  if (!this.isNew) return next(new Error(APPEND_ONLY_MESSAGE));
  return next();
});

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
module.exports.APPEND_ONLY_MESSAGE = APPEND_ONLY_MESSAGE;
