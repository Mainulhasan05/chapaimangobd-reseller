'use strict';

const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');

const ledger = require('./ledger');
const { withTransaction } = require('./tx');
const { notFound } = require('../utils/errors');
const { REVIEW_STATUS, LEDGER_KIND } = require('../domain/constants');

/**
 * The owner's decision on a deposit or a withdrawal, as one transaction.
 *
 * The status flip and the ledger post commit or fail together. Two separate
 * writes let an approval stand with no money moved whenever the second one
 * failed, and let a crash between them leave it that way for good.
 *
 * Two independent guards stay in place inside the transaction: the status
 * predicate stops a second click, and the ledger idempotency key protects the
 * money if anything ever slips past it.
 *
 * Nothing here notifies or audits. The transaction callback may be retried, so
 * side effects belong to the caller, after commit.
 */

/**
 * @returns {Promise<{ deposit: object, entry: object|null }>}
 * @throws 404 NOT_FOUND when there is no pending deposit with that id.
 */
async function decideDeposit({ depositId, approve, actorUser, reason }) {
  return withTransaction(async (session) => {
    const deposit = await Deposit.findOneAndUpdate(
      { _id: depositId, status: REVIEW_STATUS.PENDING },
      {
        $set: {
          status: approve ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
          reviewedBy: actorUser._id,
          reviewedAt: new Date(),
          rejectionReason: approve ? undefined : reason,
        },
      },
      { new: true, session }
    );
    if (!deposit) throw notFound('No pending deposit with that id');
    if (!approve) return { deposit, entry: null };

    // A credit has no limit to check.
    const entry = await ledger.postEntry(session, {
      reseller: deposit.reseller,
      kind: LEDGER_KIND.DEPOSIT_CREDIT,
      amountPoisha: deposit.amountPoisha,
      idempotencyKey: ledger.keys.depositCredit(deposit._id),
      refType: 'deposit',
      refId: deposit._id,
      note: `Deposit via ${deposit.method}`,
      createdBy: actorUser._id,
    });

    deposit.ledgerEntry = entry._id;
    await Deposit.updateOne({ _id: deposit._id }, { $set: { ledgerEntry: entry._id } }, { session });
    return { deposit, entry };
  });
}

/**
 * A withdrawal can never create debt. The debit is guarded by "balance covers
 * the amount" in the same atomic update that moves the balance, and the credit
 * limit is never consulted. If a confirm has spent the balance since the
 * request, approval fails with INSUFFICIENT_BALANCE and the withdrawal stays
 * pending, so the owner can reject it or wait. See docs/adr/0009.
 *
 * @returns {Promise<{ withdrawal: object, entry: object|null }>}
 * @throws 404 NOT_FOUND when there is no pending withdrawal with that id.
 * @throws 409 INSUFFICIENT_BALANCE when the balance no longer covers it.
 */
async function decideWithdrawal({ withdrawalId, approve, actorUser, reason, payoutReference }) {
  return withTransaction(async (session) => {
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: withdrawalId, status: REVIEW_STATUS.PENDING },
      {
        $set: {
          status: approve ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
          reviewedBy: actorUser._id,
          reviewedAt: new Date(),
          payoutReference: approve ? payoutReference : undefined,
          rejectionReason: approve ? undefined : reason,
        },
      },
      { new: true, session }
    );
    if (!withdrawal) throw notFound('No pending withdrawal with that id');
    if (!approve) return { withdrawal, entry: null };

    const entry = await ledger.postEntry(session, {
      reseller: withdrawal.reseller,
      kind: LEDGER_KIND.WITHDRAWAL_DEBIT,
      amountPoisha: -withdrawal.amountPoisha,
      idempotencyKey: ledger.keys.withdrawalDebit(withdrawal._id),
      refType: 'withdrawal',
      refId: withdrawal._id,
      note: `Payout via ${withdrawal.method}`,
      createdBy: actorUser._id,
      requireBalanceAtLeast: withdrawal.amountPoisha,
    });

    withdrawal.ledgerEntry = entry._id;
    await Withdrawal.updateOne(
      { _id: withdrawal._id },
      { $set: { ledgerEntry: entry._id } },
      { session }
    );
    return { withdrawal, entry };
  });
}

module.exports = { decideDeposit, decideWithdrawal };
