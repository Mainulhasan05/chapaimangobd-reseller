'use strict';

const Order = require('../../models/Order');
const Complaint = require('../../models/Complaint');
const Source = require('../../models/Source');
const audit = require('../../services/audit');
const { notifyOwners } = require('../../services/notify');
const { ok } = require('../../middleware/error');
const { notFound, badRequest, conflict } = require('../../utils/errors');
const { toTaka } = require('../../utils/money');
const { fromMilli } = require('../../utils/quantity');
const present = require('../../utils/present');
const { escapeRegex, toLatinDigits } = require('../../utils/orderSearch');
const {
  ORDER_STATUS,
  SOURCE_COMPLAINT_KINDS,
  EVENT_TYPE,
} = require('../../domain/constants');

/**
 * Complaints, and the orchard records they add up to.
 *
 * The whole point of writing a complaint down is being able to stop buying from
 * whoever caused it, so nearly everything here is arranged around getting from
 * "this parcel was bad" to "this is what else that orchard sent us".
 */

/* ------------------------------------------------------------------ writing */

/**
 * Log what a customer said was wrong.
 *
 * The lines are named by the caller and everything about them is copied from
 * the order, never from the request and never from the live Source. The request
 * is trusted for which line, not for what that line was: letting a caller pass
 * a source name would put whatever it liked into the record that decides which
 * orchard gets avoided. See models/Complaint.js on snapshots.
 */
async function createComplaint(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) throw notFound('Order not found');

  const { kind, note, itemIds = [] } = req.body;

  /*
   * A pending order has not been confirmed by anybody and has no snapshots
   * worth complaining about yet. Everything from confirm onwards can be
   * complained about, including a cancelled one: "you cancelled my order and
   * nobody rang me" is a complaint, and it is one worth counting.
   */
  if (order.status === ORDER_STATUS.PENDING) {
    throw badRequest('ORDER_NOT_CONFIRMED', 'This order has not been confirmed yet');
  }

  const byId = new Map(order.items.map((item) => [String(item._id), item]));
  const unknown = itemIds.filter((id) => !byId.has(String(id)));
  if (unknown.length > 0) {
    throw badRequest('UNKNOWN_ORDER_ITEM', 'That item is not on this order');
  }

  const items = itemIds.map((id) => {
    const item = byId.get(String(id));
    return {
      itemId: item._id,
      product: item.product,
      productNameBn: item.productNameBn,
      // Null until the order was accepted, because that is when an orchard is
      // chosen. A complaint can still be logged; it just blames nobody.
      source: item.source || null,
      sourceNameBn: item.sourceNameBn || null,
    };
  });

  const complaint = await Complaint.create({
    order: order._id,
    orderCode: order.orderCode,
    reseller: order.reseller,
    customerPhoneE164: order.customer.phoneE164,
    // The day the fruit went out, not the day the phone rang.
    businessDate: order.businessDate,
    kind,
    note,
    items,
    createdBy: req.user._id,
  });

  await audit.record({
    actor: req.user._id,
    action: 'order.complaint',
    targetType: 'Order',
    targetId: order._id,
    after: {
      complaint: complaint._id,
      kind,
      sources: items.map((item) => item.sourceNameBn).filter(Boolean),
    },
    ip: req.ip,
  });

  /*
   * Every other owner account hears about it; whoever typed it does not. No
   * `orderId` in the data, so the link opens the complaints list rather than
   * the order. See services/notify.js notifyOwners.
   */
  await notifyOwners({
    eventType: EVENT_TYPE.COMPLAINT_CREATED,
    data: { complaintId: complaint._id, orderCode: order.orderCode, kind },
    except: req.user._id,
  });

  return ok(res, { complaint: present.complaint(complaint) }, 201);
}

/** Close one out, with what was done about it. Never deleted. */
async function resolveComplaint(req, res) {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw notFound('Complaint not found');

  const before = { resolved: complaint.resolved };

  complaint.resolved = true;
  complaint.resolvedAt = new Date();
  complaint.resolution = req.body.resolution || null;
  complaint.resolvedBy = req.user._id;
  await complaint.save();

  await audit.record({
    actor: req.user._id,
    action: 'complaint.resolve',
    targetType: 'Complaint',
    targetId: complaint._id,
    before,
    after: { resolved: true, resolution: complaint.resolution },
    ip: req.ip,
  });

  return ok(res, { complaint: present.complaint(complaint) });
}

/**
 * Opens a resolved complaint again: the customer rang back, or it was closed by
 * mistake. The earlier resolution is cleared from the complaint and kept in the
 * audit log, which is where "what did we say last time" is answered.
 */
async function reopenComplaint(req, res) {
  const complaint = await Complaint.findOneAndUpdate(
    { _id: req.params.id, resolved: true },
    { $set: { resolved: false, resolvedAt: null, resolution: null, resolvedBy: null } },
    { new: false }
  );
  if (!complaint) {
    if (!(await Complaint.exists({ _id: req.params.id }))) throw notFound('Complaint not found');
    throw conflict('COMPLAINT_OPEN', 'This complaint is already open');
  }

  await audit.record({
    actor: req.user._id,
    action: 'complaint.reopen',
    targetType: 'Complaint',
    targetId: complaint._id,
    before: {
      resolved: true,
      resolvedAt: complaint.resolvedAt,
      resolution: complaint.resolution || null,
    },
    after: { resolved: false },
    ip: req.ip,
  });

  const fresh = await Complaint.findById(complaint._id).populate('reseller', 'shopName');
  return ok(res, { complaint: present.complaint(fresh) });
}

/* ------------------------------------------------------------------ reading */

/**
 * The search box on the complaints list: an order code, the customer's phone or
 * their name, whichever the owner has in front of them. Code and phone are
 * snapshots on the complaint; the name is not, so it is found through the orders
 * it names. Bengali digits are read as Latin ones, as on the order list.
 */
async function complaintSearch(q) {
  const term = toLatinDigits(q || '').trim();
  if (!term) return null;
  const escaped = escapeRegex(term);

  const or = [{ orderCode: new RegExp(`^${escaped}`, 'i') }];
  const digits = term.replace(/[^0-9]/g, '');
  if (digits.length >= 4) or.push({ customerPhoneE164: new RegExp(`${digits}$`) });

  const named = await Order.find({ 'customer.name': new RegExp(escaped, 'i') })
    .select('_id')
    .limit(500)
    .lean();
  if (named.length > 0) or.push({ order: { $in: named.map((o) => o._id) } });

  return { $or: or };
}

/** The customer's name on each complaint's order, which the complaint does not copy. */
async function customerNames(complaints) {
  const orders = await Order.find({ _id: { $in: complaints.map((c) => c.order) } })
    .select('customer.name')
    .lean();
  return new Map(orders.map((o) => [String(o._id), o.customer.name]));
}

/** The owner's working list. Open ones first unless asked otherwise. */
async function listComplaints(req, res) {
  const { kind, source, resolved, from, to, q, page, limit } = req.query;

  const filter = {};
  if (kind) filter.kind = { $in: kind.split(',') };
  if (source) filter['items.source'] = source;
  if (resolved !== undefined) filter.resolved = resolved;
  if (from || to) {
    filter.businessDate = {};
    if (from) filter.businessDate.$gte = from;
    if (to) filter.businessDate.$lte = to;
  }
  const search = await complaintSearch(q);
  if (search) Object.assign(filter, search);

  const [complaints, total, open] = await Promise.all([
    Complaint.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('reseller', 'shopName'),
    Complaint.countDocuments(filter),
    Complaint.countDocuments({ ...filter, resolved: false }),
  ]);

  const names = await customerNames(complaints);
  return ok(res, {
    complaints: complaints.map((c) => ({
      ...present.complaint(c),
      customerName: names.get(String(c.order)) || null,
    })),
    total,
    open,
    page,
    limit,
  });
}

/** Every complaint about one order, for its detail screen. */
async function orderComplaints(req, res) {
  const complaints = await Complaint.find({ order: req.params.id }).sort({ createdAt: -1 });
  return ok(res, { complaints: complaints.map(present.complaint) });
}

/* ------------------------------------------------------------- source record */

/**
 * What one orchard has actually sent, and how often it went wrong.
 *
 * Three separate questions, because they cannot be asked of one collection:
 * what was supplied comes from the order lines, what went wrong comes from the
 * complaints, and a return is an order-level outcome rather than a line-level
 * one. `orders` counts distinct orders and not lines, so an order carrying two
 * crates from the same orchard is one order, which is what a rate has to divide
 * by for the rate to mean anything.
 */
async function sourceRecord(sourceId, { from, to } = {}) {
  const dates = {};
  if (from) dates.$gte = from;
  if (to) dates.$lte = to;
  const withDates = (base) => (from || to ? { ...base, businessDate: dates } : base);

  const [supplied, returned, complaints] = await Promise.all([
    Order.aggregate([
      { $match: withDates({ 'items.source': sourceId }) },
      { $unwind: '$items' },
      { $match: { 'items.source': sourceId } },
      {
        $group: {
          _id: null,
          orders: { $addToSet: '$_id' },
          qtyMilli: { $sum: '$items.qtyMilli' },
          costPoisha: { $sum: '$items.lineCostPoisha' },
        },
      },
    ]),
    Order.countDocuments(
      withDates({ 'items.source': sourceId, status: ORDER_STATUS.RETURNED })
    ),
    Complaint.aggregate([
      { $match: withDates({ 'items.source': sourceId }) },
      { $group: { _id: '$kind', count: { $sum: 1 }, open: { $sum: { $cond: ['$resolved', 0, 1] } } } },
    ]),
  ]);

  const stat = supplied[0] || {};
  const orders = stat.orders ? stat.orders.length : 0;
  const byKind = Object.fromEntries(complaints.map((row) => [row._id, row.count]));

  /*
   * Only the kinds that are about the fruit count against an orchard. A late
   * delivery is the courier's doing, and letting it move this rate would have
   * the owner dropping a perfectly good orchard over a traffic jam.
   */
  const blamed = SOURCE_COMPLAINT_KINDS.reduce((sum, k) => sum + (byKind[k] || 0), 0);
  const total = complaints.reduce((sum, row) => sum + row.count, 0);

  return {
    orders,
    quantity: fromMilli(stat.qtyMilli || 0),
    cost: toTaka(stat.costPoisha || 0),
    returned,
    complaints: total,
    // Complaints about the fruit itself, which is what the rate is built from.
    fruitComplaints: blamed,
    openComplaints: complaints.reduce((sum, row) => sum + row.open, 0),
    byKind,
    /*
     * A percentage, and null rather than zero when nothing has been supplied.
     * Zero would read as a clean record, and an orchard nobody has bought from
     * has no record at all — which is a different thing to tell the owner.
     */
    complaintRate: orders > 0 ? Math.round((blamed / orders) * 1000) / 10 : null,
    returnRate: orders > 0 ? Math.round((returned / orders) * 1000) / 10 : null,
  };
}

/**
 * One orchard: who they are, what they have sent, and everything said about it.
 *
 * The screen a complaint leads to. Its job is to answer "should we keep buying
 * from here", so the record and the actual complaints are on the same response:
 * a rate with no complaints under it is a number nobody can check.
 */
async function getSource(req, res) {
  const source = await Source.findById(req.params.id);
  if (!source) throw notFound('Source not found');

  const { from, to } = req.query;

  const [record, complaints, orders] = await Promise.all([
    sourceRecord(source._id, { from, to }),
    Complaint.find({ 'items.source': source._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('reseller', 'shopName'),
    Order.find({ 'items.source': source._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('reseller', 'shopName'),
  ]);

  return ok(res, {
    source,
    record,
    complaints: complaints.map(present.complaint),
    /*
     * Each order whole, plus the lines that came from this orchard. Picked by
     * the source id and never by the snapshot name: the name on a line is what
     * the orchard was called at accept, and matching on it lost every line the
     * moment the orchard was renamed. One order can carry two orchards' fruit
     * (docs/adr/0006), which is why `items` alone is not the answer.
     */
    orders: orders.map((order) => ({
      ...present.order(order),
      sourceItems: (order.items || [])
        .filter((item) => item.source && String(item.source) === String(source._id))
        .map(present.line),
    })),
  });
}

/**
 * Every orchard side by side, worst record first.
 *
 * The one screen that answers the question this whole feature exists for. Sorted
 * by complaint rate rather than by count: an orchard that sent two bad crates
 * out of three is a worse bet than one that sent five out of four hundred, and
 * sorting by count puts them the wrong way round.
 */
async function sourcesReport(req, res) {
  const from = req.query.from;
  const to = req.query.to;

  // Archived ones included: they are archived precisely because something went
  // wrong, and leaving them out would hide the evidence for that decision.
  const sources = await Source.find({}).sort({ name: 1 });

  const rows = await Promise.all(
    sources.map(async (source) => ({
      id: source._id,
      name: source.name,
      phone: source.phoneE164 || null,
      address: source.address || null,
      isArchived: source.isArchived,
      ...(await sourceRecord(source._id, { from, to })),
    }))
  );

  const traded = rows.filter((row) => row.orders > 0);

  return ok(res, {
    from: from || null,
    to: to || null,
    sources: rows.sort(
      (a, b) =>
        (b.complaintRate ?? -1) - (a.complaintRate ?? -1) ||
        b.complaints - a.complaints ||
        String(a.name).localeCompare(String(b.name))
    ),
    totals: {
      sources: rows.length,
      supplying: traded.length,
      orders: traded.reduce((sum, row) => sum + row.orders, 0),
      complaints: rows.reduce((sum, row) => sum + row.complaints, 0),
      openComplaints: rows.reduce((sum, row) => sum + row.openComplaints, 0),
      returned: traded.reduce((sum, row) => sum + row.returned, 0),
    },
  });
}

module.exports = {
  createComplaint,
  resolveComplaint,
  reopenComplaint,
  listComplaints,
  orderComplaints,
  getSource,
  sourcesReport,
  // Exported for the dashboard, which wants the open count and nothing else.
  openComplaintCount: () => Complaint.countDocuments({ resolved: false }),
};
