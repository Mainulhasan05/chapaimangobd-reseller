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
const { findPage, readPaging } = require('../../utils/cursor');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const ledger = require('../../services/ledger');
const resellerLifecycle = require('../../services/resellerLifecycle');
const tokens = require('../../services/tokens');
const { escapeRegex, toLatinDigits } = require('../../utils/orderSearch');
const { SYSTEM_CANCELLABLE } = require('../../domain/orderStateMachine');
const {
  KYC_STATUS,
  REVIEW_STATUS,
  EVENT_TYPE,
  ORDER_STATUS,
  ROLES,
} = require('../../domain/constants');

/** Statuses that count as trade: billed, not cancelled, not returned. */
const TRADED = { $nin: [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] };

const presentRow = (p) => ({
  id: p._id,
  user: p.user,
  shopName: p.shopName,
  slug: p.slug,
  kycRequired: Boolean(p.kycRequired),
  kycStatus: p.kycStatus,
  formActive: p.formActive,
  ...present.wallet(p),
  createdAt: p.createdAt,
});

/**
 * The resellers a search term names: the shop, the person, or their login phone.
 *
 * The name and the phone live on the User, so those are found first and joined
 * by id. Digits are matched on the tail, as every phone search here is, and a
 * Bangla keyboard's ০১৭ is read as 017 before anything is matched.
 */
async function searchClause(term) {
  const trimmed = toLatinDigits(term || '').trim();
  if (!trimmed) return null;

  const pattern = new RegExp(escapeRegex(trimmed), 'i');
  const or = [{ name: pattern }];
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 4) or.push({ phoneE164: new RegExp(`${escapeRegex(digits)}$`) });

  const users = await User.find({ role: ROLES.RESELLER, $or: or }, { _id: 1 }).lean();
  return { $or: [{ shopName: pattern }, { user: { $in: users.map((u) => u._id) } }] };
}

/** The order each non-default sort asks for, ties broken by id for a stable list. */
const SORTS = {
  name: { shopName: 1, _id: 1 },
  balance_desc: { balancePoisha: -1, _id: 1 },
  balance_asc: { balancePoisha: 1, _id: 1 },
};

/**
 * Newest first, by default. Pass `limit` (and then `cursor`) for a page at a
 * time; without either the whole list comes back, as it always has.
 *
 * Any other `sort` answers the whole matching list with `nextCursor: null`. The
 * cursor names a creation time and cannot resume a list ordered by balance, and
 * a page-numbered balance list would skip and repeat rows as balances moved
 * under it. A reseller list is dozens of rows; whole is the honest answer.
 */
async function listResellers(req, res) {
  const filter = {};
  if (req.query.kycStatus) filter.kycStatus = req.query.kycStatus;
  const search = await searchClause(req.query.q);
  if (search) Object.assign(filter, search);

  const populate = { path: 'user', select: 'name phoneE164 isActive deactivatedAt lastLoginAt' };
  const sort = req.query.sort || 'newest';

  if (sort !== 'newest') {
    const profiles = await ResellerProfile.find(filter).sort(SORTS[sort]).populate(populate);
    return ok(res, { nextCursor: null, resellers: profiles.map(presentRow) });
  }

  const { rows: profiles, nextCursor } = await findPage(ResellerProfile, filter, {
    direction: -1,
    paging: readPaging(req.query),
    populate,
  });

  return ok(res, { nextCursor, resellers: profiles.map(presentRow) });
}

async function getReseller(req, res) {
  const profile = await ResellerProfile.findById(req.params.id).populate(
    'user',
    'name phoneE164 isActive deactivatedAt lastLoginAt createdAt'
  );
  if (!profile) throw notFound('Reseller not found');

  const [orderCounts, [sales], [latest], latestKyc] = await Promise.all([
    Order.aggregate([
      { $match: { reseller: profile._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    /*
     * What this reseller has traded: billed, not cancelled, not returned, the
     * same rule the reseller report uses. In owner revenue — the wallet debit —
     * because that is the owner's money; the customer total beside it carries
     * the reseller's margin and is labelled as what it is.
     */
    Order.aggregate([
      { $match: { reseller: profile._id, status: TRADED } },
      {
        $group: {
          _id: null,
          ownerRevenuePoisha: { $sum: '$totals.walletDebitPoisha' },
          customerPoisha: { $sum: '$totals.customerTotalPoisha' },
        },
      },
    ]),
    Order.find({ reseller: profile._id }, { createdAt: 1 }).sort({ createdAt: -1 }).limit(1).lean(),
    KycSubmission.findOne({ reseller: profile._id }).sort({ createdAt: -1 }),
  ]);

  const counts = Object.fromEntries(orderCounts.map((c) => [c._id, c.count]));

  return ok(res, {
    reseller: {
      id: profile._id,
      user: profile.user,
      shopName: profile.shopName,
      slug: profile.slug,
      address: profile.address,
      kycRequired: Boolean(profile.kycRequired),
      kycStatus: profile.kycStatus,
      formActive: profile.formActive,
      channelPrefs: profile.channelPrefs,
      ...present.wallet(profile),
      createdAt: profile.createdAt,
    },
    orderCounts: counts,
    stats: {
      // Every order, whatever became of it, pending and cancelled included.
      orderCount: orderCounts.reduce((sum, c) => sum + c.count, 0),
      deliveredCount: counts[ORDER_STATUS.DELIVERED] || 0,
      salesTotal: toTaka((sales && sales.ownerRevenuePoisha) || 0),
      customerTotal: toTaka((sales && sales.customerPoisha) || 0),
      lastOrderAt: latest ? latest.createdAt : null,
    },
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
 * What deactivating this reseller would do, before it is done: how many pending
 * orders the system would cancel. Read from the same status list the
 * deactivation itself sweeps (SYSTEM_CANCELLABLE), so the warning cannot promise
 * a different number from the one that happens. Orders from confirm onwards are
 * fulfilled as normal and are not counted. See docs/adr/0011.
 */
async function deactivationPreview(req, res) {
  const profile = await ResellerProfile.findById(req.params.id, { _id: 1 });
  if (!profile) throw notFound('Reseller not found');

  const pendingOrders = await Order.countDocuments({
    reseller: profile._id,
    status: { $in: SYSTEM_CANCELLABLE },
  });
  return ok(res, { pendingOrders });
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

  /*
   * Asking a reseller to verify their identity, or withdrawing the ask. This is
   * the only switch that reveals the KYC module to them, and while it is off
   * nothing about their shop is gated on it (docs/adr/0017).
   *
   * Turning it on for a reseller who has not been approved closes their public
   * form there and then, because shopAvailability reads the same rule the
   * moment a customer loads the page. The owner is told so before they tap it;
   * the alternative, a grace period, is a second piece of state that has to be
   * right and would let an unverified shop keep selling for exactly as long as
   * the owner did not need it to.
   */
  const kycRequiredBefore = Boolean(profile.kycRequired);
  if (req.body.kycRequired !== undefined) profile.kycRequired = req.body.kycRequired;

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

  // Asking someone for their national ID is a decision with a date on it, and
  // so is deciding to stop asking.
  if (kycRequiredBefore !== Boolean(profile.kycRequired)) {
    await audit.record({
      actor: req.user._id,
      action: 'reseller.kyc_required',
      targetType: 'ResellerProfile',
      targetId: profile._id,
      before: { kycRequired: kycRequiredBefore },
      after: { kycRequired: Boolean(profile.kycRequired) },
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
      kycRequired: Boolean(fresh.kycRequired),
      kycStatus: fresh.kycStatus,
    },
    // Order codes of the pending orders this request cancelled, if any.
    cancelledOrders: (lifecycle && lifecycle.cancelledOrders) || [],
  });
}

/* ----------------------------------------------------------------- kyc queue */

/**
 * Oldest first, because a queue is worked from the front. Paged by `limit` and
 * `cursor` when asked; whole otherwise.
 */
async function listKyc(req, res) {
  const status = req.query.status || REVIEW_STATUS.PENDING;
  const { rows: submissions, nextCursor } = await findPage(
    KycSubmission,
    { status },
    {
      direction: 1,
      paging: readPaging(req.query),
      populate: [
        { path: 'reseller', populate: { path: 'user', select: 'name phoneE164' } },
        { path: 'reviewedBy', select: 'name' },
      ],
    }
  );

  return ok(res, {
    nextCursor,
    submissions: submissions.map((s) => ({
      id: s._id,
      reseller: s.reseller,
      status: s.status,
      documentTypes: s.documents.map((d) => d.type),
      // The decision, for the history tabs: what was said, by whom, and when.
      note: s.note || null,
      reviewedAt: s.reviewedAt || null,
      reviewedBy: s.reviewedBy ? { id: s.reviewedBy._id, name: s.reviewedBy.name } : null,
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
 * Every reseller whose money is not square, summed from the ledger rather than
 * read from the cached balance, so this report doubles as a permanent
 * reconciliation check. See docs/adr/0002.
 *
 * A row appears when the ledger balance is not zero, in either direction, or
 * when the cached balance disagrees with the ledger. The second rule is what
 * lets a drift show at all: a reseller with no entries and a corrupted cache,
 * or one in credit whose cache drifted, would otherwise never be listed.
 *
 * `totalOwed` keeps its meaning, what resellers owe the owner (the negatives).
 * `totalPayable` is the other side, what the owner holds for resellers.
 */
async function receivables(_req, res) {
  const [balances, drifted, openOrders] = await Promise.all([
    ledger.ledgerBalances(),
    // Cached balances that are not zero. Joined with the ledger below; any of
    // these without a single entry is drift by definition.
    ResellerProfile.find({ balancePoisha: { $ne: 0 } }, { _id: 1 }).lean(),
    Order.countDocuments({
      status: { $in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PACKED] },
    }),
  ]);

  const ledgerById = new Map(balances.map((r) => [String(r.reseller), r.balancePoisha]));
  const candidateIds = new Set([
    ...balances.filter((r) => r.balancePoisha !== 0).map((r) => String(r.reseller)),
    ...drifted.map((p) => String(p._id)),
  ]);

  const profiles = await ResellerProfile.find({ _id: { $in: [...candidateIds] } }).populate(
    'user',
    'name phoneE164 isActive'
  );

  let totalOwedPoisha = 0;
  let totalPayablePoisha = 0;

  const rows = profiles
    .map((p) => {
      const balancePoisha = ledgerById.get(String(p._id)) || 0;
      const drift = p.balancePoisha !== balancePoisha;
      return { p, balancePoisha, drift };
    })
    .filter(({ balancePoisha, drift }) => balancePoisha !== 0 || drift)
    // Most owed first, then the largest credit last; ties by id for a stable page.
    .sort((a, b) => a.balancePoisha - b.balancePoisha || String(a.p._id).localeCompare(String(b.p._id)));

  rows.forEach(({ balancePoisha }) => {
    if (balancePoisha < 0) totalOwedPoisha -= balancePoisha;
    else totalPayablePoisha += balancePoisha;
  });

  return ok(res, {
    totalOwed: toTaka(totalOwedPoisha),
    totalPayable: toTaka(totalPayablePoisha),
    openOrders,
    resellers: rows.map(({ p, balancePoisha, drift }) => ({
      id: p._id,
      shopName: p.shopName,
      user: p.user,
      // The ledger's figure, signed: negative owes the owner, positive is held for them.
      balance: toTaka(balancePoisha),
      owed: toTaka(Math.max(0, -balancePoisha)),
      payable: toTaka(Math.max(0, balancePoisha)),
      cachedBalance: toTaka(p.balancePoisha),
      creditLimit: toTaka(p.creditLimitPoisha),
      atLimit: balancePoisha < 0 && balancePoisha <= -p.creditLimitPoisha,
      // The cached balance disagrees with the ledger: run a reconcile.
      drift,
    })),
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
  deactivationPreview,
  updateReseller,
  listKyc,
  getKycDocuments,
  decideKyc,
  receivables,
};
