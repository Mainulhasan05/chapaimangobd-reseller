'use strict';

const AuditLog = require('../../models/AuditLog');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const ResellerProfile = require('../../models/ResellerProfile');
const User = require('../../models/User');
const Payee = require('../../models/Payee');
const Purchase = require('../../models/Purchase');
const Supply = require('../../models/Supply');
const Source = require('../../models/Source');
const DeliveryZone = require('../../models/DeliveryZone');
const Complaint = require('../../models/Complaint');
const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');
const KycSubmission = require('../../models/KycSubmission');
const Expense = require('../../models/Expense');
const ExpenseCategory = require('../../models/ExpenseCategory');
const ResellerProduct = require('../../models/ResellerProduct');
const { ok } = require('../../middleware/error');
const { encodeCursor, afterCursor } = require('../../utils/cursor');
const { startOfBusinessDay, endOfBusinessDay } = require('../../utils/dhakaTime');

/**
 * How to name one target: the model to read and the label to read off it.
 *
 * A raw id on the audit screen is a dead end — "Order 66f1…" tells nobody which
 * parcel. Each entry names its target the way the rest of the app does: an order
 * by its code, a product or a payee by name, a shop by its shop name, and a
 * deposit, a withdrawal or a KYC submission by the shop it belongs to. Records
 * that are one of a kind (the settings, the landing page) have nothing to name.
 */
const shopOf = (doc) => (doc.reseller && doc.reseller.shopName) || null;
const byShop = (model) => ({
  model,
  select: 'reseller',
  populate: [['reseller', 'shopName']],
  label: shopOf,
});
const LABELS = {
  Order: { model: Order, select: 'orderCode', label: (d) => d.orderCode },
  Product: { model: Product, select: 'nameBn', label: (d) => d.nameBn },
  ResellerProfile: { model: ResellerProfile, select: 'shopName', label: (d) => d.shopName },
  User: { model: User, select: 'name', label: (d) => d.name },
  Payee: { model: Payee, select: 'nameBn', label: (d) => d.nameBn },
  Purchase: { model: Purchase, select: 'purchaseCode', label: (d) => d.purchaseCode },
  Supply: { model: Supply, select: 'nameBn', label: (d) => d.nameBn },
  Source: { model: Source, select: 'name', label: (d) => d.name },
  DeliveryZone: { model: DeliveryZone, select: 'name', label: (d) => d.name },
  Complaint: { model: Complaint, select: 'orderCode', label: (d) => d.orderCode },
  Deposit: byShop(Deposit),
  Withdrawal: byShop(Withdrawal),
  KycSubmission: byShop(KycSubmission),
  Expense: {
    model: Expense,
    select: 'categoryNameBn orderCode',
    label: (d) => [d.categoryNameBn, d.orderCode].filter(Boolean).join(' · ') || null,
  },
  ExpenseCategory: { model: ExpenseCategory, select: 'nameBn', label: (d) => d.nameBn },
  ResellerProduct: {
    model: ResellerProduct,
    select: 'reseller product',
    populate: [
      ['reseller', 'shopName'],
      ['product', 'nameBn'],
    ],
    label: (d) =>
      [d.product && d.product.nameBn, shopOf(d)].filter(Boolean).join(' · ') || null,
  },
};

/**
 * A deleted record still has a name in the entry that deleted it: a zone's
 * delete keeps its name in `before`. Used only when the record itself is gone.
 */
const snapshotLabel = (row) => {
  const side = row.before || row.after || {};
  return side.name || side.nameBn || side.shopName || side.orderCode || side.purchaseCode || null;
};

/** Labels for every target on a page, one query per target type. */
async function targetLabels(rows) {
  const idsByType = new Map();
  rows.forEach((row) => {
    if (!row.targetId || !LABELS[row.targetType]) return;
    if (!idsByType.has(row.targetType)) idsByType.set(row.targetType, new Set());
    idsByType.get(row.targetType).add(String(row.targetId));
  });

  const labels = new Map();
  await Promise.all(
    [...idsByType.entries()].map(async ([type, ids]) => {
      const spec = LABELS[type];
      let query = spec.model.find({ _id: { $in: [...ids] } }).select(spec.select);
      (spec.populate || []).forEach(([path, select]) => {
        query = query.populate(path, select);
      });
      const docs = await query.lean();
      docs.forEach((doc) => labels.set(`${type}:${doc._id}`, spec.label(doc) || null));
    })
  );

  return (row) =>
    (row.targetId && labels.get(`${row.targetType}:${row.targetId}`)) || snapshotLabel(row);
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /owner/audit
 *
 * Newest first. `action` matches exactly, or by prefix when it ends in `*`
 * (`order.*`). `from` and `to` are Dhaka calendar days, both inclusive.
 * `actor=system` is what nobody clicked: the entries written with no account
 * behind them.
 */
async function list(req, res) {
  const { actor, targetType, targetId, action, from, to, cursor, limit } = req.query;
  const filter = {};

  // Null matches a missing field too, which is how a system entry is written.
  if (actor) filter.actor = actor === 'system' ? null : actor;
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;
  if (action) {
    filter.action = action.endsWith('*')
      ? { $regex: `^${escapeRegex(action.slice(0, -1))}` }
      : action;
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = startOfBusinessDay(from);
    if (to) filter.createdAt.$lt = endOfBusinessDay(to);
  }

  // The cursor is the last row's (createdAt, _id); see utils/cursor.js.
  if (cursor) Object.assign(filter, afterCursor(cursor, -1));

  const rows = await AuditLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('actor', 'name role');

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1]) : null;
  const labelOf = await targetLabels(page);

  return ok(res, {
    entries: page.map((row) => ({
      id: row._id,
      at: row.createdAt,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId || null,
      // What the target is called, or null when there is nothing to name it by.
      targetLabel: labelOf(row),
      // Null for an entry written by the system, or by an account since removed.
      actor: row.actor ? { id: row.actor._id, name: row.actor.name, role: row.actor.role } : null,
      before: row.before ?? null,
      after: row.after ?? null,
      ip: row.ip || null,
    })),
    nextCursor,
  });
}

module.exports = { list };
