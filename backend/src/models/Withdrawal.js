'use strict';

const mongoose = require('mongoose');
const { REVIEW_STATUS, DEPOSIT_METHOD, values } = require('../domain/constants');
const { isBankMethod, needsDestinationNumber } = require('../domain/payout');
const { isSafeMoney } = require('../utils/money');

/**
 * Where a bank transfer goes. Present only on a bank withdrawal, and complete
 * when it is present: half an account number is not a payable instruction.
 * `routingNumber` is the exception, because a reseller reading a passbook often
 * does not have it. See domain/payout.js and docs/adr/0018.
 */
const bankAccountSchema = new mongoose.Schema(
  {
    accountName: { type: String, trim: true, required: true, maxlength: 120 },
    bankName: { type: String, trim: true, required: true, maxlength: 120 },
    branchName: { type: String, trim: true, required: true, maxlength: 120 },
    accountNumber: { type: String, trim: true, required: true, maxlength: 34 },
    routingNumber: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false }
);

/**
 * The owner paying a reseller out. Exists because cash on delivery accumulates
 * positive balances, and without this the reseller money would be trapped.
 * See docs/adr/0003.
 */
const withdrawalSchema = new mongoose.Schema(
  {
    reseller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResellerProfile',
      required: true,
      index: true,
    },
    amountPoisha: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },
    method: { type: String, enum: values(DEPOSIT_METHOD), required: true },
    /*
     * The mobile wallet number, for every method that is paid to one. A bank
     * transfer is paid on `bank` below instead, so this is absent there rather
     * than holding an account number in a field named for a phone.
     */
    destinationNumber: {
      type: String,
      required() {
        return needsDestinationNumber(this.method);
      },
    },
    bank: {
      type: bankAccountSchema,
      default: null,
      required() {
        return isBankMethod(this.method);
      },
    },
    note: { type: String, maxlength: 500 },

    status: { type: String, enum: values(REVIEW_STATUS), default: REVIEW_STATUS.PENDING, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 500 },
    payoutReference: { type: String },
    ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry' },
  },
  { timestamps: true }
);

withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ reseller: 1, createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
