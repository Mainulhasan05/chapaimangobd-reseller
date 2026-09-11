'use strict';

const Customer = require('../../models/Customer');
const Order = require('../../models/Order');
const present = require('../../utils/present');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');
const { escapeRegex } = require('../../utils/orderSearch');
const { toTaka } = require('../../utils/money');

/**
 * The owner's view of who is actually buying.
 *
 * A customer is a phone number with a history attached. The names are part of
 * that history rather than the key to it: the same number orders for itself one
 * week and for a relative the next, and both are the same buyer placing their
 * second and third order. See models/Customer.js for why it is built this way.
 */

/** Most used first, and only what a screen will render. */
const variants = (list, limit = 6) =>
  (list || [])
    .slice()
    .sort((a, b) => b.count - a.count || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .slice(0, limit)
    .map((v) => ({ value: v.value, count: v.count, lastUsedAt: v.lastUsedAt }));

const shape = (c) => ({
  id: c._id,
  phone: c.phoneE164,
  // The name to show is the one used most, not the one used first.
  name: variants(c.names, 1)[0]?.value || null,
  names: variants(c.names),
  addresses: variants(c.addresses),
  altPhones: c.altPhones || [],
  orderCount: c.orderCount,
  deliveredCount: c.deliveredCount,
  cancelledCount: c.cancelledCount,
  returnedCount: c.returnedCount,
  totalSpend: toTaka(c.totalSpendPoisha),
  firstOrderAt: c.firstOrderAt,
  lastOrderAt: c.lastOrderAt,
  shopCount: (c.resellers || []).length,
});

/**
 * The list, newest buyer first.
 *
 * Searched by number or by any name the number has ever ordered under, because
 * the owner looking someone up has one of those two things and no idea which
 * name is on the record.
 */
async function listCustomers(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const term = (req.query.q || '').trim();

  const filter = {};
  if (term) {
    const escaped = escapeRegex(term);
    const or = [{ 'names.value': new RegExp(escaped, 'i') }];

    // Stored E.164, typed however people type it. Matching the tail lets
    // 01712345678 and 1712345678 both find +8801712345678.
    const digits = term.replace(/\D/g, '');
    if (digits.length >= 4) {
      or.push({ phoneE164: new RegExp(`${escapeRegex(digits)}$`) });
      or.push({ altPhones: new RegExp(`${escapeRegex(digits)}$`) });
    }
    filter.$or = or;
  }

  const [items, total] = await Promise.all([
    Customer.find(filter)
      .sort({ lastOrderAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Customer.countDocuments(filter),
  ]);

  return ok(res, { customers: items.map(shape), total, page, limit });
}

/**
 * One buyer and everything they have done.
 *
 * The orders come back whole rather than as a count, because the question the
 * owner is answering is usually "what happened the last three times", and that
 * needs the name used and the address it went to on each one.
 */
async function getCustomer(req, res) {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw notFound('Customer not found');

  const orders = await Order.find({ 'customer.phoneE164': customer.phoneE164 })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('reseller', 'shopName slug');

  return ok(res, {
    customer: shape(customer),
    orders: orders.map((order) => ({
      ...present.order(order),
      // Which shop took it. The owner sees every shop; a reseller never does.
      shopName: order.reseller?.shopName || null,
    })),
  });
}

module.exports = { listCustomers, getCustomer };
