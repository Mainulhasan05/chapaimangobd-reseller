'use strict';

const ResellerProfile = require('../../models/ResellerProfile');
const User = require('../../models/User');
const KycSubmission = require('../../models/KycSubmission');
const Order = require('../../models/Order');

const cloud = require('../../config/cloudinary');
const audit = require('../../services/audit');
const { notify } = require('../../services/notify');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const { KYC_STATUS, REVIEW_STATUS, EVENT_TYPE, ORDER_STATUS } = require('../../domain/constants');

async function listResellers(req, res) {
  const filter = {};
  if (req.query.kycStatus) filter.kycStatus = req.query.kycStatus;

  const profiles = await ResellerProfile.find(filter)
    .sort({ createdAt: -1 })
    .populate('user', 'name phoneE164 isActive lastLoginAt');

  return ok(res, {
    resellers: profiles.map((p) => ({
      id: p._id,
      user: p.user,
      shopName: p.shopName,
      slug: p.slug,
      kycStatus: p.kycStatus,
      formActive: p.formActive,
      ...present.wallet(p),
      createdAt: p.createdAt,
    })),
  });
}

async function getReseller(req, res) {
  const profile = await ResellerProfile.findById(req.params.id).populate(
    'user',
    'name phoneE164 isActive lastLoginAt createdAt'
  );
  if (!profile) throw notFound('Reseller not found');

  const [orderCounts, latestKyc] = await Promise.all([
    Order.aggregate([
      { $match: { reseller: profile._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    KycSubmission.findOne({ reseller: profile._id }).sort({ createdAt: -1 }),
  ]);

  return ok(res, {
    reseller: {
      id: profile._id,
      user: profile.user,
      shopName: profile.shopName,
      slug: profile.slug,
      address: profile.address,
      kycStatus: profile.kycStatus,
      formActive: profile.formActive,
      channelPrefs: profile.channelPrefs,
      ...present.wallet(profile),
      createdAt: profile.createdAt,
    },
    orderCounts: Object.fromEntries(orderCounts.map((c) => [c._id, c.count])),
    kyc: latestKyc
      ? {
          id: latestKyc._id,
          status: latestKyc.status,
          note: latestKyc.note,
          createdAt: latestKyc.createdAt,
          documents: latestKyc.documents.map((d) => ({ type: d.type })),
        }
      : null,
  });
}

/**
 * The credit limit is the single most important loss-prevention control here, so
 * every change to it is audited.
 */
async function updateReseller(req, res) {
  const profile = await ResellerProfile.findById(req.params.id);
  if (!profile) throw notFound('Reseller not found');

  const before = { creditLimitPoisha: profile.creditLimitPoisha };

  if (req.body.creditLimit !== undefined) {
    profile.creditLimitPoisha = toPoisha(req.body.creditLimit, 'creditLimit');
  }
  if (req.body.smsEnabled !== undefined) profile.channelPrefs.sms = req.body.smsEnabled;
  await profile.save();

  if (req.body.isActive !== undefined) {
    await User.updateOne({ _id: profile.user }, { $set: { isActive: req.body.isActive } });
  }

  if (before.creditLimitPoisha !== profile.creditLimitPoisha) {
    await audit.record({
      actor: req.user._id,
      action: 'reseller.credit_limit',
      targetType: 'ResellerProfile',
      targetId: profile._id,
      before,
      after: { creditLimitPoisha: profile.creditLimitPoisha },
      ip: req.ip,
    });
  }

  return ok(res, { reseller: { id: profile._id, ...present.wallet(profile) } });
}

/* ----------------------------------------------------------------- kyc queue */

async function listKyc(req, res) {
  const status = req.query.status || REVIEW_STATUS.PENDING;
  const submissions = await KycSubmission.find({ status })
    .sort({ createdAt: 1 })
    .populate({ path: 'reseller', populate: { path: 'user', select: 'name phoneE164' } });

  return ok(res, {
    submissions: submissions.map((s) => ({
      id: s._id,
      reseller: s.reseller,
      status: s.status,
      documentTypes: s.documents.map((d) => d.type),
      createdAt: s.createdAt,
    })),
  });
}

/**
 * National ID scans are served through short-lived signed URLs generated per
 * request for the owner alone. The stored public id is never a usable link.
 */
async function getKycDocuments(req, res) {
  const submission = await KycSubmission.findById(req.params.id);
  if (!submission) throw notFound('Submission not found');
  if (submission.purgedAt) return ok(res, { documents: [], purgedAt: submission.purgedAt });

  const documents = submission.documents.map((d) => ({
    type: d.type,
    url: cloud.signedUrl(d.cloudinaryPublicId, { expiresInSeconds: 600 }),
  }));

  await audit.record({
    actor: req.user._id,
    action: 'kyc.view_documents',
    targetType: 'KycSubmission',
    targetId: submission._id,
    ip: req.ip,
  });

  return ok(res, { documents });
}

async function decideKyc(req, res) {
  const approve = req.params.decision === 'approve';
  const submission = await KycSubmission.findOneAndUpdate(
    { _id: req.params.id, status: REVIEW_STATUS.PENDING },
    {
      $set: {
        status: approve ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        note: req.body.reason,
      },
    },
    { new: true }
  );
  if (!submission) throw notFound('No pending submission with that id');

  const profile = await ResellerProfile.findByIdAndUpdate(
    submission.reseller,
    {
      $set: {
        kycStatus: approve ? KYC_STATUS.APPROVED : KYC_STATUS.REJECTED,
        // Approving opens the shop; rejecting closes it again.
        ...(approve ? { formActive: true } : { formActive: false }),
      },
    },
    { new: true }
  );

  await audit.record({
    actor: req.user._id,
    action: approve ? 'kyc.approve' : 'kyc.reject',
    targetType: 'KycSubmission',
    targetId: submission._id,
    after: { status: submission.status, reason: req.body.reason },
    ip: req.ip,
  });

  const user = await User.findById(profile.user);
  await notify({
    user,
    eventType: approve ? EVENT_TYPE.KYC_APPROVED : EVENT_TYPE.KYC_REJECTED,
    title: approve ? 'KYC approved' : 'KYC needs attention',
    body: approve
      ? `Your shop is live at /r/${profile.slug}`
      : req.body.reason || 'Please resubmit your documents',
    data: { kycStatus: profile.kycStatus },
  });

  return ok(res, { kycStatus: profile.kycStatus });
}

/** Total owed across every reseller, computed from the ledger, not the cache. */
async function receivables(_req, res) {
  const profiles = await ResellerProfile.find({ balancePoisha: { $lt: 0 } })
    .sort({ balancePoisha: 1 })
    .populate('user', 'name phoneE164');

  const totalOwedPoisha = profiles.reduce((sum, p) => sum + Math.abs(p.balancePoisha), 0);
  const openOrders = await Order.countDocuments({
    status: { $in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PACKED] },
  });

  return ok(res, {
    totalOwed: toTaka(totalOwedPoisha),
    openOrders,
    resellers: profiles.map((p) => ({
      id: p._id,
      shopName: p.shopName,
      user: p.user,
      owed: toTaka(Math.abs(p.balancePoisha)),
      creditLimit: toTaka(p.creditLimitPoisha),
      atLimit: p.balancePoisha <= -p.creditLimitPoisha,
    })),
  });
}

module.exports = {
  listResellers,
  getReseller,
  updateReseller,
  listKyc,
  getKycDocuments,
  decideKyc,
  receivables,
};
