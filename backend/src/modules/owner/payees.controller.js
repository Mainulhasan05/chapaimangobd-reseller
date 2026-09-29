'use strict';

const crypto = require('node:crypto');

const Payee = require('../../models/Payee');
const PayeeLedgerEntry = require('../../models/PayeeLedgerEntry');
const Purchase = require('../../models/Purchase');
const Expense = require('../../models/Expense');

const payeeLedger = require('../../services/payeeLedger');
const purchaseService = require('../../services/purchaseService');
const audit = require('../../services/audit');
const { withTransaction } = require('../../services/tx');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const { normalizeBdPhone } = require('../../utils/phone');
const { PAYEE_LEDGER_KIND } = require('../../domain/constants');

/**
 * Payees: anyone the business owes money to. See docs/adr/0025.
 *
 * `due` is positive when the owner owes them, which is the opposite of a
 * reseller's `balance`. Both are presented under their own name for exactly that
 * reason, and a screen showing both must never add them together.
 */

const present = (p) => ({
  id: p._id,
  nameBn: p.nameBn,
  kind: p.kind,
  phone: p.phoneE164 || null,
  address: p.address || null,
  note: p.note || null,
  // Positive: we owe them.
  due: toTaka(p.duePoisha),
  /*
   * A negative due is an advance (বায়না): the owner paid ahead and the payee owes
   * goods. Flagged rather than left as a minus sign, because "you are owed 500"
   * and "you owe 500" must not look like the same row with different punctuation.
   */
  isAdvance: p.duePoisha < 0,
  advance: p.duePoisha < 0 ? toTaka(-p.duePoisha) : 0,
  isArchived: p.isArchived,
});

const presentEntry = (e) => ({
  id: e._id,
  seq: e.seq,
  kind: e.kind,
  // Signed: positive increased what we owe.
  amount: toTaka(e.amountPoisha),
  dueAfter: toTaka(e.dueAfterPoisha),
  refType: e.refType,
  refId: e.refId || null,
  reversalOf: e.reversalOf || null,
  note: e.note || null,
  createdAt: e.createdAt,
});

async function listPayees(req, res) {
  const filter = req.query.includeArchived === 'true' ? {} : { isArchived: false };
  if (req.query.kind) filter.kind = req.query.kind;
  if (req.query.q) filter.nameBn = { $regex: req.query.q, $options: 'i' };
  if (req.query.owingOnly === 'true') filter.duePoisha = { $gt: 0 };

  const payees = await Payee.find(filter).sort({ duePoisha: -1, nameBn: 1 });
  const rows = payees.map(present);

  return ok(res, {
    payees: rows,
    totals: {
      count: rows.length,
      // What the business owes, in total. Advances are not netted off: money
      // already paid out is a different fact from money still owed.
      due: rows.filter((r) => r.due > 0).reduce((sum, r) => sum + r.due, 0),
      advance: rows.reduce((sum, r) => sum + r.advance, 0),
      owingCount: rows.filter((r) => r.due > 0).length,
    },
  });
}

async function createPayee(req, res) {
  const payee = await Payee.create({
    nameBn: req.body.nameBn,
    kind: req.body.kind,
    phoneE164: req.body.phone ? normalizeBdPhone(req.body.phone) : undefined,
    address: req.body.address,
    note: req.body.note,
  });

  await audit.record({
    actor: req.user._id,
    action: 'payee.create',
    targetType: 'Payee',
    targetId: payee._id,
    after: { nameBn: payee.nameBn, kind: payee.kind },
    ip: req.ip,
  });
  return ok(res, { payee: present(payee) }, 201);
}

async function updatePayee(req, res) {
  const existing = await Payee.findById(req.params.id);
  if (!existing) throw notFound('Payee not found');

  const patch = { ...req.body };
  if (patch.phone !== undefined) {
    patch.phoneE164 = patch.phone ? normalizeBdPhone(patch.phone) : null;
    delete patch.phone;
  }

  const payee = await Payee.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });

  if (patch.isArchived !== undefined && Boolean(existing.isArchived) !== Boolean(payee.isArchived)) {
    await audit.record({
      actor: req.user._id,
      action: `payee.${payee.isArchived ? 'archive' : 'unarchive'}`,
      targetType: 'Payee',
      targetId: payee._id,
      before: { isArchived: Boolean(existing.isArchived) },
      after: { isArchived: Boolean(payee.isArchived) },
      ip: req.ip,
    });
  }
  return ok(res, { payee: present(payee) });
}

/** Archive, never delete: a purchase and a ledger entry both name this row. */
async function archivePayee(req, res) {
  const existing = await Payee.findById(req.params.id);
  if (!existing) throw notFound('Payee not found');

  const payee = await Payee.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: true } },
    { new: true }
  );
  if (!existing.isArchived) {
    await audit.record({
      actor: req.user._id,
      action: 'payee.archive',
      targetType: 'Payee',
      targetId: payee._id,
      before: { isArchived: false },
      after: { isArchived: true },
      ip: req.ip,
    });
  }
  return ok(res, { payee: present(payee) });
}

/** One payee: what they are owed, what they supplied, and what has been billed. */
async function getPayee(req, res) {
  const payee = await Payee.findById(req.params.id);
  if (!payee) throw notFound('Payee not found');

  const [entries, purchases, expenses, health] = await Promise.all([
    PayeeLedgerEntry.find({ payee: payee._id }).sort({ seq: -1 }).limit(20),
    Purchase.find({ payee: payee._id }).sort({ businessDate: -1 }).limit(10),
    Expense.find({ payee: payee._id, voidedAt: null }).sort({ businessDate: -1 }).limit(10),
    payeeLedger.reconcile(payee._id),
  ]);

  return ok(res, {
    payee: present(payee),
    ledger: entries.map(presentEntry),
    purchases: purchases.map((p) => ({
      id: p._id,
      purchaseCode: p.purchaseCode,
      businessDate: p.businessDate,
      status: p.status,
      // What they billed, not what the purchase cost in all.
      payeeTotal: toTaka(p.payeeTotalPoisha),
      total: toTaka(p.totalPoisha),
    })),
    expenses: expenses.map((e) => ({
      id: e._id,
      categoryNameBn: e.categoryNameBn,
      businessDate: e.businessDate,
      amount: toTaka(e.amountPoisha),
      paymentStatus: e.paymentStatus,
    })),
    health: { ok: health.ok, problems: health.problems },
  });
}

async function listLedger(req, res) {
  const payee = await Payee.findById(req.params.id);
  if (!payee) throw notFound('Payee not found');

  const page = Number(req.query.page || 1);
  const limit = Math.min(Number(req.query.limit || 30), 100);

  const [entries, total] = await Promise.all([
    PayeeLedgerEntry.find({ payee: payee._id })
      .sort({ seq: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PayeeLedgerEntry.countDocuments({ payee: payee._id }),
  ]);

  return ok(res, { ledger: entries.map(presentEntry), page, limit, total });
}

/**
 * Pays a payee. Never refused for being more than the due: paying ahead is an
 * advance and a normal thing to do in this trade. See docs/adr/0025.
 */
async function pay(req, res) {
  const entry = await purchaseService.payPayee({
    payeeId: req.params.id,
    amountPoisha: toPoisha(req.body.amount),
    nonce: req.body.nonce,
    paidFrom: req.body.paidFrom,
    note: req.body.note,
    actorUser: req.user,
    ip: req.ip,
  });

  const payee = await Payee.findById(req.params.id);
  return ok(res, { payee: present(payee), entry: presentEntry(entry) }, 201);
}

/**
 * A due carried in from before the system, or a correction.
 *
 * Only `OPENING`, `ADJUSTMENT` and `DISCOUNT` can be typed. A purchase or an
 * expense due is posted by its own service against its own record; typing one
 * here would create a due with nothing behind it.
 */
async function manualEntry(req, res) {
  const payee = await Payee.findById(req.params.id);
  if (!payee) throw notFound('Payee not found');

  const { kind, amount, nonce, note } = req.body;
  // A discount only ever reduces what is owed, whichever way it was typed.
  const signed = kind === PAYEE_LEDGER_KIND.DISCOUNT ? -Math.abs(amount) : amount;

  const entry = await withTransaction((session) =>
    payeeLedger.postEntry(session, {
      payee: payee._id,
      kind,
      amountPoisha: toPoisha(signed),
      idempotencyKey: payeeLedger.keys.manual(nonce),
      refType: 'manual',
      note,
      createdBy: req.user._id,
    })
  );

  await audit.record({
    actor: req.user._id,
    action: 'payee.manualEntry',
    targetType: 'Payee',
    targetId: payee._id,
    before: { duePoisha: payee.duePoisha },
    after: { kind, amountPoisha: toPoisha(signed), dueAfterPoisha: entry.dueAfterPoisha },
    ip: req.ip,
  });

  const fresh = await Payee.findById(payee._id);
  return ok(res, { payee: present(fresh), entry: presentEntry(entry) }, 201);
}

module.exports = {
  present,
  presentEntry,
  listPayees,
  createPayee,
  updatePayee,
  archivePayee,
  getPayee,
  listLedger,
  pay,
  manualEntry,
};
