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

/** A withdrawal larger than what is actually in the wallet. See docs/adr/0009. */
class InsufficientBalanceError extends AppError {
  constructor(message = 'The balance is no longer enough to cover this withdrawal') {
    super(409, 'INSUFFICIENT_BALANCE', message);
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Deterministic keys. The unique index on idempotencyKey is what makes a double
 * credit structurally impossible, independent of any status guard above it.
 */
const keys = {
  orderCost: (orderId) => `order:${orderId}:cost:v1`,
  orderDelivery: (orderId) => `order:${orderId}:delivery:v1`,
  // `n` is the order's deliveryAdjustmentCount after its increment, so the first
  // adjustment is 1. See docs/adr/0010.
  deliveryAdjustment: (orderId, n) => `order:${orderId}:delivery-adjust:${n}`,
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
 * A debit is guarded by exactly one predicate, chosen by the caller:
 *   default                 post-change balance >= -creditLimit
 *   bypassCreditLimit       no predicate. Reversals and owner-side corrections:
 *                           reality already happened.
 *   requireBalanceAtLeast   balance >= this many poisha, credit limit never
 *                           consulted. Withdrawals: paying out can never create
 *                           debt. See docs/adr/0009.
 * A credit never needs a predicate.
 *
 * @param {import('mongoose').ClientSession} session
 * @param {object} input
 * @param {number} input.amountPoisha Signed. Negative debits, positive credits.
 * @param {boolean} [input.bypassCreditLimit=false]
 * @param {number} [input.requireBalanceAtLeast] Poisha. Replaces the credit-limit guard.
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
    bypassCreditLimit = false,
    requireBalanceAtLeast,
  } = input;

  if (!session) throw new Error('postEntry must be called inside a transaction session');
  if (!idempotencyKey) throw new Error('postEntry requires an idempotencyKey');
  assertPoisha(amountPoisha, 'amountPoisha');
  if (amountPoisha === 0) throw new Error('postEntry requires a non-zero amount');
  if (requireBalanceAtLeast !== undefined) {
    assertPoisha(requireBalanceAtLeast, 'requireBalanceAtLeast');
  }

  const resellerId = reseller._id || reseller;

  // Fast path: this exact entry was already posted, so the balance already moved.
  const existing = await LedgerEntry.findOne({ idempotencyKey }).session(session);
  if (existing) return existing;

  const filter = { _id: resellerId };
  const isDebit = amountPoisha < 0;
  const balanceGuard = isDebit && requireBalanceAtLeast !== undefined;
  const limitGuard = isDebit && !balanceGuard && !bypassCreditLimit;

  if (balanceGuard) {
    filter.balancePoisha = { $gte: requireBalanceAtLeast };
  } else if (limitGuard) {
    // Evaluated against the post-change balance.
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
    if (balanceGuard) throw new InsufficientBalanceError();
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
 * Every reversal bypasses the credit limit, including the reversal of a credit
 * such as a cash on delivery collection. A limit governs new commitments; a
 * parcel that came back has already come back. See docs/adr/0008.
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
    bypassCreditLimit: true,
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

const RECONCILE_BATCH = 50;

/**
 * Reconciles every reseller. Run nightly by the job runner and on demand from
 * the owner panel.
 *
 * Walks the profiles with a cursor and checks them a batch at a time, so memory
 * and database load stay flat however many resellers there are.
 *
 * @param {object} [options]
 * @param {number} [options.batchSize=50]
 * @returns {Promise<{
 *   checked: number,
 *   drifted: Array<{
 *     reseller: import('mongoose').Types.ObjectId,
 *     ok: false,
 *     ledgerTotalPoisha: number,
 *     profileBalancePoisha: number,
 *     entries: number,
 *     problems: string[],
 *   }>,
 * }>} `checked` counts every reseller examined; `drifted` holds the full
 *   `reconcile()` report of each one whose ledger disagrees with itself or with
 *   the stored balance. An empty `drifted` means the books are sound.
 */
async function reconcileAll({ batchSize = RECONCILE_BATCH } = {}) {
  const drifted = [];
  let checked = 0;
  let batch = [];

  const flush = async () => {
    const results = await Promise.all(batch.map((id) => reconcile(id)));
    checked += results.length;
    results.filter((r) => !r.ok).forEach((r) => drifted.push(r));
    batch = [];
  };

  const cursor = ResellerProfile.find({}, { _id: 1 }).sort({ _id: 1 }).lean().cursor();
  for await (const profile of cursor) {
    batch.push(profile._id);
    // eslint-disable-next-line no-await-in-loop
    if (batch.length >= batchSize) await flush();
  }
  if (batch.length > 0) await flush();

  return { checked, drifted };
}

/**
 * Every reseller's balance as the ledger has it, which is the number a dispute
 * is settled on. Summed from the entries rather than read from the profile, so
 * a report built on this doubles as a permanent reconciliation check.
 *
 * @param {object} [options]
 * @param {boolean} [options.owingOnly=false] Only resellers whose ledger is negative.
 * @returns {Promise<Array<{
 *   reseller: import('mongoose').Types.ObjectId,
 *   balancePoisha: number,
 *   entries: number,
 * }>>} Most owed first.
 */
async function ledgerBalances({ owingOnly = false } = {}) {
  const pipeline = [
    {
      $group: {
        _id: '$reseller',
        balancePoisha: { $sum: '$amountPoisha' },
        entries: { $sum: 1 },
      },
    },
  ];
  if (owingOnly) pipeline.push({ $match: { balancePoisha: { $lt: 0 } } });
  pipeline.push({ $sort: { balancePoisha: 1, _id: 1 } });

  const rows = await LedgerEntry.aggregate(pipeline);
  return rows.map((r) => ({ reseller: r._id, balancePoisha: r.balancePoisha, entries: r.entries }));
}

/** Total owed to the owner across every reseller, from the ledger. Positive poisha. */
async function totalReceivablePoisha() {
  const rows = await ledgerBalances({ owingOnly: true });
  return rows.reduce((sum, r) => sum - r.balancePoisha, 0);
}

module.exports = {
  keys,
  postEntry,
  postReversal,
  entriesFor,
  computeBalance,
  reconcile,
  reconcileAll,
  ledgerBalances,
  totalReceivablePoisha,
  InsufficientCreditError,
  InsufficientBalanceError,
};
