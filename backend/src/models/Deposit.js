'use strict';

const mongoose = require('mongoose');
const { REVIEW_STATUS, DEPOSIT_METHOD, values } = require('../domain/constants');
const { isSafeMoney } = require('../utils/money');

/** A reseller paying the owner. Credits the wallet on approval. */
const depositSchema = new mongoose.Schema(
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
    senderNumber: { type: String },
    transactionId: { type: String, trim: true },
    screenshot: { publicId: String, format: String },
    note: { type: String, maxlength: 500 },

    status: { type: String, enum: values(REVIEW_STATUS), default: REVIEW_STATUS.PENDING, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 500 },
    ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry' },
  },
  { timestamps: true }
);

depositSchema.index({ status: 1, createdAt: -1 });
depositSchema.index({ reseller: 1, createdAt: -1 });
// The same gateway transaction cannot be claimed twice, by anyone.
depositSchema.index(
  { method: 1, transactionId: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: 'string' } } }
);

module.exports = mongoose.model('Deposit', depositSchema);
