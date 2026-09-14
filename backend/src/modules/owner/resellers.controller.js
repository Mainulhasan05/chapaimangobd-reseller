'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const ResellerProfile = require('../../models/ResellerProfile');
const User = require('../../models/User');
const KycSubmission = require('../../models/KycSubmission');
const Order = require('../../models/Order');

const storage = require('../../config/storage');
const audit = require('../../services/audit');
const { notify } = require('../../services/notify');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const ledger = require('../../services/ledger');
const resellerLifecycle = require('../../services/resellerLifecycle');
const tokens = require('../../services/tokens');
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
  const smsBefore = profile.channelPrefs.sms;
  if (req.body.smsEnabled !== undefined) profile.channelPrefs.sms = req.body.smsEnabled;
  await profile.save();

  /*
   * Deactivation closes the shop and cancels pending orders in one transaction;
   * reactivation restores the form. Both audit themselves. deactivatedAt starts
   * the KYC retention clock (docs/adr/0016), and a repeat does not restart it.
   * See docs/adr/0011 and services/resellerLifecycle.js.
   */
  let lifecycle = null;
  if (req.body.isActive !== undefined) {
    lifecycle = await resellerLifecycle.setActive({
      profileId: profile._id,
      isActive: req.body.isActive,
      actorUser: req.user,
      ip: req.ip,
    });
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

  // Reseller-paid SMS spends the reseller's credits, so switching it is recorded.
  if (smsBefore !== profile.channelPrefs.sms) {
    await audit.record({
      actor: req.user._id,
      action: 'reseller.sms_enabled',
      targetType: 'ResellerProfile',
      targetId: profile._id,
      before: { smsEnabled: smsBefore },
      after: { smsEnabled: profile.channelPrefs.sms },
      ip: req.ip,
    });
  }

  // Re-read: the lifecycle change wrote the form flag and the account directly.
  const [fresh, account] = await Promise.all([
    ResellerProfile.findById(profile._id),
    User.findById(profile.user).select('isActive deactivatedAt'),
  ]);

  return ok(res, {
    reseller: {
      id: fresh._id,
      ...present.wallet(fresh),
      isActive: account ? account.isActive : null,
      deactivatedAt: account ? account.deactivatedAt : null,
      formActive: fresh.formActive,
      smsEnabled: fresh.channelPrefs.sms,
    },
    // Order codes of the pending orders this request cancelled, if any.
    cancelledOrders: (lifecycle && lifecycle.cancelledOrders) || [],
  });
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
 * request for the owner alone. The stored key is never a usable link on its own,
 * because the bucket is private.
 */
async function getKycDocuments(req, res) {
  const submission = await KycSubmission.findById(req.params.id);
  if (!submission) throw notFound('Submission not found');
  if (submission.purgedAt) return ok(res, { documents: [], purgedAt: submission.purgedAt });

  const documents = await Promise.all(
    submission.documents.map(async (d) => ({
      type: d.type,
      url: await storage.signedUrl(d.storageKey, { expiresInSeconds: 600 }),
    }))
  );

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
    data: { kycStatus: profile.kycStatus, slug: profile.slug, reason: req.body.reason || undefined },
  });

  return ok(res, { kycStatus: profile.kycStatus });
}

/**
 * Total owed across every reseller, summed from the ledger rather than read from
 * the cached balance, so this report doubles as a permanent reconciliation
 * check. A reseller whose cache disagrees is flagged, not hidden. See docs/adr/0002.
 */
async function receivables(_req, res) {
  const [owing, openOrders] = await Promise.all([
    ledger.ledgerBalances({ owingOnly: true }),
    Order.countDocuments({
      status: { $in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PACKED] },
    }),
  ]);

  const profiles = await ResellerProfile.find({ _id: { $in: owing.map((r) => r.reseller) } }).populate(
    'user',
    'name phoneE164'
  );
  const profileById = new Map(profiles.map((p) => [String(p._id), p]));

  const totalOwedPoisha = owing.reduce((sum, r) => sum - r.balancePoisha, 0);

  return ok(res, {
    totalOwed: toTaka(totalOwedPoisha),
    openOrders,
    resellers: owing
      .filter((r) => profileById.has(String(r.reseller)))
      .map((r) => {
        const p = profileById.get(String(r.reseller));
        return {
          id: p._id,
          shopName: p.shopName,
          user: p.user,
          owed: toTaka(-r.balancePoisha),
          creditLimit: toTaka(p.creditLimitPoisha),
          atLimit: r.balancePoisha <= -p.creditLimitPoisha,
          // The cached balance disagrees with the ledger: run a reconcile.
          drift: p.balancePoisha !== r.balancePoisha,
        };
      }),
  });
}

/* ------------------------------------------------------- password reset -- */

/*
 * No 0/o, 1/l/i: the owner reads this aloud down a phone line, and a character
 * that can be heard two ways is a support call.
 */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const TEMP_LENGTH = 10;

const temporaryPassword = () =>
  Array.from({ length: TEMP_LENGTH }, () => TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)]).join('');

/**
 * The fallback when a reseller cannot receive an SMS (docs/adr/0014). Issues a
 * temporary password, returned once and never stored in the clear, ends every
 * session the reseller has, and makes them choose their own at next sign-in.
 */
async function resetPassword(req, res) {
  const profile = await ResellerProfile.findById(req.params.id);
  if (!profile) throw notFound('Reseller not found');

  const password = temporaryPassword();
  const result = await User.updateOne(
    { _id: profile.user },
    {
      $set: {
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
      },
    }
  );
  if (result.matchedCount === 0) throw notFound('Reseller account not found');

  await tokens.revokeAllForUser(profile.user);

  // The password itself never goes into the audit log.
  await audit.record({
    actor: req.user._id,
    action: 'reseller.password_reset',
    targetType: 'User',
    targetId: profile.user,
    after: { mustChangePassword: true },
    ip: req.ip,
  });

  return ok(res, { temporaryPassword: password });
}

module.exports = {
  resetPassword,
  listResellers,
  getReseller,
  updateReseller,
  listKyc,
  getKycDocuments,
  decideKyc,
  receivables,
};
