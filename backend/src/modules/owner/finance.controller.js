'use strict';

const crypto = require('node:crypto');

const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');
const ResellerProfile = require('../../models/ResellerProfile');
const User = require('../../models/User');
const LedgerEntry = require('../../models/LedgerEntry');

const ledger = require('../../services/ledger');
const finance = require('../../services/finance');
const { withTransaction } = require('../../services/tx');
const { notify } = require('../../services/notify');
const audit = require('../../services/audit');
const storage = require('../../config/storage');
const { ok } = require('../../middleware/error');
const { notFound, badRequest } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const { REVIEW_STATUS, LEDGER_KIND, EVENT_TYPE } = require('../../domain/constants');
const { describeDestination } = require('../../domain/payout');

/* ------------------------------------------------------------- shared rows */

/**
 * What a deposit and a withdrawal row both carry beyond their own fields: who
 * asked, where their wallet stands now, and who decided and when.
 *
 * `balance` is the reseller's balance at the moment of reading, not at the
 * moment of the request. That is the figure an approval is weighed against —
 * a withdrawal the balance no longer covers will be refused — and the history
 * rows carry it too so that every row in the list has the same shape.
 */
const RESELLER_POPULATE = {
  path: 'reseller',
  select: 'shopName slug user balancePoisha',
  populate: { path: 'user', select: 'name phoneE164' },
};
const REVIEWER_POPULATE = { path: 'reviewedBy', select: 'name' };

const presentReseller = (r) =>
  r
    ? {
        _id: r._id,
        id: r._id,
        shopName: r.shopName,
        slug: r.slug,
        user: r.user ? { _id: r.user._id, name: r.user.name, phoneE164: r.user.phoneE164 } : null,
      }
    : null;

const presentReview = (row) => ({
  note: row.note || null,
  // The owner's reason for a rejection. Null on anything approved or pending.
  reason: row.rejectionReason || null,
  reviewedAt: row.reviewedAt || null,
  reviewedBy: row.reviewedBy ? { id: row.reviewedBy._id, name: row.reviewedBy.name } : null,
  balance: row.reseller ? toTaka(row.reseller.balancePoisha || 0) : null,
});

const financeFilter = ({ status, method, resellerId }) => {
  const filter = {};
  if (status) filter.status = status;
  if (method) filter.method = method;
  if (resellerId) filter.reseller = resellerId;
  return filter;
};

/* ------------------------------------------------------------------ deposits */

async function listDeposits(req, res) {
  const { page, limit } = req.query;
  const filter = financeFilter(req.query);

  const [deposits, total] = await Promise.all([
    Deposit.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(RESELLER_POPULATE)
      .populate(REVIEWER_POPULATE),
    Deposit.countDocuments(filter),
  ]);

  return ok(res, {
    deposits: deposits.map((d) => ({
      id: d._id,
      reseller: presentReseller(d.reseller),
      amount: toTaka(d.amountPoisha),
      method: d.method,
      senderNumber: d.senderNumber,
      transactionId: d.transactionId,
      hasScreenshot: Boolean(d.screenshot && d.screenshot.key),
      status: d.status,
      ...presentReview(d),
      createdAt: d.createdAt,
    })),
    page,
    limit,
    total,
  });
}

/** The bKash screenshot carries a phone number, so it is private and signed. */
async function getDepositScreenshot(req, res) {
  const deposit = await Deposit.findById(req.params.id);
  if (!deposit || !deposit.screenshot || !deposit.screenshot.key) {
    throw notFound('No screenshot on this deposit');
  }
  return ok(res, {
    url: await storage.signedUrl(deposit.screenshot.key, { expiresInSeconds: 600 }),
  });
}

/**
 * The status flip and the ledger credit are one transaction in
 * services/finance.js. Audit and notification run only after it commits.
 */
async function decideDeposit(req, res) {
  const approve = req.params.decision === 'approve';

  const { deposit } = await finance.decideDeposit({
    depositId: req.params.id,
    approve,
    actorUser: req.user,
    reason: req.body.reason,
  });

  await audit.record({
    actor: req.user._id,
    action: approve ? 'deposit.approve' : 'deposit.reject',
    targetType: 'Deposit',
    targetId: deposit._id,
    before: { status: REVIEW_STATUS.PENDING },
    after: { status: deposit.status, amountPoisha: deposit.amountPoisha },
    ip: req.ip,
  });

  await notifyReseller(deposit.reseller, {
    eventType: approve ? EVENT_TYPE.DEPOSIT_APPROVED : EVENT_TYPE.DEPOSIT_REJECTED,
    data: { amountPoisha: deposit.amountPoisha, reason: req.body.reason || undefined },
  });

  return ok(res, { status: deposit.status });
}

/* --------------------------------------------------------------- withdrawals */

async function listWithdrawals(req, res) {
  const { page, limit } = req.query;
  const filter = financeFilter(req.query);

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(RESELLER_POPULATE)
      .populate(REVIEWER_POPULATE),
    Withdrawal.countDocuments(filter),
  ]);

  return ok(res, {
    withdrawals: withdrawals.map((w) => ({
      id: w._id,
      reseller: presentReseller(w.reseller),
      amount: toTaka(w.amountPoisha),
      method: w.method,
      // One of these is set, never both: a wallet is paid on a number and a
      // bank on an account. See domain/payout.js and docs/adr/0018.
      destinationNumber: w.destinationNumber || null,
      bank: w.bank ? (w.bank.toObject ? w.bank.toObject() : w.bank) : null,
      status: w.status,
      // What the owner typed on approval: the bKash transaction id, a bank slip.
      payoutReference: w.payoutReference || null,
      ...presentReview(w),
      createdAt: w.createdAt,
    })),
    page,
    limit,
    total,
  });
}

/**
 * Approval can fail with INSUFFICIENT_BALANCE when the balance was spent after
 * the request. The transaction then leaves the withdrawal pending, untouched.
 */
async function decideWithdrawal(req, res) {
  const approve = req.params.decision === 'approve';

  const { withdrawal } = await finance.decideWithdrawal({
    withdrawalId: req.params.id,
    approve,
    actorUser: req.user,
    reason: req.body.reason,
    payoutReference: req.body.payoutReference,
  });

  await audit.record({
    actor: req.user._id,
    action: approve ? 'withdrawal.approve' : 'withdrawal.reject',
    targetType: 'Withdrawal',
    targetId: withdrawal._id,
    before: { status: REVIEW_STATUS.PENDING },
    after: { status: withdrawal.status, amountPoisha: withdrawal.amountPoisha },
    ip: req.ip,
  });

  await notifyReseller(withdrawal.reseller, {
    eventType: approve ? EVENT_TYPE.WITHDRAWAL_APPROVED : EVENT_TYPE.WITHDRAWAL_REJECTED,
    data: {
      amountPoisha: withdrawal.amountPoisha,
      destination: describeDestination(withdrawal),
      reason: req.body.reason || undefined,
    },
  });

  return ok(res, { status: withdrawal.status });
}

/* ------------------------------------------------------------- manual ledger */

/** An adjustment is still an entry, never an edit. It requires a stated reason. */
async function manualEntry(req, res) {
  const { direction, note } = req.body;
  const magnitude = toPoisha(Math.abs(req.body.amount), 'amount');
  if (magnitude === 0) throw badRequest('ZERO_AMOUNT', 'Amount must be greater than zero');

  const amountPoisha = direction === 'credit' ? magnitude : -magnitude;

  const entry = await withTransaction((session) =>
    ledger.postEntry(session, {
      reseller: req.params.id,
      kind: direction === 'credit' ? LEDGER_KIND.MANUAL_CREDIT : LEDGER_KIND.MANUAL_DEBIT,
      amountPoisha,
      idempotencyKey: ledger.keys.manual(crypto.randomUUID()),
      refType: 'manual',
      note,
      createdBy: req.user._id,
      // The owner correcting the books is not the reseller taking on credit.
      bypassCreditLimit: true,
    })
  );

  await audit.record({
    actor: req.user._id,
    action: 'ledger.manual',
    targetType: 'ResellerProfile',
    targetId: req.params.id,
    after: { amountPoisha, note },
    ip: req.ip,
  });

  return ok(res, { entry: present.ledgerEntry(entry) }, 201);
}

async function resellerLedger(req, res) {
  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 50), 200);

  const filter = { reseller: req.params.id };
  const [entries, total] = await Promise.all([
    LedgerEntry.find(filter)
      .sort({ seq: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LedgerEntry.countDocuments(filter),
  ]);

  return ok(res, { entries: entries.map(present.ledgerEntry), page, limit, total });
}

/** Proves the ledger and the cached balance still agree. */
async function reconcile(req, res) {
  const result = req.params.id
    ? await ledger.reconcile(req.params.id)
    : await ledger.reconcileAll();
  return ok(res, result);
}

async function notifyReseller(resellerId, message) {
  const profile = await ResellerProfile.findById(resellerId);
  if (!profile) return;
  const user = await User.findById(profile.user);
  await notify({ user, ...message });
}

module.exports = {
  listDeposits,
  getDepositScreenshot,
  decideDeposit,
  listWithdrawals,
  decideWithdrawal,
  manualEntry,
  resellerLedger,
  reconcile,
};
