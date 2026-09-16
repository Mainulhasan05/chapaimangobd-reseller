'use strict';

const Order = require('../../models/Order');
const LedgerEntry = require('../../models/LedgerEntry');
const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');
const KycSubmission = require('../../models/KycSubmission');
const Product = require('../../models/Product');
const OutboxMessage = require('../../models/OutboxMessage');
const ResellerProfile = require('../../models/ResellerProfile');
const Customer = require('../../models/Customer');
const User = require('../../models/User');

const { getSettings } = require('../../services/settings');
const ledger = require('../../services/ledger');
const { ok } = require('../../middleware/error');
const { toTaka } = require('../../utils/money');
const { fromMilli } = require('../../utils/quantity');
const {
  businessDate,
  startOfBusinessDay,
  endOfBusinessDay,
  agingCutoff,
  formatDhakaDateTime,
} = require('../../utils/dhakaTime');
const present = require('../../utils/present');
const { streamCsv, trustedFormula } = require('../../utils/csv');
const { buildOrderFilter } = require('../../utils/orderFilter');
const { ORDER_STATUS, REVIEW_STATUS, PAYMENT_MODE, ROLES } = require('../../domain/constants');
const { OUTBOX_STATUS } = require('../../models/OutboxMessage');

/** Statuses an order passes through while it is still the owner's problem. */
const OPEN_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PACKED,
  ORDER_STATUS.SHIPPED,
];

/** Statuses that count as trade: billed, not cancelled, not returned. */
const TRADED = { $nin: [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] };

/**
 * The money an order is worth to each party.
 *
 * The owner's revenue is the wallet debit — goods at cost price plus the
 * delivery charge — and not the customer total, which includes the reseller's
 * margin and is therefore not the owner's money. Getting this backwards would
 * overstate every figure on the dashboard by the resellers' earnings.
 */
const MONEY_SUMS = {
  orders: { $sum: 1 },
  ownerRevenuePoisha: { $sum: '$totals.walletDebitPoisha' },
  goodsPoisha: { $sum: '$totals.costSubtotalPoisha' },
  deliveryPoisha: { $sum: '$deliveryChargePoisha' },
  customerPoisha: { $sum: '$totals.customerTotalPoisha' },
  resellerMarginPoisha: { $sum: '$totals.resellerMarginPoisha' },
};

const presentMoney = (row = {}) => ({
  orders: row.orders || 0,
  ownerRevenue: toTaka(row.ownerRevenuePoisha || 0),
  goods: toTaka(row.goodsPoisha || 0),
  delivery: toTaka(row.deliveryPoisha || 0),
  customerTotal: toTaka(row.customerPoisha || 0),
  resellerMargin: toTaka(row.resellerMarginPoisha || 0),
});

/**
 * The owner's morning, in one response.
 *
 * It answers four questions in the order they are actually asked: what traded
 * today, what is in flight and where is my cash, who is waiting on a decision
 * from me, and is anything quietly broken. It used to answer only the second.
 *
 * `byStatus` is deliberately restricted to the open statuses. It was an
 * unfiltered group over the whole collection, which meant the pipeline bar and
 * the order tabs counted every order ever delivered: a number that grows for
 * ever and stops meaning anything by the end of a season. What closed today is
 * a different question and gets its own field.
 */
async function dashboard(_req, res) {
  const settings = await getSettings();
  const today = businessDate();

  const [
    statusCounts,
    todayMoney,
    closedToday,
    codInFlight,
    aging,
    owed,
    pendingDeposits,
    pendingWithdrawals,
    pendingKyc,
    lowStock,
    deadLetters,
    activeResellers,
  ] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { businessDate: today, status: TRADED } },
      { $group: { _id: null, ...MONEY_SUMS } },
    ]),
    Order.aggregate([
      {
        $match: {
          businessDate: today,
          status: {
            $in: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED],
          },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    /*
     * Cash the couriers are carrying: shipped, paid on delivery, not yet
     * delivered. The credit only posts when the order is marked delivered, so
     * until then this is the owner's money out in the world and it appears on
     * no balance sheet in the app. The single largest exposure the business
     * runs, and nothing showed it.
     */
    Order.aggregate([
      { $match: { status: ORDER_STATUS.SHIPPED, paymentMode: PAYMENT_MODE.COD } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          amountPoisha: { $sum: '$totals.customerTotalPoisha' },
        },
      },
    ]),
    Order.countDocuments({
      status: ORDER_STATUS.CONFIRMED,
      confirmedAt: { $lt: agingCutoff(settings.orderAgingHours) },
    }),
    // From the ledger, not the cached balance. See docs/adr/0002.
    ledger.totalReceivablePoisha(),
    Deposit.countDocuments({ status: REVIEW_STATUS.PENDING }),
    Withdrawal.countDocuments({ status: REVIEW_STATUS.PENDING }),
    // A reseller stuck here cannot trade at all, and nothing counted them.
    KycSubmission.countDocuments({ status: REVIEW_STATUS.PENDING }),
    Product.countDocuments({ isArchived: false, trackStock: true, stockQtyMilli: { $lte: 0 } }),
    // Notifications that gave up. A dead gateway is otherwise silent.
    OutboxMessage.countDocuments({ status: OUTBOX_STATUS.DEAD }),
    // `isActive` is a User field, not a profile one: a deactivated reseller is
    // switched off at the account. See docs/adr/0011.
    User.countDocuments({ role: ROLES.RESELLER, isActive: true }),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
  const closed = Object.fromEntries(closedToday.map((s) => [s._id, s.count]));
  const cod = codInFlight[0] || {};
  const money = presentMoney(todayMoney[0]);

  return ok(res, {
    today,
    // Every order raised today, cancellations included, which is the count the
    // word "today" means on a tile. The money below counts only what traded.
    ordersToday: money.orders + (closed[ORDER_STATUS.CANCELLED] || 0),
    money,
    byStatus,
    closedToday: {
      delivered: closed[ORDER_STATUS.DELIVERED] || 0,
      cancelled: closed[ORDER_STATUS.CANCELLED] || 0,
      returned: closed[ORDER_STATUS.RETURNED] || 0,
    },
    codInFlight: { orders: cod.orders || 0, amount: toTaka(cod.amountPoisha || 0) },
    awaitingAcceptance: byStatus[ORDER_STATUS.CONFIRMED] || 0,
    agingOrders: aging,
    agingThresholdHours: settings.orderAgingHours,
    totalReceivable: toTaka(owed),
    pendingDeposits,
    pendingWithdrawals,
    pendingKyc,
    activeResellers,
    health: {
      lowStock,
      deadLetters,
      // The master switch, which governs reseller-paid SMS. See docs/adr/0013.
      smsEnabled: Boolean(settings.features && settings.features.sms),
    },
  });
}

/** Quantity sold per product over a Dhaka date range. */
async function productsSold(req, res) {
  const from = req.query.from || businessDate();
  const to = req.query.to || businessDate();

  const rows = await Order.aggregate([
    { $match: { status: TRADED, businessDate: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: { product: '$items.product', name: '$items.productNameBn', unit: '$items.unit' },
        qtyMilli: { $sum: '$items.qtyMilli' },
        revenuePoisha: { $sum: '$items.lineSellPoisha' },
        costPoisha: { $sum: '$items.lineCostPoisha' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { qtyMilli: -1 } },
  ]);

  return ok(res, {
    from,
    to,
    products: rows.map((r) => ({
      product: r._id.product,
      name: r._id.name,
      unit: r._id.unit,
      quantity: fromMilli(r.qtyMilli),
      revenue: toTaka(r.revenuePoisha),
      cost: toTaka(r.costPoisha),
      orders: r.orders,
    })),
  });
}

/** Orders per Dhaka calendar day. The timezone is explicit, never the server one. */
async function ordersByDay(req, res) {
  const from = req.query.from || businessDate();
  const to = req.query.to || businessDate();

  /*
   * Grouped on the denormalised `businessDate` rather than by formatting
   * `createdAt` in Dhaka. Identical by construction, because that is how the
   * field is written, but this one is an index scan and needs no timezone
   * argument to get right.
   */
  const rows = await Order.aggregate([
    { $match: { businessDate: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$businessDate',
        orders: { $sum: 1 },
        customerTotalPoisha: { $sum: '$totals.customerTotalPoisha' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return ok(res, {
    days: rows.map((r) => ({
      date: r._id,
      orders: r.orders,
      customerTotal: toTaka(r.customerTotalPoisha),
    })),
  });
}

/**
 * The date range a report was asked for, defaulting to today.
 *
 * Reports are printed and filed, so the range they cover is echoed back in the
 * response and printed in the header: a sheet that does not say which days it
 * covers is not evidence of anything.
 */
const rangeOf = (query = {}) => {
  const from = query.from || businessDate();
  const to = query.to || query.from || businessDate();
  return { from, to };
};

/**
 * The sales report: what the business traded over a range, four ways.
 *
 * One request rather than four, because they are read together and because the
 * totals must agree. Assembling a printed report out of separate calls is how a
 * header ends up disagreeing with the table beneath it.
 */
async function sales(req, res) {
  const { from, to } = rangeOf(req.query);
  const window = { businessDate: { $gte: from, $lte: to }, status: TRADED };

  const [totals, byDay, byProduct, byPaymentMode, lost] = await Promise.all([
    Order.aggregate([{ $match: window }, { $group: { _id: null, ...MONEY_SUMS } }]),
    Order.aggregate([
      { $match: window },
      { $group: { _id: '$businessDate', ...MONEY_SUMS } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: window },
      { $unwind: '$items' },
      {
        $group: {
          _id: { product: '$items.product', name: '$items.productNameBn', unit: '$items.unit' },
          qtyMilli: { $sum: '$items.qtyMilli' },
          goodsPoisha: { $sum: '$items.lineCostPoisha' },
          customerPoisha: { $sum: '$items.lineSellPoisha' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { goodsPoisha: -1 } },
    ]),
    Order.aggregate([{ $match: window }, { $group: { _id: '$paymentMode', ...MONEY_SUMS } }]),
    /*
     * What did not trade. A sales report that omits the cancellations and the
     * returns flatters the period it covers, and the owner is the one person
     * who cannot afford to read a flattering version.
     */
    Order.aggregate([
      {
        $match: {
          businessDate: { $gte: from, $lte: to },
          status: { $in: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] },
        },
      },
      {
        $group: {
          _id: '$status',
          orders: { $sum: 1 },
          customerPoisha: { $sum: '$totals.customerTotalPoisha' },
        },
      },
    ]),
  ]);

  const lostBy = Object.fromEntries(lost.map((r) => [r._id, r]));
  const lostOf = (status) => ({
    orders: (lostBy[status] || {}).orders || 0,
    customerTotal: toTaka((lostBy[status] || {}).customerPoisha || 0),
  });

  return ok(res, {
    from,
    to,
    totals: presentMoney(totals[0]),
    days: byDay.map((r) => ({ date: r._id, ...presentMoney(r) })),
    products: byProduct.map((r) => ({
      product: r._id.product,
      name: r._id.name,
      unit: r._id.unit,
      quantity: fromMilli(r.qtyMilli),
      goods: toTaka(r.goodsPoisha),
      customerTotal: toTaka(r.customerPoisha),
      orders: r.orders,
    })),
    paymentModes: byPaymentMode.map((r) => ({ mode: r._id, ...presentMoney(r) })),
    cancelled: lostOf(ORDER_STATUS.CANCELLED),
    returned: lostOf(ORDER_STATUS.RETURNED),
  });
}

/**
 * The reseller report: who sold what over a range, against where they stand now.
 *
 * Trade is a property of the range; the balance and the credit limit are a
 * property of today. Both belong on one sheet, because the question the owner
 * asks about a reseller is always some version of "are they worth the credit I
 * am extending them", and that cannot be answered from either half alone.
 */
async function resellerPerformance(req, res) {
  const { from, to } = rangeOf(req.query);

  const [traded, cancelled, balances, profiles] = await Promise.all([
    Order.aggregate([
      { $match: { businessDate: { $gte: from, $lte: to }, status: TRADED } },
      { $group: { _id: '$reseller', ...MONEY_SUMS } },
    ]),
    Order.aggregate([
      {
        $match: {
          businessDate: { $gte: from, $lte: to },
          status: { $in: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] },
        },
      },
      { $group: { _id: '$reseller', count: { $sum: 1 } } },
    ]),
    ledger.ledgerBalances(),
    ResellerProfile.find({}, 'shopName slug creditLimitPoisha').populate(
      'user',
      'name phoneE164 isActive'
    ),
  ]);

  const tradedBy = new Map(traded.map((r) => [String(r._id), r]));
  const cancelledBy = new Map(cancelled.map((r) => [String(r._id), r.count]));
  const balanceBy = new Map(balances.map((r) => [String(r.reseller), r.balancePoisha]));

  const rows = profiles
    .map((p) => {
      const id = String(p._id);
      const balancePoisha = balanceBy.get(id) || 0;
      return {
        id: p._id,
        shopName: p.shopName,
        slug: p.slug,
        user: p.user,
        isActive: Boolean(p.user && p.user.isActive),
        ...presentMoney(tradedBy.get(id)),
        cancelled: cancelledBy.get(id) || 0,
        // Signed: negative owes the owner. The same convention as receivables.
        balance: toTaka(balancePoisha),
        owed: toTaka(Math.max(0, -balancePoisha)),
        creditLimit: toTaka(p.creditLimitPoisha || 0),
      };
    })
    // Biggest seller first. A reseller with nothing in the range still appears,
    // because "sold nothing this month" is itself the finding.
    .sort(
      (a, b) =>
        b.ownerRevenue - a.ownerRevenue || String(a.shopName).localeCompare(String(b.shopName))
    );

  const sum = (key) => traded.reduce((total, r) => total + (r[key] || 0), 0);

  return ok(res, {
    from,
    to,
    totals: presentMoney({
      orders: sum('orders'),
      ownerRevenuePoisha: sum('ownerRevenuePoisha'),
      goodsPoisha: sum('goodsPoisha'),
      deliveryPoisha: sum('deliveryPoisha'),
      customerPoisha: sum('customerPoisha'),
      resellerMarginPoisha: sum('resellerMarginPoisha'),
    }),
    resellers: rows,
  });
}

/**
 * What has to be collected, and from where.
 *
 * The owner's first job of the day is not a screen of orders, it is a quantity
 * per product and an orchard to fetch it from. Confirmed orders have no source
 * yet, because one is chosen at accept (docs/adr/0006), so they are reported
 * under a null source rather than folded into an orchard's total and quietly
 * overstating what that orchard owes.
 */
async function pickList(req, res) {
  const { from, to } = rangeOf(req.query);

  const rows = await Order.aggregate([
    {
      $match: {
        businessDate: { $gte: from, $lte: to },
        status: { $in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PACKED] },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          product: '$items.product',
          name: '$items.productNameBn',
          unit: '$items.unit',
          sourceName: '$items.sourceNameBn',
        },
        qtyMilli: { $sum: '$items.qtyMilli' },
        // Distinct orders, because one order may carry the same product twice.
        orders: { $addToSet: '$_id' },
      },
    },
  ]);

  const products = new Map();
  rows.forEach((row) => {
    const key = String(row._id.product);
    if (!products.has(key)) {
      products.set(key, {
        product: row._id.product,
        name: row._id.name,
        unit: row._id.unit,
        qtyMilli: 0,
        orders: 0,
        sources: [],
      });
    }
    const entry = products.get(key);
    entry.qtyMilli += row.qtyMilli;
    entry.orders += row.orders.length;
    entry.sources.push({
      // Null until the order is accepted and an orchard is chosen.
      sourceName: row._id.sourceName || null,
      quantity: fromMilli(row.qtyMilli),
      orders: row.orders.length,
    });
  });

  const list = [...products.values()]
    .map((p) => ({
      product: p.product,
      name: p.name,
      unit: p.unit,
      quantity: fromMilli(p.qtyMilli),
      orders: p.orders,
      // Undecided last, then heaviest first: the decided ones are the ones
      // somebody is about to drive to.
      sources: p.sources.sort(
        (a, b) =>
          Number(a.sourceName === null) - Number(b.sourceName === null) || b.quantity - a.quantity
      ),
    }))
    .sort((a, b) => b.quantity - a.quantity);

  return ok(res, { from, to, products: list });
}

/**
 * Every order matching a filter, unpaged, for the printable sheet.
 *
 * A dispatch sheet that stops at row twenty is not a dispatch sheet, so this
 * does not page. `max` is the guard instead: a mistyped range cannot pull the
 * whole history into one response, and when the cap is reached the answer says
 * so rather than handing back a short sheet that looks complete.
 */
async function orderSheet(req, res) {
  const { max, ...filters } = req.query;
  const agingHours = filters.aging ? (await getSettings()).orderAgingHours : undefined;
  const filter = buildOrderFilter(filters, { agingHours });

  const [orders, total] = await Promise.all([
    // Oldest first: a sheet is worked through from the top, and the oldest
    // order is the one that has been waiting longest.
    Order.find(filter)
      .sort({ businessDate: 1, createdAt: 1 })
      .limit(max)
      .populate('reseller', 'shopName slug'),
    Order.countDocuments(filter),
  ]);

  return ok(res, {
    orders: orders.map(present.order),
    total,
    truncated: total > orders.length,
  });
}

/**
 * The stock report: what is on the shelf, against what has been leaving it.
 *
 * Stock and sales on one sheet because neither is a decision on its own. Forty
 * kilos in stock is comfortable or alarming depending entirely on whether forty
 * kilos went out last week, and the two numbers lived on different screens.
 *
 * `daysLeft` is deliberately arithmetic and not a forecast: stock divided by the
 * average day in the range. It is wrong the moment demand changes, which is why
 * it is reported beside the average it was derived from rather than alone.
 */
async function productsReport(req, res) {
  const { from, to } = rangeOf(req.query);

  const [products, sold] = await Promise.all([
    Product.find({ isArchived: false }, 'nameBn unit trackStock stockQtyMilli costPricePoisha isAvailable').sort({
      sortOrder: 1,
      nameBn: 1,
    }),
    Order.aggregate([
      { $match: { businessDate: { $gte: from, $lte: to }, status: TRADED } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          qtyMilli: { $sum: '$items.qtyMilli' },
          goodsPoisha: { $sum: '$items.lineCostPoisha' },
          customerPoisha: { $sum: '$items.lineSellPoisha' },
          orders: { $addToSet: '$_id' },
        },
      },
    ]),
  ]);

  const soldBy = new Map(sold.map((row) => [String(row._id), row]));

  // Inclusive day count, so a single-date range is one day and not zero.
  const days =
    Math.round(
      (startOfBusinessDay(to).getTime() - startOfBusinessDay(from).getTime()) / 86_400_000
    ) + 1;

  const rows = products.map((product) => {
    const stat = soldBy.get(String(product._id));
    const quantity = fromMilli(stat ? stat.qtyMilli : 0);
    const perDay = quantity / days;

    return {
      product: product._id,
      name: product.nameBn,
      unit: product.unit,
      isAvailable: product.isAvailable,
      trackStock: product.trackStock,
      // Only meaningful when stock is tracked; null says so rather than lying
      // with a zero, which reads as "out of stock".
      stock: product.trackStock ? fromMilli(product.stockQtyMilli) : null,
      costPrice: toTaka(product.costPricePoisha || 0),
      quantity,
      perDay: Math.round(perDay * 100) / 100,
      daysLeft:
        product.trackStock && perDay > 0
          ? Math.floor(fromMilli(product.stockQtyMilli) / perDay)
          : null,
      goods: toTaka(stat ? stat.goodsPoisha : 0),
      customerTotal: toTaka(stat ? stat.customerPoisha : 0),
      orders: stat ? stat.orders.length : 0,
    };
  });

  return ok(res, {
    from,
    to,
    days,
    products: rows.sort((a, b) => b.quantity - a.quantity),
  });
}

/**
 * The customer report: who buys, and who costs money to sell to.
 *
 * No date range, like the due report, because a customer record is a standing
 * projection of every order that number has ever placed rather than a property
 * of a period. See models/Customer.js: the phone number is the identity and the
 * name is not, so this is grouped by number and lists the names it has used.
 *
 * The refusal list is the reason this report exists. A number that orders ten
 * times and refuses six on delivery is not a good customer — on cash on delivery
 * that is the owner paying a courier six times for nothing — and an order count
 * on its own cannot show it.
 */
async function customersReport(req, res) {
  const limit = req.query.limit || 50;

  const [top, risky, totals] = await Promise.all([
    Customer.find({ orderCount: { $gt: 0 } })
      .sort({ totalSpendPoisha: -1 })
      .limit(limit),
    /*
     * Anyone who has ever refused a parcel, worst first. Not a ratio in the
     * query: the sort has to put "six refusals out of ten" above "one out of
     * one", and a bare ratio does the opposite.
     */
    Customer.find({ $or: [{ cancelledCount: { $gt: 0 } }, { returnedCount: { $gt: 0 } }] })
      .sort({ returnedCount: -1, cancelledCount: -1 })
      .limit(limit),
    Customer.aggregate([
      {
        $group: {
          _id: null,
          customers: { $sum: 1 },
          orders: { $sum: '$orderCount' },
          delivered: { $sum: '$deliveredCount' },
          cancelled: { $sum: '$cancelledCount' },
          returned: { $sum: '$returnedCount' },
          spendPoisha: { $sum: '$totalSpendPoisha' },
        },
      },
    ]),
  ]);

  const row = (c) => ({
    id: c._id,
    phone: c.phoneE164,
    // Most-used first, which is how the variants are stored.
    name: c.names && c.names.length ? c.names[0].value : '',
    nameCount: c.names ? c.names.length : 0,
    orders: c.orderCount,
    delivered: c.deliveredCount,
    cancelled: c.cancelledCount,
    returned: c.returnedCount,
    // Delivered orders only, so it is money collected rather than money hoped for.
    spend: toTaka(c.totalSpendPoisha),
    lastOrderAt: c.lastOrderAt,
  });

  const sum = totals[0] || {};

  return ok(res, {
    totals: {
      customers: sum.customers || 0,
      orders: sum.orders || 0,
      delivered: sum.delivered || 0,
      cancelled: sum.cancelled || 0,
      returned: sum.returned || 0,
      spend: toTaka(sum.spendPoisha || 0),
    },
    top: top.map(row),
    risky: risky.map(row),
  });
}

/* ------------------------------------------------------------------- exports */

// Cell escaping, formula-injection defence and the streaming itself live in
// utils/csv.js.

/**
 * Built from the same filter the list and the sheet use, so the file matches
 * what was on screen when the button was pressed. It previously built its own
 * and the screen sent nothing at all, which made every export the entire order
 * history however the dates above it were set.
 */
async function exportOrders(req, res) {
  const agingHours = req.query.aging ? (await getSettings()).orderAgingHours : undefined;
  const filter = buildOrderFilter(req.query, { agingHours });

  const headers = [
    'Order Code',
    'Date',
    'Status',
    'Payment Mode',
    'Shop',
    'Customer',
    'Phone',
    'District',
    'Items',
    'Cost Subtotal',
    'Sell Subtotal',
    'Delivery',
    'Customer Total',
    'Wallet Debit',
  ];

  const cursor = Order.find(filter)
    .sort({ createdAt: -1 })
    .populate('reseller', 'shopName')
    .cursor();

  const toRow = (order) => {
    const items = order.items
      .map((i) => `${i.productNameBn} x ${fromMilli(i.qtyMilli)}${i.unit}`)
      .join(' | ');

    return [
      order.orderCode,
      order.businessDate,
      order.status,
      order.paymentMode,
      order.reseller ? order.reseller.shopName : '',
      order.customer.name,
      // Quoted so Excel keeps the leading zero on a Bangladeshi mobile number.
      trustedFormula(`="${order.customer.phoneE164}"`),
      order.customer.district,
      items,
      toTaka(order.totals.costSubtotalPoisha),
      toTaka(order.totals.sellSubtotalPoisha),
      toTaka(order.deliveryChargePoisha),
      toTaka(order.totals.customerTotalPoisha),
      toTaka(order.totals.walletDebitPoisha),
    ];
  };

  await streamCsv(req, res, { filename: 'orders.csv', headers, cursor, toRow });
}

async function exportLedger(req, res) {
  const filter = {};
  if (req.query.reseller) filter.reseller = req.query.reseller;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = startOfBusinessDay(req.query.from);
    if (req.query.to) filter.createdAt.$lt = endOfBusinessDay(req.query.to);
  }

  const headers = [
    'Seq',
    'Date',
    'Shop',
    'Kind',
    'Amount',
    'Balance After',
    'Reference',
    'Note',
  ];

  const cursor = LedgerEntry.find(filter)
    .sort({ createdAt: 1 })
    .populate('reseller', 'shopName')
    .cursor();

  const toRow = (entry) => [
    entry.seq,
    // Dhaka wall-clock time. UTC put every early-morning entry on the day before.
    formatDhakaDateTime(entry.createdAt),
    entry.reseller && entry.reseller.shopName ? entry.reseller.shopName : '',
    entry.kind,
    toTaka(entry.amountPoisha),
    toTaka(entry.balanceAfterPoisha),
    `${entry.refType}:${entry.refId || ''}`,
    entry.note,
  ];

  await streamCsv(req, res, { filename: 'ledger.csv', headers, cursor, toRow });
}

module.exports = {
  dashboard,
  productsSold,
  ordersByDay,
  sales,
  resellerPerformance,
  productsReport,
  customersReport,
  pickList,
  orderSheet,
  exportOrders,
  exportLedger,
};
