'use strict';

const mongoose = require('mongoose');
const {
  EXPENSE_SCOPE,
  EXPENSE_PAYMENT_STATUS,
  PAID_FROM,
  values,
} = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');

/**
 * Money that left the business and is not recorded anywhere else.
 *
 * The fruit's cost is a snapshot on an order line. The crate's cost is a stock
 * movement. Everything else the owner spends — লেবার, পরিবহন, কুরিয়ার, rent, a
 * phone bill — is one of these, and without them the app can say what was
 * invoiced but never whether the month made money.
 *
 * See docs/adr/0027.
 */
const expenseSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExpenseCategory',
      required: true,
      index: true,
    },
    // Snapshot, so archiving or renaming a category cannot rewrite a past
    // report. Same rule as every other name in this system.
    categoryNameBn: { type: String, required: true },

    /*
     * Order or period, resolved at write from the category and never inferred
     * again afterwards.
     *
     * A period expense is never divided across orders. লেবার খরচ is real money
     * and it is not measurable per parcel; a share invented to make a per-order
     * cost look complete is a number that is simply not true, and it would then
     * be summed into a margin and believed. The P&L subtracts period costs at
     * the period level, which is both honest and what an accountant would do.
     */
    scope: { type: String, enum: values(EXPENSE_SCOPE), required: true, index: true },

    amountPoisha: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },
    // Dhaka calendar date. The date the money was spent, which is not always the
    // day it was typed in.
    businessDate: { type: String, required: true, index: true },

    /*
     * The order this belongs to, when the scope is `order`. Required then and
     * forbidden otherwise — enforced in the service rather than here, so the
     * message the owner sees is a field error and not a cast error.
     */
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    orderCode: { type: String, default: null },

    // Who was paid. Optional: a bus fare is owed to nobody worth recording.
    payee: { type: mongoose.Schema.Types.ObjectId, ref: 'Payee', default: null, index: true },
    payeeNameBn: { type: String, default: null },

    /*
     * Whether the money has actually left.
     *
     * `unpaid` plus a payee is a due, and posts to that payee's ledger, so a
     * month of courier bills accumulates into one payable instead of thirty
     * forgotten rows. `paid` posts nothing: the money is already gone and there
     * is no cash book for it to leave. See PLAN-3 decision 20.
     */
    paymentStatus: {
      type: String,
      enum: values(EXPENSE_PAYMENT_STATUS),
      default: EXPENSE_PAYMENT_STATUS.PAID,
      index: true,
    },
    // A label, not an account. There are no balances behind these names.
    paidFrom: { type: String, enum: values(PAID_FROM), default: PAID_FROM.CASH },
    // Set when this expense posted a due, so voiding it knows what to reverse.
    ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'PayeeLedgerEntry', default: null },

    // Voided rather than deleted, so a month's total cannot change behind a
    // report that was already printed.
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, maxlength: 500 },

    note: { type: String, maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// The ranged expense report and the P&L both read this.
expenseSchema.index({ businessDate: -1, scope: 1 });
expenseSchema.index({ category: 1, businessDate: -1 });
expenseSchema.index({ payee: 1, businessDate: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
