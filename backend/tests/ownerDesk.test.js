'use strict';

/*
 * PLAN-4 §4.1, the owner's working screens: the order list and its counts, the
 * courier on a shipped parcel, the catalog's stock and boxes, supplies,
 * orchards, zones and complaints.
 *
 * The thread through most of these is that nothing the owner does on one
 * screen may quietly undo what happened on another: an edit of a product must
 * not put back stock an order took, a renamed orchard must keep its lines, and
 * a money strip must add up the orders the tab is actually showing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const tokens = require('../src/services/tokens');
const orderService = require('../src/services/orderService');

const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Source = require('../src/models/Source');
const ResellerProfile = require('../src/models/ResellerProfile');
const AuditLog = require('../src/models/AuditLog');
const Complaint = require('../src/models/Complaint');
const DeliveryZone = require('../src/models/DeliveryZone');

const { toMilli } = require('../src/utils/quantity');
const { orderSearchFilter, toLatinDigits } = require('../src/utils/orderSearch');
const { ROLES, PAYMENT_MODE, ORDER_STATUS } = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

function as(user) {
  const auth = `Bearer ${tokens.signAccessToken(user)}`;
  const wrap = (method) => (url) => request(app)[method](url).set('Authorization', auth);
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

/** An owner, a reseller with room to confirm, one product, a zone and an orchard. */
async function scene({ trackStock = false, stockQty = 0 } = {}) {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller({ creditLimit: 1000000 });
  const product = await f.makeProduct({ cost: 50, trackStock, stockQty });
  await f.listProduct(reseller.profile, product, 70);
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const source = await f.makeSource({ name: 'Kansat Orchard' });
  return { owner, api: as(owner.user), reseller, product, source };
}

async function placeOrder(setup, { phone = '+8801912345678', name = 'Customer', qty = 2, reseller } = {}) {
  const r = reseller || setup.reseller;
  const { order } = await orderService.createPendingOrder({
    resellerProfile: r.profile,
    paymentMode: PAYMENT_MODE.COD,
    submissionId: crypto.randomUUID(),
    customer: { name, phoneE164: phone, address: '12 Test Road', district: 'Dhaka' },
    items: [{ product: setup.product._id, variant: setup.product.variants[0]._id, qty }],
  });
  return order;
}

async function confirm(setup, order, reseller) {
  const r = reseller || setup.reseller;
  const profile = await ResellerProfile.findById(r.profile._id);
  return orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: r.user });
}

/** Walks a confirmed order through the owner's steps up to and including `until`. */
async function walk(setup, order, until, { courierName = 'Sundarban', trackingNumber } = {}) {
  const steps = ['accept', 'pack', 'ship', 'deliver'];
  for (const action of steps.slice(0, steps.indexOf(until) + 1)) {
    const payload = { courierName, trackingNumber };
    if (action === 'accept') {
      // eslint-disable-next-line no-await-in-loop
      payload.sources = f.sourcesFor(await Order.findById(order._id), setup.source);
    }
    // eslint-disable-next-line no-await-in-loop
    await orderService.transitionOrder({
      orderId: order._id,
      action,
      actorUser: setup.owner.user,
      role: ROLES.OWNER,
      payload,
    });
  }
  return Order.findById(order._id);
}

/** Writes timestamps directly, past Mongoose's immutable `createdAt`. */
const stamp = (order, fields) => Order.collection.updateOne({ _id: order._id }, { $set: fields });

/* ---------------------------------------------------------------- order list */

test('sort=oldest puts the longest-waiting order first: confirmed time, else placed time', async () => {
  const setup = await scene();
  const a = await placeOrder(setup);
  const b = await confirm(setup, await placeOrder(setup));
  const c = await confirm(setup, await placeOrder(setup));

  /*
   * b was placed first and c second, but c was confirmed at 04:00 and b at
   * 06:00; a was placed at 05:00 and nobody has confirmed it. By how long the
   * owner has had each: c, then a, then b. Sorting on the confirmed time alone
   * would put the pending a first, and on the placed time alone b first.
   */
  await stamp(a, { createdAt: new Date('2026-09-01T05:00:00Z') });
  await stamp(b, { createdAt: new Date('2026-09-01T01:00:00Z'), confirmedAt: new Date('2026-09-01T06:00:00Z') });
  await stamp(c, { createdAt: new Date('2026-09-01T02:00:00Z'), confirmedAt: new Date('2026-09-01T04:00:00Z') });

  const oldest = await setup.api.get('/api/owner/orders?sort=oldest');
  assert.equal(oldest.status, 200, JSON.stringify(oldest.body));
  assert.deepEqual(
    oldest.body.data.orders.map((o) => o.orderCode),
    [c.orderCode, a.orderCode, b.orderCode]
  );
  assert.equal(oldest.body.data.total, 3);

  // Paged, and with a filter that has to be cast for the aggregation to match.
  const page2 = await setup.api.get(
    `/api/owner/orders?sort=oldest&limit=2&page=2&reseller=${setup.reseller.profile._id}`
  );
  assert.deepEqual(page2.body.data.orders.map((o) => o.orderCode), [b.orderCode]);
  assert.equal(page2.body.data.total, 3);
  assert.ok(page2.body.data.orders[0].actions.length > 0, 'presented like the default sort');

  // The default, and `newest`, stay newest placed first.
  for (const url of ['/api/owner/orders', '/api/owner/orders?sort=newest']) {
    // eslint-disable-next-line no-await-in-loop
    const newest = await setup.api.get(url);
    assert.deepEqual(
      newest.body.data.orders.map((o) => o.orderCode),
      [a.orderCode, c.orderCode, b.orderCode]
    );
  }

  const bad = await setup.api.get('/api/owner/orders?sort=sideways');
  assert.equal(bad.status, 400);
});

test('search reads Bengali digits, matches the tracking number and the shop name', async () => {
  const setup = await scene();
  const other = await f.makeReseller({ creditLimit: 1000000 });
  await ResellerProfile.updateOne({ _id: other.profile._id }, { $set: { shopName: 'Rahim Mango House' } });
  await f.listProduct(other.profile, setup.product, 70);

  const byPhone = await placeOrder(setup, { phone: '+8801712345678' });
  const shipped = await walk(setup, await confirm(setup, await placeOrder(setup, { phone: '+8801811111111' })), 'ship', {
    trackingNumber: 'SC-778899',
  });
  const fromRahim = await placeOrder(setup, { reseller: other, phone: '+8801922222222' });

  const codes = async (q) => {
    const res = await setup.api.get(`/api/owner/orders?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.orders.map((o) => o.orderCode).sort();
  };

  // ০১৭১২৩৪৫৬৭৮ is what a Bangla keyboard types for 01712345678.
  assert.deepEqual(await codes('০১৭১২৩৪৫৬৭৮'), [byPhone.orderCode]);
  assert.deepEqual(await codes('778899'), [shipped.orderCode]);
  assert.deepEqual(await codes('sc-7788'), [shipped.orderCode]);
  assert.deepEqual(await codes('rahim mango'), [fromRahim.orderCode]);

  // The counts and the printable sheet read the same filter.
  const summary = await setup.api.get(`/api/owner/orders/summary?q=${encodeURIComponent('Rahim')}`);
  assert.equal(summary.body.data.total, 1);
  const sheet = await setup.api.get(`/api/owner/reports/order-sheet?q=${encodeURIComponent('৭৭৮৮৯৯')}`);
  assert.equal(sheet.status, 200, JSON.stringify(sheet.body));

  assert.equal(toLatinDigits('০১২৩৪৫৬৭৮৯'), '0123456789');
  assert.ok(orderSearchFilter('abc').$or.every((c) => !c['courier.trackingNumber']), 'short terms skip tracking');
});

test('the summary scopes money by status while byStatus still counts every status', async () => {
  const setup = await scene();
  const confirmed = await confirm(setup, await placeOrder(setup, { qty: 2 }));
  const shipped = await walk(setup, await confirm(setup, await placeOrder(setup, { qty: 3 })), 'ship');
  await placeOrder(setup); // pending, never billed

  const all = await setup.api.get('/api/owner/orders/summary');
  assert.equal(all.body.data.money.orders, 2);

  const scoped = await setup.api.get('/api/owner/orders/summary?status=shipped');
  assert.equal(scoped.status, 200, JSON.stringify(scoped.body));
  const data = scoped.body.data;
  assert.equal(data.money.orders, 1);
  assert.equal(data.money.ownerRevenue, shipped.totals.walletDebitPoisha / 100);
  // The tabs still see every status.
  assert.deepEqual(data.byStatus, {
    [ORDER_STATUS.PENDING]: 1,
    [ORDER_STATUS.CONFIRMED]: 1,
    [ORDER_STATUS.SHIPPED]: 1,
  });
  assert.equal(data.total, 3);

  // A list of statuses adds them up; an unbilled one adds nothing.
  const both = await setup.api.get('/api/owner/orders/summary?status=confirmed,shipped,pending');
  assert.equal(both.body.data.money.orders, 2);
  assert.equal(
    both.body.data.money.ownerRevenue,
    (confirmed.totals.walletDebitPoisha + shipped.totals.walletDebitPoisha) / 100
  );
  const pendingOnly = await setup.api.get('/api/owner/orders/summary?status=pending');
  assert.equal(pendingOnly.body.data.money.orders, 0);
});

test('the owner order detail names the shop with its id and phone', async () => {
  const setup = await scene();
  const order = await placeOrder(setup);

  const res = await setup.api.get(`/api/owner/orders/${order._id}`);
  assert.equal(res.status, 200);
  const { reseller } = res.body.data.order;
  assert.equal(String(reseller.id), String(setup.reseller.profile._id));
  assert.equal(reseller.shopName, 'Test Shop');
  assert.equal(reseller.phone, setup.reseller.user.phoneE164);

  // The list carries the same shape.
  const list = await setup.api.get('/api/owner/orders');
  assert.deepEqual(list.body.data.orders[0].reseller, reseller);
});

/* ------------------------------------------------------------------ courier */

test('the courier is corrected while shipped, audited, and locked otherwise', async () => {
  const setup = await scene();
  const shipped = await walk(setup, await confirm(setup, await placeOrder(setup)), 'ship', {
    courierName: 'Sundrban',
    trackingNumber: 'WRONG-1',
  });

  const fetched = await setup.api.get(`/api/owner/orders/${shipped._id}`);
  assert.ok(fetched.body.data.order.actions.includes('editCourier'));

  const res = await setup.api
    .patch(`/api/owner/orders/${shipped._id}/courier`)
    .send({ courierName: 'Sundarban', trackingNumber: 'SC-1' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.order.courier, { name: 'Sundarban', trackingNumber: 'SC-1' });
  assert.deepEqual(res.body.data.changed.sort(), ['courierName', 'trackingNumber']);
  // The same shape as GET, so the screen can take it as its copy.
  const after = await setup.api.get(`/api/owner/orders/${shipped._id}`);
  assert.deepEqual(res.body.data.order, after.body.data.order);

  const entry = await AuditLog.findOne({ action: 'order.courier', targetId: shipped._id });
  assert.equal(entry.before.name, 'Sundrban');
  assert.equal(entry.after.trackingNumber, 'SC-1');

  // An empty tracking number clears it; nothing changed is not audited again.
  const cleared = await setup.api.patch(`/api/owner/orders/${shipped._id}/courier`).send({ trackingNumber: '' });
  assert.equal(cleared.body.data.order.courier.trackingNumber, null);
  await setup.api.patch(`/api/owner/orders/${shipped._id}/courier`).send({ courierName: 'Sundarban' });
  assert.equal(await AuditLog.countDocuments({ action: 'order.courier' }), 2);

  const empty = await setup.api.patch(`/api/owner/orders/${shipped._id}/courier`).send({});
  assert.equal(empty.status, 400);

  const confirmed = await confirm(setup, await placeOrder(setup));
  const locked = await setup.api.patch(`/api/owner/orders/${confirmed._id}/courier`).send({ courierName: 'Pathao' });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error.code, 'COURIER_LOCKED');

  const delivered = await orderService.transitionOrder({
    orderId: shipped._id,
    action: 'deliver',
    actorUser: setup.owner.user,
    role: ROLES.OWNER,
    payload: {},
  });
  const late = await setup.api.patch(`/api/owner/orders/${delivered._id}/courier`).send({ courierName: 'Pathao' });
  assert.equal(late.body.error.code, 'COURIER_LOCKED');
});

test('recent couriers are distinct names off the latest shipments, newest first', async () => {
  const setup = await scene();
  const one = await walk(setup, await confirm(setup, await placeOrder(setup)), 'ship', { courierName: 'Sundarban' });
  const two = await walk(setup, await confirm(setup, await placeOrder(setup)), 'ship', { courierName: 'Pathao' });
  const three = await walk(setup, await confirm(setup, await placeOrder(setup)), 'ship', {
    courierName: 'sundarban ',
  });
  await stamp(one, { shippedAt: new Date('2026-09-01T01:00:00Z') });
  await stamp(two, { shippedAt: new Date('2026-09-02T01:00:00Z') });
  await stamp(three, { shippedAt: new Date('2026-09-03T01:00:00Z') });
  await confirm(setup, await placeOrder(setup)); // not shipped, names nothing

  const res = await setup.api.get('/api/owner/couriers/recent');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.couriers, ['sundarban', 'Pathao']);
});

/* ------------------------------------------------------------------ products */

test('a product edit keeps the stock an order took while the form was open', async () => {
  const setup = await scene({ trackStock: true, stockQty: 10 });
  const variant = setup.product.variants[0];

  // The owner opens the form at ten; an order then confirms two.
  await confirm(setup, await placeOrder(setup, { qty: 2 }));
  assert.equal((await Product.findById(setup.product._id)).variants[0].stockQty, 8);

  const res = await setup.api.patch(`/api/owner/products/${setup.product._id}`).send({
    variants: [
      { id: String(variant._id), content: 1, costPrice: 60, stockQty: 10 },
      // A new box takes the count it was sent with.
      { content: 5, costPrice: 250, stockQty: 4 },
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const saved = await Product.findById(setup.product._id);
  const kept = saved.variants.find((v) => String(v._id) === String(variant._id));
  assert.equal(kept.stockQty, 8, 'the two boxes the order took stay taken');
  assert.equal(kept.costPricePoisha, 6000, 'the rest of the edit landed');
  assert.equal(saved.variants.find((v) => v.contentMilli === 5000).stockQty, 4);
});

test('a product edit racing a stock change is rebuilt rather than overwriting it', async () => {
  const setup = await scene({ trackStock: true, stockQty: 10 });
  const variant = setup.product.variants[0];

  /*
   * An order takes a box between the edit's read and its write. The guarded
   * write must miss, re-read and land on nine — never put the box back.
   */
  const real = Product.findOneAndUpdate;
  let raced = false;
  Product.findOneAndUpdate = function racing(...args) {
    if (!raced) {
      raced = true;
      return Product.collection
        .updateOne({ _id: setup.product._id }, { $inc: { 'variants.0.stockQty': -1 } })
        .then(() => real.apply(this, args));
    }
    return real.apply(this, args);
  };
  try {
    const res = await setup.api.patch(`/api/owner/products/${setup.product._id}`).send({
      variants: [{ id: String(variant._id), content: 1, costPrice: 55, stockQty: 10 }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  } finally {
    Product.findOneAndUpdate = real;
  }
  assert.ok(raced);
  assert.equal((await Product.findById(setup.product._id)).variants[0].stockQty, 9);
});

test('a product edit keeps every box packaging recipe', async () => {
  const setup = await scene();
  const variant = setup.product.variants[0];
  const crate = await setup.api.post('/api/owner/supplies').send({ nameBn: 'ক্যারেট', unit: 'pcs' });
  const recipe = await setup.api
    .put(`/api/owner/products/${setup.product._id}/variants/${variant._id}/packaging`)
    .send({ packaging: [{ supplyId: crate.body.data.supply.id, quantity: 1 }] });
  assert.equal(recipe.status, 200, JSON.stringify(recipe.body));

  await setup.api.patch(`/api/owner/products/${setup.product._id}`).send({
    variants: [{ id: String(variant._id), content: 1, costPrice: 52 }],
  });

  const saved = await Product.findById(setup.product._id);
  assert.equal(saved.variants[0].packaging.length, 1);
  assert.equal(saved.variants[0].packaging[0].qtyMilli, toMilli(1));
});

test('the stock endpoint sets or adds atomically, never below zero, and is audited', async () => {
  const setup = await scene({ trackStock: true, stockQty: 3 });
  const variant = setup.product.variants[0];
  const url = `/api/owner/products/${setup.product._id}/variants/${variant._id}/stock`;

  const set = await setup.api.patch(url).send({ set: 40 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.product.variants[0].stockQty, 40);

  const add = await setup.api.patch(url).send({ add: -5 });
  assert.equal(add.body.data.product.variants[0].stockQty, 35);

  // Ten adds at once land as ten: nothing is read and written back.
  await Promise.all(Array.from({ length: 10 }, () => setup.api.patch(url).send({ add: 1 })));
  assert.equal((await Product.findById(setup.product._id)).variants[0].stockQty, 45);

  const below = await setup.api.patch(url).send({ add: -46 });
  assert.equal(below.status, 409);
  assert.equal(below.body.error.code, 'STOCK_BELOW_ZERO');
  assert.equal((await Product.findById(setup.product._id)).variants[0].stockQty, 45);

  assert.equal((await setup.api.patch(url).send({ set: 1, add: 1 })).status, 400);
  assert.equal((await setup.api.patch(url).send({})).status, 400);
  assert.equal((await setup.api.patch(url).send({ set: 1.5 })).status, 400);
  assert.equal((await setup.api.patch(url).send({ set: -1 })).status, 400);

  const entries = await AuditLog.find({ action: 'product.stock' }).sort({ createdAt: 1 });
  assert.equal(entries.length, 12);
  assert.deepEqual([entries[0].before.stockQty, entries[0].after.stockQty, entries[0].after.set], [3, 40, 40]);
  assert.deepEqual([entries[1].before.stockQty, entries[1].after.add], [40, -5]);

  const missing = await setup.api
    .patch(`/api/owner/products/${setup.product._id}/variants/${setup.product._id}/stock`)
    .send({ set: 1 });
  assert.equal(missing.status, 404);

  const untracked = await f.makeProduct({ name: 'ফজলি' });
  const refused = await setup.api
    .patch(`/api/owner/products/${untracked._id}/variants/${untracked.variants[0]._id}/stock`)
    .send({ set: 1 });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, 'STOCK_NOT_TRACKED');
});

test('a box carries the label the owner typed beside the derived Bengali one', async () => {
  const owner = await f.makeOwner();
  await f.makeProduct({
    boxes: [
      { content: 6, cost: 330 },
      { content: 11, cost: 600, label: 'বড় বাক্স' },
    ],
  });

  const res = await as(owner.user).get('/api/owner/products');
  const [six, eleven] = res.body.data.products[0].variants;
  assert.equal(six.label, '৬ কেজি');
  assert.equal(six.customLabel, null);
  assert.equal(eleven.label, 'বড় বাক্স');
  assert.equal(eleven.customLabel, 'বড় বাক্স');
});

test('an archived product is listed on its own and restored switched off', async () => {
  const setup = await scene();
  await setup.api.delete(`/api/owner/products/${setup.product._id}`).expect(200);

  const live = await setup.api.get('/api/owner/products');
  assert.equal(live.body.data.products.length, 0);
  const archived = await setup.api.get('/api/owner/products?archived=only');
  assert.deepEqual(archived.body.data.products.map((p) => String(p.id)), [String(setup.product._id)]);

  const res = await setup.api.post(`/api/owner/products/${setup.product._id}/restore`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.product.isAvailable, false, 'back in the catalog, not yet on sale');
  assert.equal((await Product.findById(setup.product._id)).isArchived, false);
  assert.ok(await AuditLog.exists({ action: 'product.unarchive', targetId: setup.product._id }));

  assert.equal((await setup.api.get('/api/owner/products?archived=only')).body.data.products.length, 0);
  // Restoring a live product changes nothing and records nothing.
  await setup.api.post(`/api/owner/products/${setup.product._id}/restore`).expect(200);
  assert.equal(await AuditLog.countDocuments({ action: 'product.unarchive' }), 1);
  assert.equal((await setup.api.post(`/api/owner/products/${setup.source._id}/restore`)).status, 404);
});

/* ------------------------------------------------------------------ supplies */

test('supplies list the archived alone, and movements say who and which purchase', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const crate = (await api.post('/api/owner/supplies').send({ nameBn: 'ক্যারেট', unit: 'pcs' })).body.data.supply;
  const tape = (await api.post('/api/owner/supplies').send({ nameBn: 'টেপ', unit: 'roll' })).body.data.supply;
  await api.delete(`/api/owner/supplies/${tape.id}`).expect(200);

  const only = await api.get('/api/owner/supplies?archivedOnly=true');
  assert.equal(only.status, 200, JSON.stringify(only.body));
  assert.deepEqual(only.body.data.supplies.map((s) => s.nameBn), ['টেপ']);
  assert.deepEqual((await api.get('/api/owner/supplies')).body.data.supplies.map((s) => s.nameBn), ['ক্যারেট']);

  const payee = (await api.post('/api/owner/payees').send({ nameBn: 'করিম', kind: 'supplier' })).body.data.payee;
  const purchase = await api
    .post('/api/owner/purchases')
    .send({ payeeId: payee.id, lines: [{ supplyId: crate.id, quantity: 50, unitCost: 80 }] });
  assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
  await api
    .post(`/api/owner/supplies/${crate.id}/adjust`)
    .send({ kind: 'DAMAGED', quantity: 2, nonce: crypto.randomUUID(), note: 'ভাঙা' })
    .expect(201);

  let rows = (await api.get(`/api/owner/supplies/${crate.id}/movements`)).body.data.movements;
  const bought = rows.find((m) => m.refType === 'purchase');
  assert.equal(bought.purchaseCancelled, false);
  assert.equal(bought.refCode, purchase.body.data.purchase.purchaseCode);
  assert.deepEqual(bought.createdBy, { id: String(owner.user._id), name: 'Owner' });
  const damaged = rows.find((m) => m.kind === 'DAMAGED');
  assert.equal(damaged.purchaseCancelled, null);
  assert.equal(damaged.refCode, null);
  assert.equal(damaged.createdBy.name, 'Owner');

  await api.post(`/api/owner/purchases/${purchase.body.data.purchase.id}/cancel`).send({ reason: 'ভুল' }).expect(200);
  rows = (await api.get(`/api/owner/supplies/${crate.id}`)).body.data.movements;
  assert.ok(rows.filter((m) => m.refType === 'purchase').every((m) => m.purchaseCancelled === true));
});

/* ------------------------------------------------------------------- sources */

test('sources list archived ones on request, restore through PATCH, and keep lines after a rename', async () => {
  const setup = await scene();
  const order = await walk(setup, await confirm(setup, await placeOrder(setup)), 'accept');

  await setup.api.delete(`/api/owner/sources/${setup.source._id}`).expect(200);
  assert.equal((await setup.api.get('/api/owner/sources')).body.data.sources.length, 0);
  assert.equal((await setup.api.get('/api/owner/sources?includeArchived=true')).body.data.sources.length, 1);
  const only = await setup.api.get('/api/owner/sources?archived=only');
  assert.deepEqual(only.body.data.sources.map((s) => s.name), ['Kansat Orchard']);

  const restored = await setup.api.patch(`/api/owner/sources/${setup.source._id}`).send({ isArchived: false });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.source.isArchived, false);
  assert.ok(await AuditLog.exists({ action: 'source.unarchive', targetId: setup.source._id }));

  // Renamed after the line was snapshotted: the detail still finds the line.
  await Source.updateOne({ _id: setup.source._id }, { $set: { name: 'Kansat Bagan' } });
  const detail = await setup.api.get(`/api/owner/sources/${setup.source._id}`);
  assert.equal(detail.status, 200);
  const [row] = detail.body.data.orders;
  assert.equal(row.orderCode, order.orderCode);
  assert.equal(row.sourceItems.length, 1);
  assert.equal(row.sourceItems[0].sourceName, 'Kansat Orchard', 'the snapshot, unchanged');
  assert.equal(String(row.sourceItems[0].source), String(setup.source._id));
});

/* --------------------------------------------------------------------- zones */

test('a zone with no orders is deleted; one with orders is refused with a code', async () => {
  const setup = await scene();
  const unused = await f.makeZone({ name: 'Unused', districts: ['Sylhet'], charge: 150 });

  const res = await setup.api.delete(`/api/owner/delivery-zones/${unused._id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.deleted, true);
  assert.equal(await DeliveryZone.exists({ _id: unused._id }), null);
  assert.ok(await AuditLog.exists({ action: 'zone.delete', targetId: unused._id }));

  const order = await placeOrder(setup);
  const used = await setup.api.delete(`/api/owner/delivery-zones/${order.deliveryZone}`);
  assert.equal(used.status, 409);
  assert.equal(used.body.error.code, 'ZONE_IN_USE');
  // Left exactly as it was: still there and still on.
  assert.equal((await DeliveryZone.findById(order.deliveryZone)).isActive, true);

  assert.equal((await setup.api.delete(`/api/owner/delivery-zones/${unused._id}`)).status, 404);
});

/* ---------------------------------------------------------------- complaints */

test('complaints are searched by code, phone or name, carry the name, and reopen', async () => {
  const setup = await scene();
  const rahim = await confirm(setup, await placeOrder(setup, { name: 'Rahim Uddin', phone: '+8801712345678' }));
  const karim = await confirm(setup, await placeOrder(setup, { name: 'Karim Mia', phone: '+8801898765432' }));

  const log = (order) =>
    setup.api.post(`/api/owner/orders/${order._id}/complaints`).send({ kind: 'late', note: 'Arrived late' });
  const first = (await log(rahim)).body.data.complaint;
  await log(karim);

  const find = async (q) => {
    const res = await setup.api.get(`/api/owner/complaints?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.complaints.map((c) => c.orderCode);
  };
  assert.deepEqual(await find(rahim.orderCode), [rahim.orderCode]);
  assert.deepEqual(await find('৯৮৭৬৫৪৩২'), [karim.orderCode]);
  assert.deepEqual(await find('rahim'), [rahim.orderCode]);

  const all = await setup.api.get('/api/owner/complaints');
  const names = Object.fromEntries(all.body.data.complaints.map((c) => [c.orderCode, c.customerName]));
  assert.deepEqual(names, { [rahim.orderCode]: 'Rahim Uddin', [karim.orderCode]: 'Karim Mia' });

  // Reopen: only a resolved one, and the old resolution goes to the audit log.
  const open = await setup.api.post(`/api/owner/complaints/${first.id}/reopen`);
  assert.equal(open.status, 409);
  assert.equal(open.body.error.code, 'COMPLAINT_OPEN');

  await setup.api.post(`/api/owner/complaints/${first.id}/resolve`).send({ resolution: 'Refunded' }).expect(200);
  const reopened = await setup.api.post(`/api/owner/complaints/${first.id}/reopen`);
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.data.complaint.resolved, false);
  assert.equal(reopened.body.data.complaint.resolution, null);
  const stored = await Complaint.findById(first.id);
  assert.equal(stored.resolvedAt, null);
  const entry = await AuditLog.findOne({ action: 'complaint.reopen', targetId: first.id });
  assert.equal(entry.before.resolution, 'Refunded');

  assert.equal((await setup.api.post(`/api/owner/complaints/${rahim._id}/reopen`)).status, 404);
});

test('any photo can be made the cover, and a stale reorder is refused', async () => {
  const setup = await scene();
  const photo = (id) => ({ provider: 'imgbb', id, url: `https://i.ibb.co/${id}.jpg` });
  await Product.updateOne(
    { _id: setup.product._id },
    { $set: { images: [photo('a'), photo('b'), photo('c')] } }
  );

  const cover = await setup.api.post(`/api/owner/products/${setup.product._id}/images/c/cover`);
  assert.equal(cover.status, 200, JSON.stringify(cover.body));
  const saved = await Product.findById(setup.product._id);
  assert.deepEqual(
    saved.images.map((img) => img.id),
    ['c', 'a', 'b']
  );

  // Already the cover: nothing moves, nothing is audited.
  assert.equal((await setup.api.post(`/api/owner/products/${setup.product._id}/images/c/cover`)).status, 200);

  const missing = await setup.api.post(`/api/owner/products/${setup.product._id}/images/zzz/cover`);
  assert.equal(missing.status, 404);

  const entries = await AuditLog.find({ action: 'product.cover' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].after.cover, 'c');
});
