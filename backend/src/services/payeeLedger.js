'use strict';

const Payee = require('../models/Payee');
const PayeeLedgerEntry = require('../models/PayeeLedgerEntry');
const { PAYEE_LEDGER_KIND } = require('../domain/constants');
const { conflict, notFound } = require('../utils/errors');
const { assertPoisha } = require('../utils/money');

/**
 * The only code permitted to change a payee's due. See docs/adr/0025.
 *
 * Every call must be inside a transaction session, because a due move and its
 * ledger entry are one fact and must commit or fail together.
 *
 * ## Why this is not `services/ledger.js` with a flag
 *
 * The two look alike and mean opposites, and the differences are not
 * parameterisable:
 *
 * - **Direction.** A reseller's `balancePoisha` is negative when they owe us. A
 *   payee's `duePoisha` is positive when we owe them. Sharing one function would
 *   mean a sign convention that is right in one caller and inverted in the other,
 *   which is precisely the bug the separate field names exist to prevent.
 * - **Guards.** Every reseller debit is checked against a credit limit, because
 *   the owner is extending credit and decides how much. **No payee entry is ever
 *   guarded.** A supplier's terms are not ours to enforce, and paying more than
 *   the due is an advance (বায়না), not an error. There is no `bypassCreditLimit`
 *   here because there is nothing to bypass.
 * - **Failure modes.** `InsufficientCreditError` and `InsufficientBalanceError`
 *   have no counterpart. The only thing that can fail here is a duplicate.
 *
 * What *is* shared is the mechanism, deliberately copied rather than abstracted:
 * one atomic `findOneAndUpdate` that moves the due and takes the sequence number
 * together, and a unique `idempotencyKey` that makes a double posting impossible
 * independent of any status guard above it.
 */

/**
 * Deterministic keys. The unique index on `idempotencyKey` is what makes a double
 * posting structurally impossible, whatever a controller does wrong.
 */
const keys = {
  purchase: (purchaseId) => `purchase:${purchaseId}:due:v1`,
  purchaseCancel: (purchaseId) => `purchase:${purchaseId}:cancel:v1`,
  expense: (expenseId) => `expense:${expenseId}:due:v1`,
  payment: (paymentId) => `payment:${paymentId}:v1`,
  reversal: (entryId, reason) => `payee-reversal:${entryId}:${reason}`,
  manual: (nonce) => `payee-manual:${nonce}`,
};

/**
 * Posts one entry and moves the due.
 *
 * The due change and the sequence number happen in a single `findOneAndUpdate`.
 * Reading the due and then writing it would let two concurrent purchases compute
 * the same `dueAfter`, even inside a transaction.
 *
 * @param {import('mongoose').ClientSession} session
 * @param {object} input
 * @param {number} input.amountPoisha Signed. Positive increases what we owe.
 */
async function postEntry(session, input) {
  const {
    payee,
    kind,
    amountPoisha,
    idempotencyKey,
    refType,
    refId = null,
    reversalOf = null,
    note,
    createdBy = null,
  } = input;

  if (!session) throw new Error('postEntry must be called inside a transaction session');
  if (!idempotencyKey) throw new Error('postEntry requires an idempotencyKey');
  assertPoisha(amountPoisha, 'amountPoisha');
  if (amountPoisha === 0) throw new Error('postEntry requires a non-zero amount');

  const payeeId = payee._id || payee;

  // Fast path: this exact entry was already posted, so the due already moved.
  const existing = await PayeeLedgerEntry.findOne({ idempotencyKey }).session(session);
  if (existing) return existing;

  // No filter beyond identity. Nothing about a payee due may be refused.
  const profile = await Payee.findOneAndUpdate(
    { _id: payeeId },
    { $inc: { duePoisha: amountPoisha, ledgerSeq: 1 } },
    { new: true, session }
  );

  if (!profile) throw notFound('Payee not found');

  try {
    const [entry] = await PayeeLedgerEntry.create(
      [
        {
          payee: payeeId,
          seq: profile.ledgerSeq,
          kind,
          amountPoisha,
          dueAfterPoisha: profile.duePoisha,
          idempotencyKey,
          refType,
          refId,
          reversalOf,
          note,
          createdBy,
        },
      ],
      { session }
    );
    return entry;
  } catch (err) {
    // Another transaction posted the same logical entry between our check and our
    // insert. Aborting rolls back the due increment above, so nothing leaks.
    if (err && err.code === 11000) {
      throw conflict('PAYEE_LEDGER_DUPLICATE', 'This entry was already posted, please refresh');
    }
    throw err;
  }
}

/**
 * Reverses an earlier entry with a new entry of the opposite sign. The original
 * is never touched: that is the whole point of an append-only ledger.
 */
async function postReversal(session, originalEntry, { reason, note, createdBy }) {
  if (!originalEntry) throw notFound('Original ledger entry not found');

  return postEntry(session, {
    payee: originalEntry.payee,
    kind: PAYEE_LEDGER_KIND.REVERSAL,
    amountPoisha: -originalEntry.amountPoisha,
    idempotencyKey: keys.reversal(originalEntry._id, reason),
    refType: originalEntry.refType,
    refId: originalEntry.refId,
    reversalOf: originalEntry._id,
    note: note || `Reversal of ${originalEntry.kind}`,
    createdBy,
  });
}

/** Every entry posted against one reference, used to reverse a purchase in full. */
function entriesFor(refType, refId, session) {
  const q = PayeeLedgerEntry.find({ refType, refId, reversalOf: null }).sort({ seq: 1 });
  return session ? q.session(session) : q;
}

/**
 * Sums the ledger for a payee. This is the source of truth; the due stored on the
 * payee is a denormalisation kept for query speed. The reconciliation asserts
 * they agree.
 */
async function computeDue(payeeId) {
  const [row] = await PayeeLedgerEntry.aggregate([
    { $match: { payee: payeeId } },
    { $group: { _id: null, total: { $sum: '$amountPoisha' }, count: { $sum: 1 } } },
  ]);
  return { duePoisha: row ? row.total : 0, entries: row ? row.count : 0 };
}

/**
 * Verifies one payee ledger end to end: the running due is consistent for every
 * consecutive pair, the sequence has no gaps, and the total matches the
 * denormalised due.
 */
async function reconcile(payeeId) {
  const payee = await Payee.findById(payeeId);
  if (!payee) throw notFound('Payee not found');

  const entries = await PayeeLedgerEntry.find({ payee: payeeId }).sort({ seq: 1 }).lean();

  const problems = [];
  let running = 0;

  entries.forEach((entry, i) => {
    running += entry.amountPoisha;
    if (entry.seq !== i + 1) {
      problems.push(`Entry ${entry._id} has seq ${entry.seq}, expected ${i + 1}`);
    }
    if (entry.dueAfterPoisha !== running) {
      problems.push(
        `Entry ${entry._id} records due ${entry.dueAfterPoisha}, running total is ${running}`
      );
    }
  });

  if (running !== payee.duePoisha) {
    problems.push(`Ledger totals ${running} but payee due is ${payee.duePoisha}`);
  }

  return {
    payee: payeeId,
    ok: problems.length === 0,
    ledgerTotalPoisha: running,
    payeeDuePoisha: payee.duePoisha,
    entries: entries.length,
    problems,
  };
}

const RECONCILE_BATCH = 50;

/**
 * Reconciles every payee, a batch at a time so memory and database load stay flat
 * however many there are. Run beside the reseller reconciliation by the nightly
 * job.
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

  const cursor = Payee.find({}, { _id: 1 }).sort({ _id: 1 }).lean().cursor();
  for await (const payee of cursor) {
    batch.push(payee._id);
    // eslint-disable-next-line no-await-in-loop
    if (batch.length >= batchSize) await flush();
  }
  if (batch.length > 0) await flush();

  return { checked, drifted };
}

/**
 * What the owner owes, per payee, summed from the entries rather than read from
 * the denormalised field, so the payables report doubles as a permanent
 * reconciliation check.
 *
 * @param {object} [options]
 * @param {boolean} [options.owingOnly=false] Only payees we actually owe, which
 *   excludes both the settled ones and the ones holding our advance.
 * @returns {Promise<Array<{ payee, duePoisha: number, entries: number }>>} Most
 *   owed first.
 */
async function dueBalances({ owingOnly = false } = {}) {
  const pipeline = [
    {
      $group: {
        _id: '$payee',
        duePoisha: { $sum: '$amountPoisha' },
        entries: { $sum: 1 },
      },
    },
  ];
  if (owingOnly) pipeline.push({ $match: { duePoisha: { $gt: 0 } } });
  pipeline.push({ $sort: { duePoisha: -1, _id: 1 } });

  const rows = await PayeeLedgerEntry.aggregate(pipeline);
  return rows.map((r) => ({ payee: r._id, duePoisha: r.duePoisha, entries: r.entries }));
}

/**
 * Total owed to everyone, from the ledger. Positive poisha.
 *
 * The mirror of `ledger.totalReceivablePoisha()`, and the two must never be
 * netted against each other in a report: what resellers owe the owner and what
 * the owner owes suppliers are different people's money.
 */
async function totalPayablePoisha() {
  const rows = await dueBalances({ owingOnly: true });
  return rows.reduce((sum, r) => sum + r.duePoisha, 0);
}

module.exports = {
  keys,
  postEntry,
  postReversal,
  entriesFor,
  computeDue,
  reconcile,
  reconcileAll,
  dueBalances,
  totalPayablePoisha,
};
