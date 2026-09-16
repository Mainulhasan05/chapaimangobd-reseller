'use strict';

/**
 * Reports, exports and the date filters they share.
 *
 * The thread running through these: every screen that narrows a list of orders
 * — the list itself, the counts beside it, the printable sheet and the CSV —
 * has to narrow it the same way. They each used to build their own filter, and
 * the export built none at all, so a one-day view could sit above a button that
 * downloaded the whole history. `utils/orderFilter.js` is now the only place
 * that turns a query into a Mongo filter, and these hold it to that.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const Order = require('../src/models/Order');

const { PAYMENT_MODE, ORDER_STATUS } = require('../src/domain/constants');
const { businessDate } = require('../src/utils/dhakaTime');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

async function signIn({ phone, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

/** An owner agent with a reseller, a zone, a source and one listed product. */
async function scene() {
  const owner = await f.makeOwner();
  const agent = await signIn({ phone: owner.phone, password: owner.password });
  // Confirm debits the wallet, and the default credit limit is zero, so without
  // headroom every order in this file would be refused before it existed.
  const reseller = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(reseller.profile, product, 62);
  const source = await f.makeSource({ name: 'Kansat Orchard' });

  const shop = await signIn({ phone: reseller.phone, password: reseller.password });
  return { agent, shop, profile: reseller.profile, product, source };
}

/** A confirmed order, which is the first state that has moved any money. */
async function confirmedOrder(setup, { quantity = 10 } = {}) {
  const placed = await request(app)
    .post(`/api/public/shop/${setup.profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.COD,
      customer: f.customer(),
      items: [{ product: String(setup.product._id), quantity }],
    });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));

  const order = await Order.findOne({ orderCode: placed.body.data.orderCode });
  const confirmed = await setup.shop.post(`/api/reseller/orders/${order._id}/confirm`).send({});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

  // Confirm rebuilds the items array, so the line ids the accept has to name
  // only exist on the order as it is after this point.
  return Order.findById(order._id);
}

/** The accept payload for an order, sending every line to the scene's source. */
const sources = (order, setup) => f.sourcesFor(order, setup.source);

/* ------------------------------------------------------------ date filters */

test('a date that is not a date is a bad request, not a crash', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  /*
   * Every one of these reaches `new Date(`${value}T00:00:00+06:00`)`. Before
   * the query schemas checked the shape, an unparseable value became an Invalid
   * Date, which Mongoose refused to cast, which surfaced as a 500: a bad query
   * string was reported to the owner as the server being broken.
   */
  for (const path of [
    '/api/owner/orders?from=yesterday',
    '/api/owner/reports/sales?from=2026-13-40',
    '/api/owner/reports/orders-by-day?to=not-a-date',
    '/api/owner/exports/orders.csv?from=last-week',
  ]) {
    const res = await agent.get(path);
    assert.equal(res.status, 400, `${path} answered ${res.status}`);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  }
});

test('February the thirty-first is refused, because it parses and is not a day', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  const res = await agent.get('/api/owner/orders?from=2026-02-31');
  assert.equal(res.status, 400);
});

test('a backwards range is refused rather than answered with nothing', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  // An empty report reads as "no orders", which is a different statement from
  // "you asked for the seventh to the first".
  const res = await agent.get('/api/owner/orders?from=2026-09-10&to=2026-09-01');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test("today's orders are found by today's date and not by yesterday's", async () => {
  const setup = await scene();
  await confirmedOrder(setup);
  const today = businessDate();
  const yesterday = businessDate(new Date(Date.now() - 86_400_000));

  const hit = await setup.agent.get(`/api/owner/orders?from=${today}&to=${today}`);
  assert.equal(hit.status, 200);
  assert.equal(hit.body.data.total, 1);

  const miss = await setup.agent.get(`/api/owner/orders?from=${yesterday}&to=${yesterday}`);
  assert.equal(miss.body.data.total, 0);
});

/* ---------------------------------------------------------------- summary */

test('the counts beside the list are the counts the list returns', async () => {
  const setup = await scene();
  await confirmedOrder(setup);
  await confirmedOrder(setup);
  const today = businessDate();

  const summary = await setup.agent.get(`/api/owner/orders/summary?from=${today}&to=${today}`);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.byStatus[ORDER_STATUS.CONFIRMED], 2);
  assert.equal(summary.body.data.total, 2);

  const list = await setup.agent.get(
    `/api/owner/orders?status=confirmed&from=${today}&to=${today}`
  );
  assert.equal(list.body.data.total, summary.body.data.byStatus[ORDER_STATUS.CONFIRMED]);
});

test('a status chip counts every status, not only the one being filtered on', async () => {
  const setup = await scene();
  await confirmedOrder(setup);

  // `status` is what the tabs choose between, so the summary has to ignore it
  // or each tab would only ever be able to report its own count.
  const res = await setup.agent.get('/api/owner/orders/summary?status=delivered');
  assert.equal(res.body.data.byStatus[ORDER_STATUS.CONFIRMED], 1);
});

test("the summary's money is the owner's revenue, not the customer's total", async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup, { quantity: 10 });
  const today = businessDate();

  const res = await setup.agent.get(`/api/owner/orders/summary?from=${today}&to=${today}`);
  const { money } = res.body.data;

  /*
   * The distinction this whole report layer rests on. The owner bills the
   * reseller for goods at cost plus delivery; the customer total additionally
   * carries the reseller's margin, which is not the owner's money. Reporting
   * the second as revenue overstates every figure by the resellers' earnings.
   */
  assert.equal(money.ownerRevenue, order.totals.walletDebitPoisha / 100);
  assert.equal(money.customerTotal, order.totals.customerTotalPoisha / 100);
  assert.ok(money.customerTotal > money.ownerRevenue, 'margin vanished');
  assert.equal(money.goods + money.delivery, money.ownerRevenue);
});

test('a cancelled order is counted but is not trade', async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup);
  const cancelled = await setup.agent
    .post(`/api/owner/orders/${order._id}/cancel`)
    .send({ reason: 'Customer changed their mind' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  const res = await setup.agent.get('/api/owner/orders/summary');
  assert.equal(res.body.data.byStatus[ORDER_STATUS.CANCELLED], 1);
  // Never billed, so it cannot appear as revenue.
  assert.equal(res.body.data.money.ownerRevenue, 0);
  assert.equal(res.body.data.money.orders, 0);
});

/* -------------------------------------------------------------- dashboard */

test('the dashboard reports the money and the exposure, not only the counts', async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup);

  const res = await setup.agent.get('/api/owner/reports/dashboard');
  assert.equal(res.status, 200);
  const data = res.body.data;

  assert.equal(data.ordersToday, 1);
  assert.equal(data.money.ownerRevenue, order.totals.walletDebitPoisha / 100);
  assert.equal(data.pendingKyc, 0);
  assert.equal(typeof data.health.lowStock, 'number');
  assert.equal(typeof data.health.deadLetters, 'number');
  // Nothing has shipped, so no courier is carrying anything yet.
  assert.equal(data.codInFlight.orders, 0);
  assert.equal(data.codInFlight.amount, 0);
});

test('cash with a courier is counted from ship and stops being counted at deliver', async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup);

  await setup.agent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: sources(order, setup) });
  await setup.agent.post(`/api/owner/orders/${order._id}/pack`).send({});
  const shipped = await setup.agent
    .post(`/api/owner/orders/${order._id}/ship`)
    .send({ courierName: 'Sundarban', trackingNumber: 'SC-1' });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));

  const inFlight = await setup.agent.get('/api/owner/reports/dashboard');
  assert.equal(inFlight.body.data.codInFlight.orders, 1);
  assert.equal(inFlight.body.data.codInFlight.amount, order.totals.customerTotalPoisha / 100);

  await setup.agent.post(`/api/owner/orders/${order._id}/deliver`).send({});

  // Delivered is where the collection credit posts, so the money is no longer
  // out in the world and must stop being reported as exposure.
  const settled = await setup.agent.get('/api/owner/reports/dashboard');
  assert.equal(settled.body.data.codInFlight.orders, 0);
  assert.equal(settled.body.data.codInFlight.amount, 0);
});

test('the pipeline counts open orders only, so it cannot grow for ever', async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup);

  await setup.agent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: sources(order, setup) });
  await setup.agent.post(`/api/owner/orders/${order._id}/pack`).send({});
  await setup.agent
    .post(`/api/owner/orders/${order._id}/ship`)
    .send({ courierName: 'Sundarban', trackingNumber: 'SC-2' });
  await setup.agent.post(`/api/owner/orders/${order._id}/deliver`).send({});

  const res = await setup.agent.get('/api/owner/reports/dashboard');
  /*
   * `byStatus` was an unfiltered group over the whole collection, so the
   * pipeline bar and the order tabs counted every order ever delivered: a
   * number that only grows and stops meaning anything by the end of a season.
   */
  assert.equal(res.body.data.byStatus[ORDER_STATUS.DELIVERED], undefined);
  assert.equal(res.body.data.closedToday.delivered, 1);
});

/* ---------------------------------------------------------------- reports */

test('the sales report agrees with itself across every breakdown', async () => {
  const setup = await scene();
  await confirmedOrder(setup);
  await confirmedOrder(setup);
  const today = businessDate();

  const res = await setup.agent.get(`/api/owner/reports/sales?from=${today}&to=${today}`);
  assert.equal(res.status, 200);
  const data = res.body.data;

  assert.equal(data.totals.orders, 2);

  // A printed report whose header disagrees with the table under it is worse
  // than no report, so the totals are checked against each breakdown.
  const byDay = data.days.reduce((sum, day) => sum + day.ownerRevenue, 0);
  assert.equal(byDay, data.totals.ownerRevenue);

  const byMode = data.paymentModes.reduce((sum, mode) => sum + mode.ownerRevenue, 0);
  assert.equal(byMode, data.totals.ownerRevenue);

  const byProduct = data.products.reduce((sum, product) => sum + product.goods, 0);
  assert.equal(byProduct, data.totals.goods);
});

test('the sales report counts what did not trade as well as what did', async () => {
  const setup = await scene();
  const kept = await confirmedOrder(setup);
  const dropped = await confirmedOrder(setup);
  await setup.agent
    .post(`/api/owner/orders/${dropped._id}/cancel`)
    .send({ reason: 'Out of stock at the orchard' });

  const res = await setup.agent.get('/api/owner/reports/sales');
  assert.equal(res.body.data.totals.orders, 1);
  assert.equal(res.body.data.cancelled.orders, 1);
  assert.equal(res.body.data.totals.ownerRevenue, kept.totals.walletDebitPoisha / 100);
});

test('the reseller report lists a reseller who sold nothing', async () => {
  const setup = await scene();
  await confirmedOrder(setup);
  // Somebody who has traded nothing at all in the range.
  await f.makeReseller();

  const res = await setup.agent.get('/api/owner/reports/resellers');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.resellers.length, 2);

  // "Sold nothing this month" is the finding, so the row has to be there.
  const quiet = res.body.data.resellers.filter((row) => row.orders === 0);
  assert.equal(quiet.length, 1);
  assert.equal(res.body.data.totals.orders, 1);
});

test('a confirmed order is on the pick list with no orchard chosen yet', async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup, { quantity: 10 });

  const before = await setup.agent.get('/api/owner/reports/pick-list');
  assert.equal(before.status, 200);
  assert.equal(before.body.data.products.length, 1);
  assert.equal(before.body.data.products[0].quantity, 10);
  /*
   * A source is chosen at accept, not before (docs/adr/0006). Reporting it
   * under an orchard now would overstate what that orchard owes.
   */
  assert.equal(before.body.data.products[0].sources[0].sourceName, null);

  await setup.agent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: sources(order, setup) });

  const after = await setup.agent.get('/api/owner/reports/pick-list');
  assert.ok(after.body.data.products[0].sources[0].sourceName, 'the orchard never appeared');
});

test('the pick list drops an order once it has shipped', async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup);

  await setup.agent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: sources(order, setup) });
  await setup.agent.post(`/api/owner/orders/${order._id}/pack`).send({});
  await setup.agent
    .post(`/api/owner/orders/${order._id}/ship`)
    .send({ courierName: 'Sundarban', trackingNumber: 'SC-3' });

  // Nothing left to collect: it has already gone.
  const res = await setup.agent.get('/api/owner/reports/pick-list');
  assert.equal(res.body.data.products.length, 0);
});

test('the printable sheet is unpaged and says when it had to stop', async () => {
  const setup = await scene();
  await confirmedOrder(setup);
  await confirmedOrder(setup);
  await confirmedOrder(setup);

  const all = await setup.agent.get('/api/owner/reports/order-sheet');
  assert.equal(all.status, 200);
  assert.equal(all.body.data.orders.length, 3);
  assert.equal(all.body.data.truncated, false);

  /*
   * A dispatch sheet that quietly stopped short would be worked through to the
   * end and the rest would simply never be packed, so the cap is reported.
   */
  const capped = await setup.agent.get('/api/owner/reports/order-sheet?max=2');
  assert.equal(capped.body.data.orders.length, 2);
  assert.equal(capped.body.data.total, 3);
  assert.equal(capped.body.data.truncated, true);
});

test('the stock report says nothing rather than zero when stock is untracked', async () => {
  const setup = await scene();
  await confirmedOrder(setup, { quantity: 10 });

  const res = await setup.agent.get('/api/owner/reports/products');
  assert.equal(res.status, 200);
  const row = res.body.data.products.find((p) => String(p.product) === String(setup.product._id));

  assert.equal(row.quantity, 10);
  // A zero here would read as "sold out", which is the opposite of unlimited.
  assert.equal(row.trackStock, false);
  assert.equal(row.stock, null);
  assert.equal(row.daysLeft, null);
});

/* ---------------------------------------------------------------- exports */

test('the orders export carries the filter it was asked for', async () => {
  const setup = await scene();
  await confirmedOrder(setup);
  const today = businessDate();
  const yesterday = businessDate(new Date(Date.now() - 86_400_000));

  const included = await setup.agent.get(
    `/api/owner/exports/orders.csv?from=${today}&to=${today}`
  );
  assert.equal(included.status, 200);
  assert.match(included.headers['content-type'], /csv/);
  assert.equal(included.text.trim().split('\n').length, 2, 'header plus one order');

  /*
   * The screen sent no dates at all and the handler built its own filter, so
   * every export was the whole order history however the dates above it were
   * set. This is the case that proves the two now agree.
   */
  const excluded = await setup.agent.get(
    `/api/owner/exports/orders.csv?from=${yesterday}&to=${yesterday}`
  );
  assert.equal(excluded.text.trim().split('\n').length, 1, 'header only');
});

test('the orders export narrows by status like the list does', async () => {
  const setup = await scene();
  await confirmedOrder(setup);

  const none = await setup.agent.get('/api/owner/exports/orders.csv?status=delivered');
  assert.equal(none.text.trim().split('\n').length, 1);

  const one = await setup.agent.get('/api/owner/exports/orders.csv?status=confirmed');
  assert.equal(one.text.trim().split('\n').length, 2);
});

/* ------------------------------------------------------------------ guard */

test('every report is behind the owner login', async () => {
  const { phone, password } = await f.makeReseller();
  const reseller = await signIn({ phone, password });

  for (const path of [
    '/api/owner/reports/sales',
    '/api/owner/reports/resellers',
    '/api/owner/reports/pick-list',
    '/api/owner/reports/order-sheet',
    '/api/owner/reports/products',
    '/api/owner/reports/customers',
    '/api/owner/orders/summary',
  ]) {
    const res = await reseller.get(path);
    assert.equal(res.status, 403, `${path} let a reseller in`);
  }
});
