'use strict';

const ResellerProfile = require('../models/ResellerProfile');
const LedgerEntry = require('../models/LedgerEntry');
const { LEDGER_KIND } = require('../domain/constants');
const { AppError, conflict, notFound } = require('../utils/errors');
const { assertPoisha } = require('../utils/money');

/**
 * The only code permitted to change a reseller balance. See docs/adr/0002.
 *
 * Every call must be inside a transaction session, because a balance move and its
 * ledger entry are one fact and must commit or fail together.
 */

class InsufficientCreditError extends AppError {
  constructor(message = 'This order would take the balance past the credit limit') {
    super(409, 'CREDIT_LIMIT_EXCEEDED', message);
    this.name = 'InsufficientCreditError';
  }
}

/**
 * Deterministic keys. The unique index on idempotencyKey is what makes a double
 * credit structurally impossible, independent of any status guard above it.
 */
const keys = {
  orderCost: (orderId) => `order:${orderId}:cost:v1`,
  orderDelivery: (orderId) => `order:${orderId}:delivery:v1`,
  codCollection: (orderId) => `order:${orderId}:cod:v1`,
  depositCredit: (depositId) => `deposit:${depositId}:credit:v1`,
  withdrawalDebit: (withdrawalId) => `withdrawal:${withdrawalId}:debit:v1`,
  smsPurchase: (purchaseId) => `sms:${purchaseId}:debit:v1`,
  reversal: (entryId, reason) => `reversal:${entryId}:${reason}`,
  manual: (nonce) => `manual:${nonce}`,
};

/**
 * Posts one entry and moves the balance.
 *
 * The balance change, the sequence number and the credit-limit check all happen in
 * a single findOneAndUpdate. Reading the balance and then writing it would let two
 * concurrent confirms compute the same balanceAfter, even inside a transaction.
 * Putting the credit limit in the filter as $expr also removes a time-of-check to
 * time-of-use race with the owner editing the limit mid-flight.
 *
 * @param {import('mongoose').ClientSession} session
 * @param {object} input
 * @param {number} input.amountPoisha Signed. Negative debits, positive credits.
 */
async function postEntry(session, input) {
  const {
    reseller,
    kind,
    amountPoisha,
    idempotencyKey,
    refType,
    refId = null,
    reversalOf = null,
    reversedLineItemId = null,
    note,
    createdBy = null,
    enforceCreditLimit = true,
  } = input;

  if (!session) throw new Error('postEntry must be called inside a transaction session');
  if (!idempotencyKey) throw new Error('postEntry requires an idempotencyKey');
  assertPoisha(amountPoisha, 'amountPoisha');
  if (amountPoisha === 0) throw new Error('postEntry requires a non-zero amount');

  const resellerId = reseller._id || reseller;

  // Fast path: this exact entry was already posted, so the balance already moved.
  const existing = await LedgerEntry.findOne({ idempotencyKey }).session(session);
  if (existing) return existing;

  const filter = { _id: resellerId };

  // A credit never needs a limit check. A debit is only allowed as far as the
  // reseller credit limit, evaluated against the post-change balance.
  if (enforceCreditLimit && amountPoisha < 0) {
    filter.$expr = {
      $gte: [
        { $add: ['$balancePoisha', amountPoisha] },
        { $multiply: [-1, '$creditLimitPoisha'] },
      ],
    };
  }

  const profile = await ResellerProfile.findOneAndUpdate(
    filter,
    { $inc: { balancePoisha: amountPoisha, ledgerSeq: 1 } },
    { new: true, session }
  );

  if (!profile) {
    // Distinguish "no such reseller" from "the guard refused".
    const exists = await ResellerProfile.exists({ _id: resellerId }).session(session);
    if (!exists) throw notFound('Reseller not found');
    throw new InsufficientCreditError();
  }

  try {
    const [entry] = await LedgerEntry.create(
      [
        {
          reseller: resellerId,
          seq: profile.ledgerSeq,
          kind,
          amountPoisha,
          balanceAfterPoisha: profile.balancePoisha,
          idempotencyKey,
          refType,
          refId,
          reversalOf,
          reversedLineItemId,
          note,
          createdBy,
        },
      ],
      { session }
    );
    return entry;
  } catch (err) {
    // Another transaction posted the same logical entry between our check and our
    // insert. Aborting rolls back the balance increment above, so nothing leaks.
    if (err && err.code === 11000) {
      throw conflict('LEDGER_DUPLICATE', 'This entry was already posted, please refresh');
    }
    throw err;
  }
}

/**
 * Reverses an earlier entry with a new entry of the opposite sign.
 * The original is never touched: that is the whole point of an append-only ledger.
 *
 * The credit-limit guard is deliberately off for reversals of debits, since giving
 * money back must never be blocked by a limit.
 */
async function postReversal(session, originalEntry, { reason, note, createdBy, lineItemId = null }) {
  if (!originalEntry) throw notFound('Original ledger entry not found');

  return postEntry(session, {
    reseller: originalEntry.reseller,
    kind: LEDGER_KIND.REVERSAL,
    amountPoisha: -originalEntry.amountPoisha,
    idempotencyKey: keys.reversal(originalEntry._id, reason),
    refType: originalEntry.refType,
    refId: originalEntry.refId,
    reversalOf: originalEntry._id,
    reversedLineItemId: lineItemId,
    note: note || `Reversal of ${originalEntry.kind}`,
    createdBy,
    enforceCreditLimit: originalEntry.amountPoisha > 0,
  });
}

/** Every entry posted against one reference, used to reverse an order in full. */
function entriesFor(refType, refId, session) {
  const q = LedgerEntry.find({ refType, refId, reversalOf: null }).sort({ seq: 1 });
  return session ? q.session(session) : q;
}

/**
 * Sums the ledger for a reseller. This is the source of truth; the balance stored
 * on the profile is a denormalisation kept for query speed and for the atomic
 * credit-limit guard. The reconciliation job asserts they agree.
 */
async function computeBalance(resellerId) {
  const [row] = await LedgerEntry.aggregate([
    { $match: { reseller: resellerId } },
    { $group: { _id: null, total: { $sum: '$amountPoisha' }, count: { $sum: 1 } } },
  ]);
  return { balancePoisha: row ? row.total : 0, entries: row ? row.count : 0 };
}

/**
 * Verifies one reseller ledger end to end: the running balance is consistent for
 * every consecutive pair, the sequence has no gaps, and the total matches the
 * denormalised balance.
 */
async function reconcile(resellerId) {
  const profile = await ResellerProfile.findById(resellerId);
  if (!profile) throw notFound('Reseller not found');

  const entries = await LedgerEntry.find({ reseller: resellerId }).sort({ seq: 1 }).lean();

  const problems = [];
  let running = 0;

  entries.forEach((entry, i) => {
    running += entry.amountPoisha;
    if (entry.seq !== i + 1) {
      problems.push(`Entry ${entry._id} has seq ${entry.seq}, expected ${i + 1}`);
    }
    if (entry.balanceAfterPoisha !== running) {
      problems.push(
        `Entry ${entry._id} records balance ${entry.balanceAfterPoisha}, running total is ${running}`
      );
    }
  });

  if (running !== profile.balancePoisha) {
    problems.push(`Ledger totals ${running} but profile balance is ${profile.balancePoisha}`);
  }

  return {
    reseller: resellerId,
    ok: problems.length === 0,
    ledgerTotalPoisha: running,
    profileBalancePoisha: profile.balancePoisha,
    entries: entries.length,
    problems,
  };
}

/** Reconciles every reseller. Run nightly and on demand from the owner panel. */
async function reconcileAll() {
  const profiles = await ResellerProfile.find({}, { _id: 1 }).lean();
  const results = await Promise.all(profiles.map((p) => reconcile(p._id)));
  return { checked: results.length, drifted: results.filter((r) => !r.ok) };
}

module.exports = {
  keys,
  postEntry,
  postReversal,
  entriesFor,
  computeBalance,
  reconcile,
  reconcileAll,
  InsufficientCreditError,
};
