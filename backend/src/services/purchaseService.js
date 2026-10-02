'use strict';

const Payee = require('../models/Payee');
const Supply = require('../models/Supply');
const Purchase = require('../models/Purchase');
const PayeeLedgerEntry = require('../models/PayeeLedgerEntry');
const Expense = require('../models/Expense');
const supplyStock = require('./supplyStock');
const payeeLedger = require('./payeeLedger');
const audit = require('./audit');
const { withTransaction } = require('./tx');
const { costPurchase } = require('../domain/landedCost');
const {
  PURCHASE_STATUS,
  PAYEE_LEDGER_KIND,
  MOVEMENT_KIND,
  ALLOCATION_BASIS,
  EXPENSE_PAYMENT_STATUS,
} = require('../domain/constants');
const { notFound, badRequest, conflict } = require('../utils/errors');
const { businessDate } = require('../utils/dhakaTime');
const { generateOrderCode } = require('../utils/orderCode');

/**
 * Recording and cancelling a purchase.
 *
 * A purchase is three facts that must be one: the goods are on the shelf, the
 * seller is owed, and what a unit cost has changed. Each is written by its own
 * service, and all three commit or none do — the same rule the order transaction
 * follows. See docs/adr/0024.
 *
 * There is no edit. A purchase is cancelled and re-entered, because editing one
 * would have to rewrite a stock movement, a landed cost and a ledger entry, all
 * of which are append-only on purpose.
 */

/** A code the owner and the seller can both quote at a piece of paper. */
const makeCode = () => `P${generateOrderCode(7)}`;

/**
 * Records a purchase: costs it, shelves it, and bills it.
 *
 * @param {object} input
 * @param {string} input.payeeId
 * @param {Array<{ supplyId, qtyMilli, unitCostPoisha }>} input.lines
 * @param {Array<{ kind, amountPoisha, paidTo?, payeeName?, allocate?, note? }>} [input.charges]
 * @param {string} [input.allocationBasis]
 * @param {Date} [input.date] When the goods arrived, not when this was typed.
 */
async function recordPurchase(input) {
  const {
    payeeId,
    lines: rawLines,
    charges = [],
    allocationBasis = ALLOCATION_BASIS.VALUE,
    date = new Date(),
    invoiceNo,
    note,
    actorUser,
    ip,
  } = input;

  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw badRequest('NO_LINES', 'A purchase needs at least one line');
  }

  // Everything read and validated before the transaction opens, so the
  // transaction holds its locks for as short a time as possible.
  const payee = await Payee.findById(payeeId);
  if (!payee) throw notFound('Payee not found');
  if (payee.isArchived) {
    throw badRequest('PAYEE_ARCHIVED', 'This payee is archived; restore them first');
  }

  const supplyIds = rawLines.map((l) => l.supplyId);
  if (new Set(supplyIds.map(String)).size !== supplyIds.length) {
    // Refused rather than merged, for the same reason a packaging recipe refuses
    // a duplicate: a repeat is the owner having picked the same supply twice, and
    // summing them would lose whichever rate was typed second.
    throw badRequest('DUPLICATE_SUPPLY', 'The same supply appears on two lines of this purchase');
  }

  const supplies = await Supply.find({ _id: { $in: supplyIds } });
  const byId = new Map(supplies.map((s) => [String(s._id), s]));
  rawLines.forEach((line, index) => {
    const supply = byId.get(String(line.supplyId));
    if (!supply) throw notFound(`Supply not found on line ${index + 1}`);
    if (supply.isArchived) {
      throw badRequest('SUPPLY_ARCHIVED', `${supply.nameBn} is archived; restore it first`);
    }
  });

  // The whole costing, worked out once, before anything is written.
  const costed = costPurchase(
    rawLines.map((l) => ({ ...l, supply: l.supplyId })),
    charges,
    allocationBasis
  );

  const doc = {
    purchaseCode: makeCode(),
    payee: payee._id,
    payeeNameBn: payee.nameBn,
    businessDate: businessDate(date),
    invoiceNo,
    status: PURCHASE_STATUS.RECEIVED,
    lines: costed.lines.map((line) => {
      const supply = byId.get(String(line.supply));
      return {
        supply: supply._id,
        supplyNameBn: supply.nameBn,
        unit: supply.unit,
        qtyMilli: line.qtyMilli,
        unitCostPoisha: line.unitCostPoisha,
        lineCostPoisha: line.lineCostPoisha,
        allocatedChargePoisha: line.allocatedChargePoisha,
        landedLineCostPoisha: line.landedLineCostPoisha,
        landedUnitCostPoisha: line.landedUnitCostPoisha,
      };
    }),
    charges: costed.charges,
    allocationBasis,
    goodsCostPoisha: costed.goodsCostPoisha,
    chargeTotalPoisha: costed.chargeTotalPoisha,
    payeeTotalPoisha: costed.payeeTotalPoisha,
    otherChargePoisha: costed.otherChargePoisha,
    totalPoisha: costed.totalPoisha,
    note,
    createdBy: actorUser ? actorUser._id : null,
  };

  const purchase = await withTransaction(async (session) => {
    const [created] = await Purchase.create([doc], { session });

    // Shelf first, then the bill. Order does not matter for correctness — they
    // commit together — but reading it this way matches what happened.
    for (const line of created.lines) {
      // eslint-disable-next-line no-await-in-loop
      await supplyStock.receive(session, {
        supply: line.supply,
        qtyMilli: line.qtyMilli,
        landedUnitCostPoisha: line.landedUnitCostPoisha,
        purchaseId: created._id,
        createdBy: doc.createdBy,
        date,
      });
    }

    /*
     * Only what this payee actually billed. A van driver paid in cash at the gate
     * raised the landed cost and is owed nothing, so `payeeTotalPoisha` and not
     * `totalPoisha`. See docs/adr/0023.
     *
     * A purchase of nothing but third-party charges owes no due at all, and a
     * zero entry is not a fact, so it posts none.
     */
    if (created.payeeTotalPoisha > 0) {
      await payeeLedger.postEntry(session, {
        payee: created.payee,
        kind: PAYEE_LEDGER_KIND.PURCHASE,
        amountPoisha: created.payeeTotalPoisha,
        idempotencyKey: payeeLedger.keys.purchase(created._id),
        refType: 'purchase',
        refId: created._id,
        // The day the goods came in, so the ledger and the purchase agree on it.
        businessDate: created.businessDate,
        note: `Purchase ${created.purchaseCode}`,
        createdBy: doc.createdBy,
      });
    }

    return created;
  });

  await audit.record({
    actor: doc.createdBy,
    action: 'purchase.record',
    targetType: 'Purchase',
    targetId: purchase._id,
    after: {
      purchaseCode: purchase.purchaseCode,
      payeeNameBn: purchase.payeeNameBn,
      totalPoisha: purchase.totalPoisha,
      payeeTotalPoisha: purchase.payeeTotalPoisha,
    },
    ip,
  });

  return purchase;
}

/**
 * Cancels a purchase: takes the goods back off the shelf and un-bills the seller.
 *
 * Both sides are reversals, never deletions, so the history says a purchase was
 * recorded and then undone rather than pretending it never happened. The stock
 * reversal is allowed to take the count negative: if the crates have already been
 * used, the shelf is genuinely short and hiding that would be worse than showing
 * it.
 *
 * The average cost is **not** restored to what it was. It cannot be: the average
 * has no memory and later movements were valued at the blended rate. See
 * `supplyStock.reverse`.
 */
async function cancelPurchase({ purchaseId, reason, actorUser, ip }) {
  const existing = await Purchase.findById(purchaseId);
  if (!existing) throw notFound('Purchase not found');
  if (existing.status === PURCHASE_STATUS.CANCELLED) {
    throw conflict('ALREADY_CANCELLED', 'This purchase is already cancelled');
  }

  const actorId = actorUser ? actorUser._id : null;

  const purchase = await withTransaction(async (session) => {
    /*
     * Status-guarded, so two concurrent cancels cannot both proceed. The guard is
     * what makes this safe, not the read above it.
     */
    const claimed = await Purchase.findOneAndUpdate(
      { _id: purchaseId, status: PURCHASE_STATUS.RECEIVED },
      {
        $set: {
          status: PURCHASE_STATUS.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: actorId,
          cancelReason: reason,
        },
      },
      { new: true, session }
    );
    if (!claimed) throw conflict('ALREADY_CANCELLED', 'This purchase is already cancelled');

    for (const line of claimed.lines) {
      // eslint-disable-next-line no-await-in-loop
      await supplyStock.postMovement(session, {
        supply: line.supply,
        kind: MOVEMENT_KIND.REVERSAL,
        qtyMilli: -line.qtyMilli,
        unitCostPoisha: line.landedUnitCostPoisha,
        idempotencyKey: supplyStock.keys.purchaseCancel(claimed._id, line.supply),
        refType: 'purchase',
        refId: claimed._id,
        allowNegative: true,
        note: `Cancelled purchase ${claimed.purchaseCode}`,
        createdBy: actorId,
      });
    }

    const entries = await payeeLedger.entriesFor('purchase', claimed._id, session);
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      await payeeLedger.postReversal(session, entry, {
        reason: 'purchase-cancelled',
        note: `Cancelled purchase ${claimed.purchaseCode}`,
        createdBy: actorId,
      });
    }

    return claimed;
  });

  await audit.record({
    actor: actorId,
    action: 'purchase.cancel',
    targetType: 'Purchase',
    targetId: purchase._id,
    before: { status: PURCHASE_STATUS.RECEIVED },
    after: { status: PURCHASE_STATUS.CANCELLED, cancelReason: reason },
    ip,
  });

  return purchase;
}

/**
 * Pays a payee. Reduces the due, and past zero becomes an advance, which is
 * legitimate and never refused. See docs/adr/0025.
 *
 * @param {string} nonce Supplied by the caller so a double-submitted form cannot
 *   pay the same money twice.
 * @param {Date} [date] When the money was handed over, which is not always the
 *   day it is typed in. Its Dhaka date is the entry's business date.
 */
async function payPayee({ payeeId, amountPoisha, nonce, paidFrom, note, date, actorUser, ip }) {
  if (!Number.isSafeInteger(amountPoisha) || amountPoisha <= 0) {
    throw badRequest('INVALID_AMOUNT', 'A payment must be a whole positive amount');
  }

  const payee = await Payee.findById(payeeId);
  if (!payee) throw notFound('Payee not found');

  const actorId = actorUser ? actorUser._id : null;
  const day = businessDate(date || new Date());

  const entry = await withTransaction((session) =>
    payeeLedger.postEntry(session, {
      payee: payee._id,
      kind: PAYEE_LEDGER_KIND.PAYMENT,
      // Negative: a payment reduces what we owe.
      amountPoisha: -amountPoisha,
      idempotencyKey: payeeLedger.keys.payment(payee._id, nonce),
      legacyKeys: [payeeLedger.legacyKeys.payment(nonce)],
      refType: 'payment',
      businessDate: day,
      note: note || (paidFrom ? `Paid by ${paidFrom}` : 'Payment'),
      createdBy: actorId,
    })
  );

  await audit.record({
    actor: actorId,
    action: 'payee.payment',
    targetType: 'Payee',
    targetId: payee._id,
    before: { duePoisha: payee.duePoisha },
    after: { duePoisha: entry.dueAfterPoisha, amountPoisha, paidFrom, businessDate: day },
    ip,
  });

  return entry;
}

/**
 * The entries an owner may take back by hand: a payment, and the three kinds a
 * person types. Everything else answers to its own record and is undone there —
 * a purchase is cancelled (docs/adr/0024), an expense is voided — because
 * reversing its due alone would leave the purchase standing and owed by nobody.
 * A reversal is never itself reversed: the remedy for a wrong correction is the
 * original entry posted again, which says what happened, not a reversal of a
 * reversal, which only says that somebody changed their mind twice.
 */
const REVERSIBLE_KINDS = Object.freeze([
  PAYEE_LEDGER_KIND.PAYMENT,
  PAYEE_LEDGER_KIND.OPENING,
  PAYEE_LEDGER_KIND.ADJUSTMENT,
  PAYEE_LEDGER_KIND.DISCOUNT,
]);

/** Whether an entry is one the owner may reverse, before asking whether it was. */
const isReversible = (entry) => REVERSIBLE_KINDS.includes(entry.kind) && !entry.reversalOf;

const notReversibleMessage = (entry) => {
  if (entry.kind === PAYEE_LEDGER_KIND.PURCHASE) return 'A purchase is undone by cancelling it';
  if (entry.kind === PAYEE_LEDGER_KIND.EXPENSE) return 'An expense is undone by voiding it';
  return 'This entry cannot be reversed';
};

/**
 * Takes back a wrong payment or a wrong hand-typed entry with a new entry of the
 * opposite sign. The original stays exactly as it was: the history says a
 * payment was recorded and then reversed, with the reason, which is what settles
 * the argument with the seller later. See docs/adr/0002.
 *
 * A payment that settled an expense puts that expense back to unpaid in the same
 * transaction, so the expense list and the due never tell two stories. A voided
 * expense is left alone: its obligation was already reversed, and the payment
 * coming back is what squares the account.
 *
 * Once only. The check before the transaction gives the clear answer; the one
 * inside it, and the deterministic key under both, are what make it hold when two
 * taps arrive together.
 *
 * @throws 404 NOT_FOUND when the entry is not on this payee's ledger.
 * @throws 400 ENTRY_NOT_REVERSIBLE for a purchase, an expense or a reversal.
 * @throws 409 ALREADY_REVERSED when it has been reversed before.
 */
async function reversePayeeEntry({ payeeId, entryId, reason, actorUser, ip }) {
  const payee = await Payee.findById(payeeId);
  if (!payee) throw notFound('Payee not found');

  const original = await PayeeLedgerEntry.findOne({ _id: entryId, payee: payee._id });
  if (!original) throw notFound('Ledger entry not found');
  if (!isReversible(original)) {
    throw badRequest('ENTRY_NOT_REVERSIBLE', notReversibleMessage(original));
  }
  const already = () => conflict('ALREADY_REVERSED', 'This entry has already been reversed');
  if (await PayeeLedgerEntry.exists({ reversalOf: original._id })) throw already();

  const actorId = actorUser ? actorUser._id : null;

  const { entry, expense } = await withTransaction(async (session) => {
    if (await PayeeLedgerEntry.exists({ reversalOf: original._id }).session(session)) {
      throw already();
    }

    const posted = await payeeLedger.postReversal(session, original, {
      reason: 'owner',
      note: reason,
      createdBy: actorId,
    });

    let reopened = null;
    if (original.kind === PAYEE_LEDGER_KIND.PAYMENT && original.refId) {
      reopened = await Expense.findOneAndUpdate(
        { _id: original.refId, paymentEntry: original._id, voidedAt: null },
        {
          $set: {
            paymentStatus: EXPENSE_PAYMENT_STATUS.UNPAID,
            paidAt: null,
            paymentEntry: null,
          },
        },
        { new: true, session }
      );
    }

    return { entry: posted, expense: reopened };
  });

  await audit.record({
    actor: actorId,
    action: 'payee.reverse',
    targetType: 'Payee',
    targetId: payee._id,
    before: {
      entryId: original._id,
      kind: original.kind,
      amountPoisha: original.amountPoisha,
      duePoisha: entry.dueAfterPoisha + original.amountPoisha,
    },
    after: {
      reversalId: entry._id,
      duePoisha: entry.dueAfterPoisha,
      reason,
      ...(expense ? { expenseReopened: expense._id } : {}),
    },
    ip,
  });

  return { entry, original, expense };
}

module.exports = {
  recordPurchase,
  cancelPurchase,
  payPayee,
  reversePayeeEntry,
  isReversible,
  REVERSIBLE_KINDS,
};
