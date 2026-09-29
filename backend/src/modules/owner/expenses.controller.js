'use strict';

const Expense = require('../../models/Expense');
const ExpenseCategory = require('../../models/ExpenseCategory');

const expenseService = require('../../services/expenseService');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const { startOfBusinessDay } = require('../../utils/dhakaTime');
const { EXPENSE_SCOPE } = require('../../domain/constants');

/**
 * Expenses, and the categories they are filed under. See docs/adr/0027.
 *
 * The one thing to keep straight is the scope. An **order** expense belongs to
 * one parcel and counts toward its margin; a **period** expense belongs to a day
 * and is never divided across parcels.
 */

const presentCategory = (c) => ({
  id: c._id,
  nameBn: c.nameBn,
  scope: c.scope,
  note: c.note || null,
  isArchived: c.isArchived,
  sortOrder: c.sortOrder,
});

const present = (e) => ({
  id: e._id,
  category: e.category,
  categoryNameBn: e.categoryNameBn,
  scope: e.scope,
  amount: toTaka(e.amountPoisha),
  businessDate: e.businessDate,
  order: e.order || null,
  orderCode: e.orderCode || null,
  payee: e.payee || null,
  payeeNameBn: e.payeeNameBn || null,
  paymentStatus: e.paymentStatus,
  paidFrom: e.paidFrom || null,
  // Set when this expense raised a payee's due, which is what voiding reverses.
  ledgerEntry: e.ledgerEntry || null,
  isVoided: Boolean(e.voidedAt),
  voidedAt: e.voidedAt || null,
  voidReason: e.voidReason || null,
  note: e.note || null,
  createdAt: e.createdAt,
});

/* ---------------------------------------------------------------- categories */

async function listCategories(req, res) {
  const filter = req.query.includeArchived === 'true' ? {} : { isArchived: false };
  const categories = await ExpenseCategory.find(filter).sort({ sortOrder: 1, nameBn: 1 });
  return ok(res, { categories: categories.map(presentCategory) });
}

async function createCategory(req, res) {
  const category = await ExpenseCategory.create({
    nameBn: req.body.nameBn,
    scope: req.body.scope,
    note: req.body.note,
    sortOrder: req.body.sortOrder || 0,
  });

  await audit.record({
    actor: req.user._id,
    action: 'expenseCategory.create',
    targetType: 'ExpenseCategory',
    targetId: category._id,
    after: { nameBn: category.nameBn, scope: category.scope },
    ip: req.ip,
  });
  return ok(res, { category: presentCategory(category) }, 201);
}

async function updateCategory(req, res) {
  const existing = await ExpenseCategory.findById(req.params.id);
  if (!existing) throw notFound('Expense category not found');

  const category = await ExpenseCategory.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true }
  );

  await audit.record({
    actor: req.user._id,
    action: 'expenseCategory.update',
    targetType: 'ExpenseCategory',
    targetId: category._id,
    before: { nameBn: existing.nameBn, scope: existing.scope, isArchived: existing.isArchived },
    after: { nameBn: category.nameBn, scope: category.scope, isArchived: category.isArchived },
    ip: req.ip,
  });
  return ok(res, { category: presentCategory(category) });
}

/** Archive, never delete: an expense snapshots the category's name. */
async function archiveCategory(req, res) {
  const existing = await ExpenseCategory.findById(req.params.id);
  if (!existing) throw notFound('Expense category not found');

  const category = await ExpenseCategory.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: true } },
    { new: true }
  );
  if (!existing.isArchived) {
    await audit.record({
      actor: req.user._id,
      action: 'expenseCategory.archive',
      targetType: 'ExpenseCategory',
      targetId: category._id,
      before: { isArchived: false },
      after: { isArchived: true },
      ip: req.ip,
    });
  }
  return ok(res, { category: presentCategory(category) });
}

/**
 * Creates the six the owner named, for a fresh install. Idempotent, so a second
 * call adds nothing.
 */
async function seedCategories(req, res) {
  const created = await expenseService.seedCategories();
  const categories = await ExpenseCategory.find({}).sort({ sortOrder: 1, nameBn: 1 });
  return ok(res, { created: created.length, categories: categories.map(presentCategory) });
}

/* ------------------------------------------------------------------ expenses */

async function listExpenses(req, res) {
  const {
    categoryId,
    payeeId,
    orderId,
    scope,
    paymentStatus,
    includeVoided,
    from,
    to,
    page,
    limit,
  } = req.query;

  const filter = {};
  if (categoryId) filter.category = categoryId;
  if (payeeId) filter.payee = payeeId;
  if (orderId) filter.order = orderId;
  if (scope) filter.scope = scope;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  // Voided expenses are hidden by default: they are kept for the audit trail, not
  // for the running total.
  if (includeVoided !== 'true') filter.voidedAt = null;
  if (from || to) {
    filter.businessDate = {};
    if (from) filter.businessDate.$gte = from;
    if (to) filter.businessDate.$lte = to;
  }

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .sort({ businessDate: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Expense.countDocuments(filter),
  ]);

  const rows = expenses.map(present);
  const live = rows.filter((r) => !r.isVoided);

  return ok(res, {
    expenses: rows,
    page,
    limit,
    total,
    totals: {
      all: live.reduce((sum, r) => sum + r.amount, 0),
      /*
       * Split, never summed into one "total cost". An order figure and a period
       * figure answer different questions and the P&L uses them differently.
       */
      order: live
        .filter((r) => r.scope === EXPENSE_SCOPE.ORDER)
        .reduce((sum, r) => sum + r.amount, 0),
      period: live
        .filter((r) => r.scope === EXPENSE_SCOPE.PERIOD)
        .reduce((sum, r) => sum + r.amount, 0),
      unpaid: live
        .filter((r) => r.paymentStatus === 'unpaid')
        .reduce((sum, r) => sum + r.amount, 0),
    },
  });
}

async function getExpense(req, res) {
  const expense = await Expense.findById(req.params.id);
  if (!expense) throw notFound('Expense not found');
  return ok(res, { expense: present(expense) });
}

async function createExpense(req, res) {
  const expense = await expenseService.recordExpense({
    categoryId: req.body.categoryId,
    amountPoisha: toPoisha(req.body.amount),
    orderId: req.body.orderId || null,
    payeeId: req.body.payeeId || null,
    paymentStatus: req.body.paymentStatus,
    paidFrom: req.body.paidFrom,
    date: req.body.date ? startOfBusinessDay(req.body.date) : new Date(),
    note: req.body.note,
    actorUser: req.user,
    ip: req.ip,
  });
  return ok(res, { expense: present(expense) }, 201);
}

/** Voids, never deletes: a printed month's total must not change behind it. */
async function voidExpense(req, res) {
  const expense = await expenseService.voidExpense({
    expenseId: req.params.id,
    reason: req.body.reason,
    actorUser: req.user,
    ip: req.ip,
  });
  return ok(res, { expense: present(expense) });
}

module.exports = {
  present,
  presentCategory,
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  seedCategories,
  listExpenses,
  getExpense,
  createExpense,
  voidExpense,
};
