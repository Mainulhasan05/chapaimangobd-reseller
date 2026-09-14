'use strict';

const { logger } = require('../config/logger');
const storage = require('../config/storage');
const KycSubmission = require('../models/KycSubmission');
const ResellerProfile = require('../models/ResellerProfile');
const User = require('../models/User');
const { REVIEW_STATUS, ROLES } = require('../domain/constants');

/**
 * 03:00 Dhaka. Deletes national ID scans the business no longer needs to hold.
 * See docs/adr/0016.
 *
 * - Rejected submissions: 90 days after review.
 * - Approved submissions: kept while the reseller is active, and for one year
 *   after deactivation.
 * - Pending submissions: never. They are waiting for a decision.
 *
 * The R2 object goes and `purgedAt` is set; the submission row and its decision
 * history stay. A submission is marked purged only after every one of its
 * objects was deleted, so a failed delete is simply retried tomorrow.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REJECTED_RETENTION_DAYS = 90;
const DEACTIVATED_RETENTION_DAYS = 365;
const BATCH = 500;

async function eligibleSubmissions(now) {
  const rejected = await KycSubmission.find(
    {
      status: REVIEW_STATUS.REJECTED,
      purgedAt: null,
      reviewedAt: { $lte: new Date(now.getTime() - REJECTED_RETENTION_DAYS * DAY_MS) },
    },
    { documents: 1, status: 1 }
  )
    .limit(BATCH)
    .lean();

  const gone = await User.find(
    {
      role: ROLES.RESELLER,
      isActive: false,
      deactivatedAt: { $lte: new Date(now.getTime() - DEACTIVATED_RETENTION_DAYS * DAY_MS) },
    },
    { _id: 1 }
  ).lean();

  let approved = [];
  if (gone.length > 0) {
    const profiles = await ResellerProfile.find({ user: { $in: gone.map((u) => u._id) } }, { _id: 1 }).lean();
    approved = await KycSubmission.find(
      {
        status: REVIEW_STATUS.APPROVED,
        purgedAt: null,
        reseller: { $in: profiles.map((p) => p._id) },
      },
      { documents: 1, status: 1 }
    )
      .limit(BATCH)
      .lean();
  }

  return [...rejected, ...approved];
}

async function kycPurge({ now = new Date() } = {}) {
  const submissions = await eligibleSubmissions(now);
  if (submissions.length === 0) return { eligible: 0, purged: 0, failed: 0 };

  if (!storage.isConfigured()) {
    // Nothing can be deleted, so nothing is marked deleted.
    logger.warn({ eligible: submissions.length }, 'kyc purge: storage not configured, skipping');
    return { eligible: submissions.length, purged: 0, failed: 0, skipped: true };
  }

  let purged = 0;
  let failed = 0;

  for (const submission of submissions) {
    const keys = (submission.documents || []).map((d) => d.storageKey).filter(Boolean);
    try {
      // S3 answers a delete of a missing key with success, so a half-finished
      // earlier run is safe to repeat.
      // eslint-disable-next-line no-await-in-loop
      for (const key of keys) await storage.destroy(key);

      // Guarded on status as well: a submission cannot change decision under
      // us, but if it ever could, this refuses to purge the new state.
      // eslint-disable-next-line no-await-in-loop
      const res = await KycSubmission.collection.updateOne(
        { _id: submission._id, status: submission.status, purgedAt: null },
        { $set: { purgedAt: now }, $unset: { 'documents.$[].storageKey': '' } }
      );
      purged += res.modifiedCount;
    } catch (err) {
      failed += 1;
      logger.error({ err, kycSubmission: submission._id }, 'kyc purge: delete failed');
    }
  }

  return { eligible: submissions.length, purged, failed };
}

module.exports = { kycPurge, REJECTED_RETENTION_DAYS, DEACTIVATED_RETENTION_DAYS };
