'use strict';

const Expense = require('../models/Expense');
const ExpenseCategory = require('../models/ExpenseCategory');
const Payee = require('../models/Payee');
const Order = require('../models/Order');
const payeeLedger = require('./payeeLedger');
const audit = require('./audit');
const { withTransaction } = require('./tx');
const {
  EXPENSE_SCOPE,
  CATEGORY_SCOPE,
  EXPENSE_PAYMENT_STATUS,
  PAYEE_LEDGER_KIND,
} = require('../domain/constants');
const { notFound, badRequest, conflict } = require('../utils/errors');
const { businessDate } = require('../utils/dhakaTime');

/**
 * Recording and voiding an expense.
 *
 * An expense is money that left the business and is not recorded anywhere else.
 * The fruit's cost is a snapshot on an order line and the crate's cost is a stock
 * movement; everything else — লেবার, পরিবহন, কুরিয়ার, rent — is one of these.
 *
 * The only interesting rule is the scope. See docs/adr/0027.
 */

/**
 * Whether a category may be used at this scope.
 *
 * This is the check that keeps লেবার খরচ off an individual order. It refuses
 * rather than silently reinterpreting, because an expense filed at the wrong
 * scope is not a cosmetic error: an order-scope labour cost would be summed into
 * one parcel's margin and believed.
 */
function assertScope(category, scope) {
  if (category.scope === CATEGORY_SCOPE.BOTH) return;
  if (category.scope !== scope) {
    const wanted = category.scope === CATEGORY_SCOPE.ORDER ? 'an order' : 'a period';
    throw badRequest(
      'WRONG_EXPENSE_SCOPE',
      `${category.nameBn} is recorded against ${wanted}`,
      { scope: `${category.nameBn} is recorded against ${wanted}` }
    );
  }
}

/**
 * Records an expense, and posts a due when it is unpaid and names a payee.
 *
 * @param {object} input
 * @param {string} input.categoryId
 * @param {number} input.amountPoisha
 * @param {string} [input.orderId] Required when the category is order scope.
 * @param {string} [input.payeeId]
 * @param {string} [input.paymentStatus] `paid` (default) or `unpaid`.
 */
async function recordExpense(input) {
  const {
    categoryId,
    amountPoisha,
    orderId = null,
    payeeId = null,
    paymentStatus = EXPENSE_PAYMENT_STATUS.PAID,
    paidFrom,
    date = new Date(),
    note,
    actorUser,
    ip,
  } = input;

  if (!Number.isSafeInteger(amountPoisha) || amountPoisha <= 0) {
    throw badRequest('INVALID_AMOUNT', 'An expense must be a whole positive amount');
  }

  const category = await ExpenseCategory.findById(categoryId);
  if (!category) throw notFound('Expense category not found');
  if (category.isArchived) {
    throw badRequest('CATEGORY_ARCHIVED', `${category.nameBn} is archived; restore it first`);
  }

  // The scope is decided by the category and the presence of an order, then
  // checked. It is never inferred again after this point.
  const scope = orderId ? EXPENSE_SCOPE.ORDER : EXPENSE_SCOPE.PERIOD;
  assertScope(category, scope);

  let order = null;
  if (orderId) {
    order = await Order.findById(orderId, { orderCode: 1 });
    if (!order) throw notFound('Order not found');
  }

  let payee = null;
  if (payeeId) {
    payee = await Payee.findById(payeeId);
    if (!payee) throw notFound('Payee not found');
  }

  const unpaid = paymentStatus === EXPENSE_PAYMENT_STATUS.UNPAID;
  if (unpaid && !payee) {
    // An unpaid expense owed to nobody is not a fact anyone can act on: there is
    // no one to pay and no due to clear.
    throw badRequest('PAYEE_REQUIRED', 'Say who an unpaid expense is owed to', {
      payeeId: 'Say who this is owed to',
    });
  }

  const actorId = actorUser ? actorUser._id : null;

  const expense = await withTransaction(async (session) => {
    const [created] = await Expense.create(
      [
        {
          category: category._id,
          categoryNameBn: category.nameBn,
          scope,
          amountPoisha,
          businessDate: businessDate(date),
          order: order ? order._id : null,
          orderCode: order ? order.orderCode : null,
          payee: payee ? payee._id : null,
          payeeNameBn: payee ? payee.nameBn : null,
          paymentStatus,
          paidFrom,
          note,
          createdBy: actorId,
        },
      ],
      { session }
    );

    /*
     * Unpaid plus a payee is a due, so a month of courier bills accumulates into
     * one payable instead of thirty forgotten rows. A paid expense posts nothing:
     * the money is already gone and there is no cash book for it to leave.
     */
    if (unpaid) {
      const entry = await payeeLedger.postEntry(session, {
        payee: payee._id,
        kind: PAYEE_LEDGER_KIND.EXPENSE,
        amountPoisha,
        idempotencyKey: payeeLedger.keys.expense(created._id),
        refType: 'expense',
        refId: created._id,
        note: `${category.nameBn}${note ? ` — ${note}` : ''}`,
        createdBy: actorId,
      });
      await Expense.updateOne(
        { _id: created._id },
        { $set: { ledgerEntry: entry._id } },
        { session }
      );
      created.ledgerEntry = entry._id;
    }

    return created;
  });

  await audit.record({
    actor: actorId,
    action: 'expense.record',
    targetType: 'Expense',
    targetId: expense._id,
    after: {
      categoryNameBn: expense.categoryNameBn,
      scope: expense.scope,
      amountPoisha: expense.amountPoisha,
      paymentStatus: expense.paymentStatus,
      orderCode: expense.orderCode,
    },
    ip,
  });

  return expense;
}

/**
 * Voids an expense. Never deletes one: a month's total must not change behind a
 * report that has already been printed.
 *
 * A voided expense that had posted a due has that due reversed, because the
 * obligation went away with it.
 */
async function voidExpense({ expenseId, reason, actorUser, ip }) {
  const existing = await Expense.findById(expenseId);
  if (!existing) throw notFound('Expense not found');
  if (existing.voidedAt) throw conflict('ALREADY_VOIDED', 'This expense is already void');

  const actorId = actorUser ? actorUser._id : null;

  const expense = await withTransaction(async (session) => {
    // Status-guarded, so two concurrent voids cannot both reverse the due.
    const claimed = await Expense.findOneAndUpdate(
      { _id: expenseId, voidedAt: null },
      { $set: { voidedAt: new Date(), voidedBy: actorId, voidReason: reason } },
      { new: true, session }
    );
    if (!claimed) throw conflict('ALREADY_VOIDED', 'This expense is already void');

    const entries = await payeeLedger.entriesFor('expense', claimed._id, session);
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      await payeeLedger.postReversal(session, entry, {
        reason: 'expense-voided',
        note: `Voided ${claimed.categoryNameBn}`,
        createdBy: actorId,
      });
    }

    return claimed;
  });

  await audit.record({
    actor: actorId,
    action: 'expense.void',
    targetType: 'Expense',
    targetId: expense._id,
    before: { voidedAt: null, amountPoisha: expense.amountPoisha },
    after: { voidedAt: expense.voidedAt, voidReason: reason },
    ip,
  });

  return expense;
}

/** The six the owner named, for a fresh install. Idempotent: skips what exists. */
const DEFAULT_CATEGORIES = [
  { nameBn: 'লেবার খরচ', scope: CATEGORY_SCOPE.PERIOD, sortOrder: 10 },
  { nameBn: 'পরিবহন খরচ', scope: CATEGORY_SCOPE.PERIOD, sortOrder: 20 },
  { nameBn: 'কুরিয়ার খরচ', scope: CATEGORY_SCOPE.ORDER, sortOrder: 30 },
  { nameBn: 'হোম ডেলিভারি এক্সট্রা', scope: CATEGORY_SCOPE.ORDER, sortOrder: 40 },
  { nameBn: 'প্যাকেজিং খরচ', scope: CATEGORY_SCOPE.BOTH, sortOrder: 50 },
  { nameBn: 'অন্যান্য', scope: CATEGORY_SCOPE.BOTH, sortOrder: 60 },
];

async function seedCategories() {
  const created = [];
  for (const row of DEFAULT_CATEGORIES) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await ExpenseCategory.findOne({ nameBn: row.nameBn });
    if (exists) continue;
    // eslint-disable-next-line no-await-in-loop
    created.push(await ExpenseCategory.create(row));
  }
  return created;
}

module.exports = { recordExpense, voidExpense, seedCategories, DEFAULT_CATEGORIES, assertScope };
