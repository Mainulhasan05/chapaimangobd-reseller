'use strict';

const mongoose = require('mongoose');
const { PAYEE_KIND, values } = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');

/**
 * Anyone the business owes money to or pays: the ক্যারেট seller, a labourer, the
 * courier company, a van owner, a landlord.
 *
 * One model rather than one per relationship, because a due is a due and the
 * ledger underneath is identical for all of them. `kind` changes the label a
 * reader sees and nothing else.
 *
 * Deliberately not called a "supplier": a labourer supplies nothing, and a word
 * that only fits half the rows is a word that gets worked around. Equally not a
 * **Source**, which is an orchard fruit is collected from and exists to carry a
 * quality record — the same person may be both and they stay two rows, because
 * merging them would mean either a complaint rate on a van driver or a due on an
 * orchard nobody buys from directly. See docs/adr/0025.
 */
const payeeSchema = new mongoose.Schema(
  {
    nameBn: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: values(PAYEE_KIND), default: PAYEE_KIND.SUPPLIER, index: true },
    phoneE164: { type: String },
    address: { type: String, trim: true, maxlength: 500 },
    note: { type: String, maxlength: 1000 },

    /*
     * What the owner owes them, **positive when the owner owes**.
     *
     * Deliberately not named `balancePoisha`. A reseller balance runs the other
     * way — negative means they owe us — and two fields that look alike and mean
     * opposites is exactly how a figure ends up backwards in a report. The name
     * is the guard.
     *
     * Negative is legitimate and means an advance (বায়না) was paid: the owner is
     * ahead and the payee owes goods. Never guarded against, because a supplier's
     * terms are not ours to enforce. See docs/adr/0025.
     */
    duePoisha: {
      type: Number,
      default: 0,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },

    // Monotonic and gap-free per payee, moved by the same atomic operation that
    // moves the due.
    ledgerSeq: { type: Number, default: 0 },

    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

payeeSchema.index({ isArchived: 1, kind: 1, nameBn: 1 });
// The payables report reads this: who we owe, worst first.
payeeSchema.index({ duePoisha: -1 });

module.exports = mongoose.model('Payee', payeeSchema);
