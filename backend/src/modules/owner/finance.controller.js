'use strict';

const crypto = require('node:crypto');

const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');
const ResellerProfile = require('../../models/ResellerProfile');
const User = require('../../models/User');
const LedgerEntry = require('../../models/LedgerEntry');

const ledger = require('../../services/ledger');
const { withTransaction } = require('../../services/tx');
const { notify } = require('../../services/notify');
const audit = require('../../services/audit');
const storage = require('../../config/storage');
const { ok } = require('../../middleware/error');
const { notFound, badRequest } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const { REVIEW_STATUS, LEDGER_KIND, EVENT_TYPE } = require('../../domain/constants');

/* ------------------------------------------------------------------ deposits */

async function listDeposits(req, res) {
  const { status, method, page, limit } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (method) filter.method = method;

  const [deposits, total] = await Promise.all([
    Deposit.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'reseller', select: 'shopName slug user', populate: { path: 'user', select: 'name phoneE164' } }),
    Deposit.countDocuments(filter),
  ]);

  return ok(res, {
    deposits: deposits.map((d) => ({
      id: d._id,
      reseller: d.reseller,
      amount: toTaka(d.amountPoisha),
      method: d.method,
      senderNumber: d.senderNumber,
      transactionId: d.transactionId,
      hasScreenshot: Boolean(d.screenshot && d.screenshot.key),
      status: d.status,
      note: d.note,
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
 * Two independent guards. The status predicate stops a second click, and the
 * ledger idempotency key is what actually protects the money if it slips past.
 */
async function decideDeposit(req, res) {
  const approve = req.params.decision === 'approve';

  const deposit = await Deposit.findOneAndUpdate(
    { _id: req.params.id, status: REVIEW_STATUS.PENDING },
    {
      $set: {
        status: approve ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        rejectionReason: approve ? undefined : req.body.reason,
      },
    },
    { new: true }
  );
  if (!deposit) throw notFound('No pending deposit with that id');

  if (approve) {
    const entry = await withTransaction((session) =>
      ledger.postEntry(session, {
        reseller: deposit.reseller,
        kind: LEDGER_KIND.DEPOSIT_CREDIT,
        amountPoisha: deposit.amountPoisha,
        idempotencyKey: ledger.keys.depositCredit(deposit._id),
        refType: 'deposit',
        refId: deposit._id,
        note: `Deposit via ${deposit.method}`,
        createdBy: req.user._id,
        enforceCreditLimit: false,
      })
    );
    await Deposit.updateOne({ _id: deposit._id }, { $set: { ledgerEntry: entry._id } });
  }

  await audit.record({
    actor: req.user._id,
    action: approve ? 'deposit.approve' : 'deposit.reject',
    targetType: 'Deposit',
    targetId: deposit._id,
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
  const { status, page, limit } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'reseller', select: 'shopName slug user', populate: { path: 'user', select: 'name phoneE164' } }),
    Withdrawal.countDocuments(filter),
  ]);

  return ok(res, {
    withdrawals: withdrawals.map((w) => ({
      id: w._id,
      reseller: w.reseller,
      amount: toTaka(w.amountPoisha),
      method: w.method,
      destinationNumber: w.destinationNumber,
      status: w.status,
      note: w.note,
      createdAt: w.createdAt,
    })),
    page,
    limit,
    total,
  });
}

async function decideWithdrawal(req, res) {
  const approve = req.params.decision === 'approve';

  const withdrawal = await Withdrawal.findOneAndUpdate(
    { _id: req.params.id, status: REVIEW_STATUS.PENDING },
    {
      $set: {
        status: approve ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        payoutReference: approve ? req.body.payoutReference : undefined,
        rejectionReason: approve ? undefined : req.body.reason,
      },
    },
    { new: true }
  );
  if (!withdrawal) throw notFound('No pending withdrawal with that id');

  if (approve) {
    try {
      const entry = await withTransaction((session) =>
        ledger.postEntry(session, {
          reseller: withdrawal.reseller,
          kind: LEDGER_KIND.WITHDRAWAL_DEBIT,
          amountPoisha: -withdrawal.amountPoisha,
          idempotencyKey: ledger.keys.withdrawalDebit(withdrawal._id),
          refType: 'withdrawal',
          refId: withdrawal._id,
          note: `Payout via ${withdrawal.method}`,
          createdBy: req.user._id,
          // Paying out may not push a reseller into debt on our books.
          enforceCreditLimit: true,
        })
      );
      await Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { ledgerEntry: entry._id } });
    } catch (err) {
      // The approval must not stand if the money did not move.
      await Withdrawal.updateOne(
        { _id: withdrawal._id },
        { $set: { status: REVIEW_STATUS.PENDING, reviewedAt: null, payoutReference: null } }
      );
      throw err;
    }
  }

  await audit.record({
    actor: req.user._id,
    action: approve ? 'withdrawal.approve' : 'withdrawal.reject',
    targetType: 'Withdrawal',
    targetId: withdrawal._id,
    after: { status: withdrawal.status, amountPoisha: withdrawal.amountPoisha },
    ip: req.ip,
  });

  await notifyReseller(withdrawal.reseller, {
    eventType: approve ? EVENT_TYPE.WITHDRAWAL_APPROVED : EVENT_TYPE.WITHDRAWAL_REJECTED,
    data: {
      amountPoisha: withdrawal.amountPoisha,
      destination: withdrawal.destinationNumber,
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
      enforceCreditLimit: false,
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

  const entries = await LedgerEntry.find({ reseller: req.params.id })
    .sort({ seq: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return ok(res, { entries: entries.map(present.ledgerEntry) });
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
