'use strict';

const crypto = require('node:crypto');

const LedgerEntry = require('../../models/LedgerEntry');
const ResellerProfile = require('../../models/ResellerProfile');
const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');

const ledger = require('../../services/ledger');
const { withTransaction } = require('../../services/tx');
const { getSettings } = require('../../services/settings');
const cloud = require('../../config/cloudinary');
const { ok } = require('../../middleware/error');
const { badRequest, forbidden } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const { normalizeBdPhone } = require('../../utils/phone');
const present = require('../../utils/present');
const { REVIEW_STATUS, LEDGER_KIND } = require('../../domain/constants');

const getWallet = async (req, res) => ok(res, { wallet: present.wallet(req.reseller) });

async function getLedger(req, res) {
  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 25), 100);

  const [entries, total] = await Promise.all([
    LedgerEntry.find({ reseller: req.reseller._id })
      .sort({ seq: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LedgerEntry.countDocuments({ reseller: req.reseller._id }),
  ]);

  return ok(res, { entries: entries.map(present.ledgerEntry), page, limit, total });
}

/* -------------------------------------------------------------------- deposits */

async function createDeposit(req, res) {
  const amountPoisha = toPoisha(req.body.amount, 'amount');
  const { method, transactionId, note } = req.body;

  let screenshot;
  if (req.file) {
    // A bKash screenshot carries a phone number and a transaction trail, so it
    // gets the same private treatment as a national ID scan.
    const uploaded = await cloud.uploadBuffer(req.file.buffer, {
      folder: cloud.FOLDERS.DEPOSIT,
      isPrivate: true,
    });
    screenshot = { publicId: uploaded.public_id, format: uploaded.format };
  }

  const deposit = await Deposit.create({
    reseller: req.reseller._id,
    amountPoisha,
    method,
    senderNumber: req.body.senderNumber
      ? normalizeBdPhone(req.body.senderNumber, 'senderNumber')
      : undefined,
    transactionId: transactionId || undefined,
    screenshot,
    note,
  });

  return ok(res, { deposit: presentDeposit(deposit) }, 201);
}

const presentDeposit = (d) => ({
  id: d._id,
  amount: toTaka(d.amountPoisha),
  method: d.method,
  transactionId: d.transactionId,
  status: d.status,
  note: d.note,
  rejectionReason: d.rejectionReason,
  createdAt: d.createdAt,
  reviewedAt: d.reviewedAt,
});

async function listDeposits(req, res) {
  const deposits = await Deposit.find({ reseller: req.reseller._id })
    .sort({ createdAt: -1 })
    .limit(100);
  return ok(res, { deposits: deposits.map(presentDeposit) });
}

/* ----------------------------------------------------------------- withdrawals */

const presentWithdrawal = (w) => ({
  id: w._id,
  amount: toTaka(w.amountPoisha),
  method: w.method,
  destinationNumber: w.destinationNumber,
  status: w.status,
  note: w.note,
  rejectionReason: w.rejectionReason,
  payoutReference: w.payoutReference,
  createdAt: w.createdAt,
  reviewedAt: w.reviewedAt,
});

/**
 * Cash on delivery leaves margin sitting in the wallet, so there has to be a way
 * out. A request only makes sense up to what is actually there: the credit limit
 * is headroom for buying stock, not cash the reseller may withdraw.
 */
async function createWithdrawal(req, res) {
  const amountPoisha = toPoisha(req.body.amount, 'amount');

  if (amountPoisha > req.reseller.balancePoisha) {
    throw badRequest('INSUFFICIENT_BALANCE', 'You cannot withdraw more than your balance', {
      amount: `At most ${toTaka(Math.max(req.reseller.balancePoisha, 0))} taka`,
    });
  }

  const pending = await Withdrawal.exists({
    reseller: req.reseller._id,
    status: REVIEW_STATUS.PENDING,
  });
  if (pending) {
    throw badRequest('WITHDRAWAL_PENDING', 'You already have a withdrawal request waiting');
  }

  const withdrawal = await Withdrawal.create({
    reseller: req.reseller._id,
    amountPoisha,
    method: req.body.method,
    destinationNumber: normalizeBdPhone(req.body.destinationNumber, 'destinationNumber'),
    note: req.body.note,
  });

  return ok(res, { withdrawal: presentWithdrawal(withdrawal) }, 201);
}

async function listWithdrawals(req, res) {
  const withdrawals = await Withdrawal.find({ reseller: req.reseller._id })
    .sort({ createdAt: -1 })
    .limit(100);
  return ok(res, { withdrawals: withdrawals.map(presentWithdrawal) });
}

/* ----------------------------------------------------------------------- sms */

/**
 * Credits are bought with wallet balance at a price the owner sets. Hidden behind
 * the SMS feature flag at launch, so this is reachable only once the owner turns
 * it on. The debit and the credit increment are one transaction: a reseller must
 * never pay for credits that did not arrive.
 */
async function purchaseSms(req, res) {
  const settings = await getSettings();
  if (!settings.features.sms) throw forbidden('SMS is not available yet');

  const { credits } = req.body;
  const costPoisha = credits * settings.smsPricePerCreditPoisha;
  const purchaseId = crypto.randomUUID();

  const profile = await withTransaction(async (session) => {
    await ledger.postEntry(session, {
      reseller: req.reseller._id,
      kind: LEDGER_KIND.SMS_PURCHASE_DEBIT,
      amountPoisha: -costPoisha,
      idempotencyKey: ledger.keys.smsPurchase(purchaseId),
      refType: 'sms',
      note: `${credits} SMS credits`,
      createdBy: req.user._id,
    });

    return ResellerProfile.findOneAndUpdate(
      { _id: req.reseller._id },
      { $inc: { smsCredits: credits } },
      { new: true, session }
    );
  });

  return ok(res, { smsCredits: profile.smsCredits, charged: toTaka(costPoisha) });
}

module.exports = {
  getWallet,
  getLedger,
  createDeposit,
  listDeposits,
  createWithdrawal,
  listWithdrawals,
  purchaseSms,
  presentDeposit,
  presentWithdrawal,
};
