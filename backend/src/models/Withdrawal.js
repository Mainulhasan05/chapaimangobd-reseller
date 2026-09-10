'use strict';

const mongoose = require('mongoose');
const { REVIEW_STATUS, DEPOSIT_METHOD, values } = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');

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
    destinationNumber: { type: String, required: true },
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
