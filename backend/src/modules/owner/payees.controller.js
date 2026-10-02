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
const { escapeRegex } = require('../../utils/orderSearch');
const { businessDate, startOfBusinessDay } = require('../../utils/dhakaTime');
const { purchaseFilter, expenseFilter } = require('../../utils/costFilter');
const { PAYEE_LEDGER_KIND, PURCHASE_STATUS } = require('../../domain/constants');

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

/**
 * One ledger row.
 *
 * `context` carries what the row needs from outside itself, batch-loaded by
 * `entryContext` so a page of thirty rows is three queries and not ninety:
 * whether it has been reversed, and the human name of what it points at.
 * Without one, the row is presented bare.
 */
const presentEntry = (e, context = null) => ({
  id: e._id,
  seq: e.seq,
  kind: e.kind,
  // Signed: positive increased what we owe.
  amount: toTaka(e.amountPoisha),
  dueAfter: toTaka(e.dueAfterPoisha),
  /*
   * The day the movement belongs to: the day the goods came in or the money was
   * handed over, which is not always the day it was typed. Entries from before
   * the field existed fall back to the Dhaka date they were written.
   */
  businessDate: e.businessDate || businessDate(e.createdAt),
  refType: e.refType,
  refId: e.refId || null,
  reference: context ? context.references.get(String(e.refId)) || null : null,
  reversalOf: e.reversalOf || null,
  // The reversal that took this entry back, if one has.
  reversedBy: context ? context.reversedBy.get(String(e._id)) || null : null,
  // Whether the owner may take it back now: the right kind, and not yet reversed.
  reversible:
    purchaseService.isReversible(e) && !(context && context.reversedBy.has(String(e._id))),
  note: e.note || null,
  createdAt: e.createdAt,
});

/**
 * What a page of ledger rows needs from elsewhere: which of them have been
 * reversed, and a name for each thing they point at — the purchase code the
 * seller can quote back, or the expense category a bill was filed under.
 */
async function entryContext(entries) {
  const ids = entries.map((e) => e._id);
  const refIds = (type) =>
    entries.filter((e) => e.refType === type && e.refId).map((e) => e.refId);
  // A settlement points at the expense it paid; see expenseService.markPaid.
  const expenseIds = [...refIds('expense'), ...refIds('payment')];

  const [reversals, purchases, expenses] = await Promise.all([
    PayeeLedgerEntry.find({ reversalOf: { $in: ids } }, { reversalOf: 1 }).lean(),
    Purchase.find({ _id: { $in: refIds('purchase') } }, { purchaseCode: 1, status: 1 }).lean(),
    Expense.find({ _id: { $in: expenseIds } }, { categoryNameBn: 1 }).lean(),
  ]);

  const references = new Map();
  purchases.forEach((p) =>
    references.set(String(p._id), {
      type: 'purchase',
      id: p._id,
      label: p.purchaseCode,
      cancelled: p.status === PURCHASE_STATUS.CANCELLED,
    })
  );
  expenses.forEach((x) =>
    references.set(String(x._id), {
      type: 'expense',
      id: x._id,
      label: x.categoryNameBn,
      cancelled: false,
    })
  );

  return {
    references,
    reversedBy: new Map(reversals.map((r) => [String(r.reversalOf), r._id])),
  };
}

const presentEntries = async (entries) => {
  const context = await entryContext(entries);
  return entries.map((e) => presentEntry(e, context));
};

/**
 * Payees, owing most first.
 *
 * The totals are over every payee the kind, search and owing filters match,
 * **archived ones included**, whether or not they are listed. Archiving a seller
 * takes them off the everyday list; it does not settle what the business owes
 * them, and a total that quietly dropped their due would read as money nobody
 * is owed. The archived share is broken out so the screen can say how much of
 * the total sits behind the archived toggle. `count` is the rows returned.
 */
async function listPayees(req, res) {
  const matching = {};
  if (req.query.kind) matching.kind = req.query.kind;
  if (req.query.q) matching.nameBn = { $regex: escapeRegex(req.query.q), $options: 'i' };
  if (req.query.owingOnly === 'true') matching.duePoisha = { $gt: 0 };

  const filter =
    req.query.includeArchived === 'true' ? matching : { ...matching, isArchived: false };

  const [payees, groups] = await Promise.all([
    Payee.find(filter).sort({ duePoisha: -1, nameBn: 1 }),
    Payee.aggregate([
      { $match: matching },
      {
        $group: {
          _id: { $eq: ['$isArchived', true] },
          duePoisha: { $sum: { $cond: [{ $gt: ['$duePoisha', 0] }, '$duePoisha', 0] } },
          advancePoisha: { $sum: { $cond: [{ $lt: ['$duePoisha', 0] }, '$duePoisha', 0] } },
          owingCount: { $sum: { $cond: [{ $gt: ['$duePoisha', 0] }, 1, 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const group = (archived) => groups.find((g) => g._id === archived) || {};
  const live = group(false);
  const archived = group(true);
  const sum = (key) => (live[key] || 0) + (archived[key] || 0);

  return ok(res, {
    payees: payees.map(present),
    totals: {
      count: payees.length,
      // What the business owes, in total. Advances are not netted off: money
      // already paid out and money still owed are different facts.
      due: toTaka(sum('duePoisha')),
      advance: toTaka(-sum('advancePoisha')),
      owingCount: sum('owingCount'),
      // The part of the above that belongs to archived payees.
      archivedDue: toTaka(archived.duePoisha || 0),
      archivedAdvance: toTaka(-(archived.advancePoisha || 0)),
      archivedOwingCount: archived.owingCount || 0,
      archivedCount: archived.count || 0,
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

  const [entries, purchases, expenses, purchaseCount, expenseCount, health] = await Promise.all([
    PayeeLedgerEntry.find({ payee: payee._id }).sort({ seq: -1 }).limit(20),
    Purchase.find({ payee: payee._id }).sort({ businessDate: -1 }).limit(10),
    Expense.find({ payee: payee._id, voidedAt: null }).sort({ businessDate: -1 }).limit(10),
    /*
     * How many there are in all, beside the ten shown, counted with the filter
     * `/purchases?payeeId=` and `/expenses?payeeId=` list with, so a "see all"
     * link lands on exactly this many rows.
     */
    Purchase.countDocuments(purchaseFilter({ payeeId: payee._id })),
    Expense.countDocuments(expenseFilter({ payeeId: payee._id })),
    payeeLedger.reconcile(payee._id),
  ]);

  return ok(res, {
    payee: present(payee),
    purchaseCount,
    expenseCount,
    ledger: await presentEntries(entries),
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

  return ok(res, { ledger: await presentEntries(entries), page, limit, total });
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
    date: req.body.date ? startOfBusinessDay(req.body.date) : new Date(),
    actorUser: req.user,
    ip: req.ip,
  });

  const payee = await Payee.findById(req.params.id);
  return ok(res, { payee: present(payee), entry: presentEntry(entry) }, 201);
}

/**
 * Takes back a wrong payment or a wrong hand-typed entry: a new entry of the
 * opposite sign, with the reason, and the original left exactly as it was. A
 * purchase or an expense is undone through its own record instead; see
 * purchaseService.reversePayeeEntry.
 */
async function reverseEntry(req, res) {
  const { entry, original, expense } = await purchaseService.reversePayeeEntry({
    payeeId: req.params.id,
    entryId: req.params.entryId,
    reason: req.body.reason,
    actorUser: req.user,
    ip: req.ip,
  });

  const payee = await Payee.findById(req.params.id);
  const [reversal, reversed] = await presentEntries([entry, original]);
  return ok(
    res,
    {
      payee: present(payee),
      entry: reversal,
      reversed,
      // The expense this payment had settled, now back to unpaid; else null.
      reopenedExpenseId: expense ? expense._id : null,
    },
    201
  );
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
  reverseEntry,
  manualEntry,
};
