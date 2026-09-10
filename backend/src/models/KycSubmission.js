'use strict';

const mongoose = require('mongoose');
const { REVIEW_STATUS, KYC_DOC_TYPE, values } = require('../domain/constants');

/**
 * One document per attempt, so rejection history survives a resubmission.
 * Images live in Cloudinary as "authenticated" type and are only ever served
 * through short-lived signed URLs generated for the owner. The public id is
 * stored, never a delivery URL, so a leaked database row is not a leaked scan.
 * The raw national ID number is deliberately not stored at all.
 */
const kycSubmissionSchema = new mongoose.Schema(
  {
    reseller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResellerProfile',
      required: true,
      index: true,
    },
    documents: [
      {
        _id: false,
        type: { type: String, enum: values(KYC_DOC_TYPE), required: true },
        cloudinaryPublicId: { type: String, required: true },
        format: { type: String },
        bytes: { type: Number },
      },
    ],
    status: {
      type: String,
      enum: values(REVIEW_STATUS),
      default: REVIEW_STATUS.PENDING,
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    note: { type: String, maxlength: 1000 },
    // Set when the images are purged by the retention job.
    purgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

kycSubmissionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('KycSubmission', kycSubmissionSchema);
