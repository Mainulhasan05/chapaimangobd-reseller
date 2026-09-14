'use strict';

/*
 * Phase E: reseller lifecycle and orders (docs/PLAN-2.md).
 * Deactivation cascade and read-only access (docs/adr/0011), the KYC
 * double-submission guard, customer detail edits, audit coverage and the
 * owner's audit log API.
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
const ledger = require('../src/services/ledger');
const audit = require('../src/services/audit');
const { withTransaction } = require('../src/services/tx');

const Order = require('../src/models/Order');
const User = require('../src/models/User');
const ResellerProfile = require('../src/models/ResellerProfile');
const KycSubmission = require('../src/models/KycSubmission');
const Customer = require('../src/models/Customer');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');
const Withdrawal = require('../src/models/Withdrawal');
const LedgerEntry = require('../src/models/LedgerEntry');

const { toPoisha } = require('../src/utils/money');
const { toMilli } = require('../src/utils/quantity');
const {
  ROLES,
  PAYMENT_MODE,
  ORDER_STATUS,
  REVIEW_STATUS,
  LEDGER_KIND,
  EVENT_TYPE,
  KYC_STATUS,
} = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

/*
 * A session minted directly rather than through /auth/login, so these tests
 * exercise the authorization boundary and not the login flow, whose rules
 * (lockout, device trust) are Phase D's.
 */
function as(user) {
  const auth = `Bearer ${tokens.signAccessToken(user)}`;
  const wrap = (method) => (url) => request(app)[method](url).set('Authorization', auth);
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

async function placeOrder(profile, product, { phone = '+8801912345678', name = 'Customer' } = {}) {
  const { order } = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode: PAYMENT_MODE.PREPAID,
    submissionId: crypto.randomUUID(),
    customer: { name, phoneE164: phone, address: '12 Test Road', district: 'Dhaka' },
    items: [{ product: product._id, qtyMilli: toMilli(10) }],
  });
  return order;
}

async function credit(profile, taka) {
  return withTransaction((session) =>
    ledger.postEntry(session, {
      reseller: profile._id,
      kind: LEDGER_KIND.MANUAL_CREDIT,
      amountPoisha: toPoisha(taka),
      idempotencyKey: ledger.keys.manual(crypto.randomUUID()),
      refType: 'manual',
    })
  );
}

async function confirm(order, profile, user) {
  return orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });
}

async function walk(orderId, action, owner, source) {
  const payload = { courierName: 'Sundarban' };
  if (action === 'accept') payload.sources = f.sourcesFor(await Order.findById(orderId), source);
  return orderService.transitionOrder({ orderId, action, actorUser: owner, role: ROLES.OWNER, payload });
}

/** A shop with one listed product, a zone, and enough balance to confirm. */
async function shop({ formActive = true } = {}) {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller({ formActive });
  const product = await f.makeProduct({ cost: 50 });
  await f.listProduct(reseller.profile, product, 70);
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  await credit(reseller.profile, 5000);
  const profile = await ResellerProfile.findById(reseller.profile._id);
  return { owner, reseller: { ...reseller, profile }, product };
}

/* -------------------------------------------------------------- deactivation */

test('deactivating cancels pending orders only, closes the shop and is audited', async () => {
  const { owner, reseller, product } = await shop();
  const pendingA = await placeOrder(reseller.profile, product);
  const pendingB = await placeOrder(reseller.profile, product, { phone: '+8801912345679' });
  const confirmed = await confirm(await placeOrder(reseller.profile, product), reseller.profile, reseller.user);
  const entriesBefore = await LedgerEntry.countDocuments();

  const res = await as(owner.user).patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.reseller.isActive, false);
  assert.equal(res.body.data.reseller.formActive, false);
  assert.deepEqual(res.body.data.cancelledOrders.sort(), [pendingA.orderCode, pendingB.orderCode].sort());

  for (const o of [pendingA, pendingB]) {
    // eslint-disable-next-line no-await-in-loop
    const after = await Order.findById(o._id);
    assert.equal(after.status, ORDER_STATUS.CANCELLED);
    assert.equal(after.cancelReason, 'reseller_deactivated');
    assert.equal(after.cancelledBy, null);
    assert.equal(after.statusHistory.at(-1).status, ORDER_STATUS.CANCELLED);
  }
  assert.equal((await Order.findById(confirmed._id)).status, ORDER_STATUS.CONFIRMED);
  // Pending orders never posted, so cancelling them posts nothing.
  assert.equal(await LedgerEntry.countDocuments(), entriesBefore);

  const profile = await ResellerProfile.findById(reseller.profile._id);
  assert.equal(profile.formActive, false);
  assert.equal(profile.formActiveBeforeDeactivation, true);

  const entry = await AuditLog.findOne({ action: 'reseller.deactivate' });
  assert.ok(entry);
  assert.deepEqual(entry.before, { isActive: true, formActive: true });
  assert.equal(entry.after.isActive, false);
  assert.equal(entry.after.cancelledOrders.length, 2);

  assert.ok(await Notification.exists({ user: reseller.user._id, eventType: EVENT_TYPE.RESELLER_DEACTIVATED }));
  const buyer = await Customer.findOne({ phoneE164: '+8801912345678' });
  assert.equal(buyer.cancelledCount, 1);

  // A confirmed order is still fulfilled by the owner.
  const source = await f.makeSource();
  const accepted = await walk(confirmed._id, 'accept', owner.user, source);
  assert.equal(accepted.status, ORDER_STATUS.ACCEPTED);
});

test("a deactivated reseller's shop says it is not taking orders and refuses submissions", async () => {
  const { owner, reseller, product } = await shop();
  await as(owner.user).patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: false });

  const page = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.data.acceptingOrders, false);
  assert.equal(page.body.data.reason, 'inactive');
  assert.equal(page.body.data.shop.name, 'Test Shop');
  assert.deepEqual(page.body.data.products, []);

  const submit = await request(app)
    .post(`/api/public/shop/${reseller.profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.COD,
      customer: f.customer(),
      items: [{ product: String(product._id), quantity: 10 }],
    });
  assert.equal(submit.status, 409, JSON.stringify(submit.body));
  assert.equal(submit.body.error.code, 'SHOP_NOT_ACCEPTING');
  assert.equal(await Order.countDocuments({ status: ORDER_STATUS.PENDING }), 0);
});

test('an open shop says it is accepting orders', async () => {
  const { reseller } = await shop();
  const page = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.data.acceptingOrders, true);
  assert.equal(page.body.data.reason, null);
});

test('a deactivated reseller can read and request a withdrawal, and nothing else', async () => {
  const { owner, reseller, product } = await shop();
  const pending = await placeOrder(reseller.profile, product);
  await as(owner.user).patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: false });
  const me = as(await User.findById(reseller.user._id));

  const profile = await me.get('/api/reseller/profile');
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.profile.isActive, false);
  assert.equal((await me.get('/api/reseller/orders')).status, 200);
  assert.equal((await me.get('/api/reseller/wallet')).status, 200);
  assert.equal((await me.get('/api/auth/me')).status, 200);
  assert.equal((await me.post('/api/reseller/notifications/read')).status, 200);

  const withdrawal = await me
    .post('/api/reseller/withdrawals')
    .send({ amount: 1000, method: 'bkash', destinationNumber: '01712345678' });
  assert.equal(withdrawal.status, 201, JSON.stringify(withdrawal.body));
  assert.equal(await Withdrawal.countDocuments({ reseller: reseller.profile._id }), 1);

  const refused = [
    await me.post(`/api/reseller/orders/${pending._id}/confirm`).send({}),
    await me.put(`/api/reseller/catalog/${product._id}`).send({ sellPrice: 80 }),
    await me.post('/api/reseller/deposits').send({ amount: 100, method: 'bkash' }),
    await me.patch('/api/reseller/profile').send({ formActive: true }),
    await me.patch(`/api/reseller/orders/${pending._id}/customer`).send({ name: 'Someone Else' }),
  ];
  refused.forEach((res) => {
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'RESELLER_INACTIVE');
  });
});

test('reactivating restores the form flag as it was and does not un-cancel orders', async () => {
  const { owner, reseller, product } = await shop();
  const pending = await placeOrder(reseller.profile, product);
  const ownerApi = as(owner.user);

  await ownerApi.patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: false });
  const res = await ownerApi.patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.reseller.isActive, true);
  assert.equal(res.body.data.reseller.formActive, true);

  const profile = await ResellerProfile.findById(reseller.profile._id);
  assert.equal(profile.formActive, true);
  assert.equal(profile.formActiveBeforeDeactivation, null);
  assert.equal((await Order.findById(pending._id)).status, ORDER_STATUS.CANCELLED);

  const entry = await AuditLog.findOne({ action: 'reseller.reactivate' });
  assert.deepEqual(entry.before, { isActive: false, formActive: false });
  assert.deepEqual(entry.after, { isActive: true, formActive: true });

  // Writes are open again.
  const me = as(await User.findById(reseller.user._id));
  assert.equal((await me.put(`/api/reseller/catalog/${product._id}`).send({ sellPrice: 80 })).status, 200);
});

test('a shop the reseller had closed stays closed after reactivation', async () => {
  const { owner, reseller } = await shop({ formActive: false });
  const ownerApi = as(owner.user);
  await ownerApi.patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: false });
  await ownerApi.patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: true });
  assert.equal((await ResellerProfile.findById(reseller.profile._id)).formActive, false);
  // Repeating a reactivation writes no second entry.
  await ownerApi.patch(`/api/owner/resellers/${reseller.profile._id}`).send({ isActive: true });
  assert.equal(await AuditLog.countDocuments({ action: 'reseller.reactivate' }), 1);
});

/* ----------------------------------------------------------------------- kyc */

test('a second KYC submission is refused while one is pending', async () => {
  const reseller = await f.makeReseller({ kycStatus: KYC_STATUS.PENDING, formActive: false });
  await KycSubmission.create({
    reseller: reseller.profile._id,
    documents: [{ type: 'nid_front', storageKey: 'kyc/a.jpg' }],
    status: REVIEW_STATUS.PENDING,
  });

  const res = await as(reseller.user)
    .post('/api/reseller/kyc')
    .attach('nid_front', Buffer.from('fake image'), { filename: 'nid.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'KYC_ALREADY_PENDING');

  // And the database holds the line if two uploads race past the check.
  await assert.rejects(
    KycSubmission.create({
      reseller: reseller.profile._id,
      documents: [{ type: 'nid_front', storageKey: 'kyc/b.jpg' }],
      status: REVIEW_STATUS.PENDING,
    }),
    (err) => err.code === 11000
  );
});

/* ------------------------------------------------------------- customer edit */

test('the owner can correct customer details until the order is packed, not once shipped', async () => {
  const { owner, reseller, product } = await shop();
  const source = await f.makeSource();
  const order = await placeOrder(reseller.profile, product);
  const ownerApi = as(owner.user);

  const edited = await ownerApi
    .patch(`/api/owner/orders/${order._id}/customer`)
    .send({ address: '99 New Road, Mirpur' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.data.order.customer.address, '99 New Road, Mirpur');
  assert.deepEqual(edited.body.data.changed, ['address']);
  assert.equal(edited.body.data.deliveryZoneChanged, false);

  await confirm(order, reseller.profile, reseller.user);
  for (const action of ['accept', 'pack']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(order._id, action, owner.user, source);
    // eslint-disable-next-line no-await-in-loop
    const res = await ownerApi.patch(`/api/owner/orders/${order._id}/customer`).send({ name: `Name ${action}` });
    assert.equal(res.status, 200, `${action}: ${JSON.stringify(res.body)}`);
  }

  await walk(order._id, 'ship', owner.user, source);
  const locked = await ownerApi.patch(`/api/owner/orders/${order._id}/customer`).send({ name: 'Too Late' });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error.code, 'CUSTOMER_LOCKED');

  const stored = await Order.findById(order._id);
  assert.equal(stored.customer.name, 'Name pack');
  assert.equal(stored.statusHistory.filter((h) => h.event === 'customer_edited').length, 3);
  // The reseller hears about every edit the owner makes.
  assert.equal(
    await Notification.countDocuments({ user: reseller.user._id, eventType: EVENT_TYPE.ORDER_CUSTOMER_EDITED }),
    3
  );
});

test('a reseller edits their own order, not another reseller’s', async () => {
  const { owner, reseller, product } = await shop();
  const other = await f.makeReseller();
  await f.listProduct(other.profile, product, 70);
  const mine = await placeOrder(reseller.profile, product);
  const theirs = await placeOrder(other.profile, product);
  const me = as(reseller.user);

  const ok = await me.patch(`/api/reseller/orders/${mine._id}/customer`).send({ name: 'Corrected Name' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(await Notification.exists({ user: owner.user._id, eventType: EVENT_TYPE.ORDER_CUSTOMER_EDITED }));

  const refused = await me.patch(`/api/reseller/orders/${theirs._id}/customer`).send({ name: 'Hijack' });
  assert.equal(refused.status, 404);
  assert.equal((await Order.findById(theirs._id)).customer.name, 'Customer');

  const empty = await me.patch(`/api/reseller/orders/${mine._id}/customer`).send({});
  assert.equal(empty.status, 400);
});

test('a phone change moves the order between customer records and is audited', async () => {
  const { owner, reseller, product } = await shop();
  await f.makeZone({ name: 'Outside', districts: ['Rajshahi'], charge: 130 });
  const keep = await placeOrder(reseller.profile, product, { phone: '+8801912345678', name: 'Old Name' });
  const moved = await placeOrder(reseller.profile, product, { phone: '+8801912345678', name: 'Old Name' });

  const res = await as(owner.user)
    .patch(`/api/owner/orders/${moved._id}/customer`)
    .send({ phone: '01812345670', name: 'New Name', district: 'Rajshahi' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.order.customer.phoneE164, '+8801812345670');
  assert.equal(res.body.data.deliveryZoneChanged, true);
  assert.equal(res.body.data.suggestedZone.charge, 130);
  // The charge is left for the owner to decide.
  assert.equal(res.body.data.order.deliveryCharge, 80);

  const oldBuyer = await Customer.findOne({ phoneE164: '+8801912345678' });
  assert.equal(oldBuyer.orderCount, 1);
  const newBuyer = await Customer.findOne({ phoneE164: '+8801812345670' });
  assert.equal(newBuyer.orderCount, 1);
  assert.equal(newBuyer.names[0].value, 'New Name');
  assert.ok(keep);

  const entry = await AuditLog.findOne({ action: 'order.edit_customer', targetId: moved._id });
  assert.equal(entry.before.phoneE164, '+8801912345678');
  assert.equal(entry.after.phoneE164, '+8801812345670');
  assert.equal(entry.before.district, 'Dhaka');
  assert.equal(entry.after.deliveryZoneChanged, true);
  assert.equal(entry.before.address, undefined);
});

test('an edit to a district nobody delivers to is refused', async () => {
  const { owner, reseller, product } = await shop();
  const order = await placeOrder(reseller.profile, product);
  const res = await as(owner.user).patch(`/api/owner/orders/${order._id}/customer`).send({ district: 'Nowhere' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'NO_ZONE');
});

/* ------------------------------------------------------------ audit coverage */

test('reseller price changes, reseller cancels, toggles, settings and archives are audited', async () => {
  const { owner, reseller, product } = await shop();
  const me = as(reseller.user);
  const ownerApi = as(owner.user);

  // Reseller listing: a price change records only what moved.
  await me.put(`/api/reseller/catalog/${product._id}`).send({ sellPrice: 75 });
  const price = await AuditLog.findOne({ action: 'reseller.listing_update' });
  assert.deepEqual(price.before, { sellPricePoisha: toPoisha(70) });
  assert.equal(price.after.sellPricePoisha, toPoisha(75));
  assert.equal(String(price.actor), String(reseller.user._id));

  // Reseller cancel.
  const order = await placeOrder(reseller.profile, product);
  await me.post(`/api/reseller/orders/${order._id}/cancel`).send({ reason: 'Customer changed mind' });
  const cancel = await AuditLog.findOne({ action: 'order.cancel', targetId: order._id });
  assert.equal(cancel.after.reason, 'Customer changed mind');
  assert.equal(cancel.after.role, ROLES.RESELLER);

  // SMS toggle on the reseller.
  await ownerApi.patch(`/api/owner/resellers/${reseller.profile._id}`).send({ smsEnabled: true });
  const sms = await AuditLog.findOne({ action: 'reseller.sms_enabled' });
  assert.deepEqual(sms.before, { smsEnabled: false });
  assert.deepEqual(sms.after, { smsEnabled: true });

  // Settings: only the keys that changed.
  await ownerApi.patch('/api/owner/settings').send({ orderAgingHours: 12 });
  await ownerApi.patch('/api/owner/settings').send({ orderAgingHours: 12, businessName: 'Chapai Mango' });
  const settings = await AuditLog.find({ action: 'settings.update' }).sort({ createdAt: 1 });
  assert.equal(settings.length, 2);
  assert.deepEqual(Object.keys(settings[0].after), ['orderAgingHours']);
  assert.equal(settings[0].after.orderAgingHours, 12);
  assert.deepEqual(Object.keys(settings[1].after), ['businessName']);

  // Archives.
  const source = await f.makeSource();
  const spare = await f.makeProduct({ name: 'ফজলি' });
  const zone = await f.makeZone({ name: 'Unused', districts: ['Sylhet'], charge: 150 });
  await ownerApi.delete(`/api/owner/sources/${source._id}`);
  await ownerApi.delete(`/api/owner/products/${spare._id}`);
  await ownerApi.delete(`/api/owner/delivery-zones/${zone._id}`);
  assert.ok(await AuditLog.exists({ action: 'source.archive', targetId: source._id }));
  assert.ok(await AuditLog.exists({ action: 'product.archive', targetId: spare._id }));
  const zoneEntry = await AuditLog.findOne({ action: 'zone.delete', targetId: zone._id });
  assert.equal(zoneEntry.before.name, 'Unused');

  // Archiving twice is one entry.
  await ownerApi.delete(`/api/owner/sources/${source._id}`);
  assert.equal(await AuditLog.countDocuments({ action: 'source.archive' }), 1);
});

/* ---------------------------------------------------------------- audit api */

test('the audit log filters by actor, target, action and Dhaka date, and pages by cursor', async () => {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller();
  const targetA = reseller.profile._id;

  // Two entries a Dhaka day apart, around Dhaka midnight: 2026-09-01 23:30
  // and 2026-09-02 00:30 Dhaka are 17:30 and 18:30 UTC on 1 September.
  await AuditLog.collection.insertMany([
    {
      actor: owner.user._id,
      action: 'reseller.credit_limit',
      targetType: 'ResellerProfile',
      targetId: targetA,
      createdAt: new Date('2026-09-01T17:30:00Z'),
    },
    {
      actor: reseller.user._id,
      action: 'order.cancel',
      targetType: 'Order',
      createdAt: new Date('2026-09-01T18:30:00Z'),
    },
  ]);
  // Five more in the same millisecond, which only (createdAt, _id) can page through.
  const same = new Date('2026-09-03T06:00:00Z');
  await AuditLog.collection.insertMany(
    Array.from({ length: 5 }, (_, i) => ({
      actor: owner.user._id,
      action: 'settings.update',
      targetType: 'Setting',
      after: { i },
      createdAt: same,
    }))
  );

  const ownerApi = as(owner.user);

  const seen = new Set();
  let cursor = null;
  let pages = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await ownerApi.get(`/api/owner/audit?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    res.body.data.entries.forEach((e) => {
      assert.equal(seen.has(e.id), false, 'an entry appeared on two pages');
      seen.add(e.id);
    });
    cursor = res.body.data.nextCursor;
    pages += 1;
  } while (cursor);
  assert.equal(seen.size, 7);
  assert.equal(pages, 3);

  const first = await ownerApi.get('/api/owner/audit?limit=1');
  assert.equal(first.body.data.entries[0].action, 'settings.update');
  assert.deepEqual(first.body.data.entries[0].actor, {
    id: String(owner.user._id),
    name: 'Owner',
    role: ROLES.OWNER,
  });

  const byActor = await ownerApi.get(`/api/owner/audit?actor=${reseller.user._id}`);
  assert.deepEqual(byActor.body.data.entries.map((e) => e.action), ['order.cancel']);

  const byTarget = await ownerApi.get(`/api/owner/audit?targetType=ResellerProfile&targetId=${targetA}`);
  assert.deepEqual(byTarget.body.data.entries.map((e) => e.action), ['reseller.credit_limit']);

  const byPrefix = await ownerApi.get('/api/owner/audit?action=settings.*');
  assert.equal(byPrefix.body.data.entries.length, 5);

  const day1 = await ownerApi.get('/api/owner/audit?from=2026-09-01&to=2026-09-01');
  assert.deepEqual(day1.body.data.entries.map((e) => e.action), ['reseller.credit_limit']);
  const day2 = await ownerApi.get('/api/owner/audit?from=2026-09-02&to=2026-09-02');
  assert.deepEqual(day2.body.data.entries.map((e) => e.action), ['order.cancel']);

  assert.equal((await ownerApi.get('/api/owner/audit?cursor=garbage')).status, 400);
  assert.equal((await ownerApi.get('/api/owner/audit?from=01-09-2026')).status, 400);
  assert.equal((await as(reseller.user).get('/api/owner/audit')).status, 403);

  // The service writes entries the API reads back.
  await audit.record({ actor: owner.user._id, action: 'test.entry', targetType: 'Test' });
  const latest = await ownerApi.get('/api/owner/audit?action=test.entry');
  assert.equal(latest.body.data.entries.length, 1);
});
