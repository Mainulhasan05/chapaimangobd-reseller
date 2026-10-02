'use strict';

/*
 * PLAN-4 §4.1, what the owner oversees rather than works through: the inbox and
 * the four new "waiting on you" events, the dashboard's new figures, failed
 * deliveries, trusted devices and the audit log's names for things.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const env = require('../src/config/env');
const storage = require('../src/config/storage');
const tokens = require('../src/services/tokens');
const orderService = require('../src/services/orderService');
const ledger = require('../src/services/ledger');
const audit = require('../src/services/audit');
const smsHealth = require('../src/services/smsHealth');
const { withTransaction } = require('../src/services/tx');

const Order = require('../src/models/Order');
const User = require('../src/models/User');
const ResellerProfile = require('../src/models/ResellerProfile');
const Notification = require('../src/models/Notification');
const OutboxMessage = require('../src/models/OutboxMessage');
const TrustedDevice = require('../src/models/TrustedDevice');
const AuditLog = require('../src/models/AuditLog');

const { toPoisha } = require('../src/utils/money');
const { businessDate, startOfBusinessDay } = require('../src/utils/dhakaTime');
const { urlFor } = require('../src/domain/notificationLinks');
const { textFor } = require('../src/domain/notificationText');
const { eventsFor } = require('../src/domain/notificationPrefs');
const {
  ROLES,
  PAYMENT_MODE,
  LEDGER_KIND,
  EVENT_TYPE,
  KYC_STATUS,
} = require('../src/domain/constants');

const { OUTBOX_STATUS, CHANNEL_STATUS, OUTBOX_KIND } = OutboxMessage;

test.before(startDb);
test.after(stopDb);
test.beforeEach(async () => {
  await resetDb();
  smsHealth.clearCache();
});

function as(user, { cookie } = {}) {
  const auth = `Bearer ${tokens.signAccessToken(user)}`;
  const wrap = (method) => (url) => {
    const req = request(app)[method](url).set('Authorization', auth);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
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

const ownerInbox = (owner) => Notification.find({ user: owner.user._id }).sort({ createdAt: 1 });

/* ------------------------------------------------------- owner events */

test('a deposit and a withdrawal request each tell the owner, linked to the pending queue', async () => {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: reseller.profile._id }, { $set: { shopName: 'Rahim Store' } });
  await credit(reseller.profile, 2000);
  const shop = as(reseller.user);

  const deposit = await shop.post('/api/reseller/deposits').send({ amount: 1500, method: 'bkash' });
  assert.equal(deposit.status, 201, JSON.stringify(deposit.body));
  const withdrawal = await shop
    .post('/api/reseller/withdrawals')
    .send({ amount: 500, method: 'nagad', destinationNumber: '01712345678' });
  assert.equal(withdrawal.status, 201, JSON.stringify(withdrawal.body));

  const [d, w] = await ownerInbox(owner);
  assert.equal(d.eventType, EVENT_TYPE.DEPOSIT_REQUESTED);
  assert.equal(d.title, 'নতুন জমার অনুরোধ');
  assert.equal(d.body, 'Rahim Store · 1500 টাকা');
  assert.equal(d.data.url, '/owner/finance?tab=deposits&status=pending');
  assert.equal(String(d.data.depositId), String(deposit.body.data.deposit.id));

  assert.equal(w.eventType, EVENT_TYPE.WITHDRAWAL_REQUESTED);
  assert.equal(w.title, 'নতুন উত্তোলনের আবেদন');
  assert.equal(w.body, 'Rahim Store · 500 টাকা');
  assert.equal(w.data.url, '/owner/finance?tab=withdrawals&status=pending');

  // The reseller's own inbox gets nothing for asking.
  assert.equal(await Notification.countDocuments({ user: reseller.user._id }), 0);
});

test('a KYC submission tells the owner, linked to the pending KYC queue', async () => {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller({ kycRequired: true, kycStatus: KYC_STATUS.NOT_SUBMITTED });

  const real = storage.uploadBuffer;
  storage.uploadBuffer = async (buffer, { contentType }) => ({
    key: `kyc/${crypto.randomUUID()}.jpg`,
    size: buffer.length,
    contentType,
  });
  try {
    const res = await as(reseller.user)
      .post('/api/reseller/kyc')
      .attach('nid_front', Buffer.from('fake image'), { filename: 'nid.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  } finally {
    storage.uploadBuffer = real;
  }

  const [n] = await ownerInbox(owner);
  assert.equal(n.eventType, EVENT_TYPE.KYC_SUBMITTED);
  assert.equal(n.title, 'নতুন কেওয়াইসি জমা পড়েছে');
  assert.equal(n.body, 'Test Shop · যাচাইয়ের অপেক্ষায়');
  assert.equal(n.data.url, '/owner/kyc?status=pending');
});

test('a complaint tells every other owner account, not the one who wrote it', async () => {
  const writer = await f.makeOwner();
  const other = await f.makeOwner();
  const reseller = await f.makeReseller({ creditLimit: 100000 });
  const product = await f.makeProduct({ cost: 50 });
  await f.listProduct(reseller.profile, product, 70);
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const { order } = await orderService.createPendingOrder({
    resellerProfile: reseller.profile,
    paymentMode: PAYMENT_MODE.COD,
    submissionId: crypto.randomUUID(),
    customer: { name: 'Customer', phoneE164: '+8801912345678', address: '12 Road', district: 'Dhaka' },
    items: [{ product: product._id, variant: product.variants[0]._id, qty: 1 }],
  });
  await orderService.confirmOrder({ orderId: order._id, resellerProfile: reseller.profile, actorUser: reseller.user });

  const res = await as(writer.user)
    .post(`/api/owner/orders/${order._id}/complaints`)
    .send({ kind: 'damaged', note: 'Crushed in transit' });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const mine = await Notification.find({ user: writer.user._id, eventType: EVENT_TYPE.COMPLAINT_CREATED });
  assert.equal(mine.length, 0, 'nobody is told what they just typed');
  const [n] = await Notification.find({ user: other.user._id, eventType: EVENT_TYPE.COMPLAINT_CREATED });
  assert.equal(n.title, 'নতুন অভিযোগ');
  assert.equal(n.body, `${order.orderCode} · পচা / নষ্ট`);
  // The complaints list, not the order, even though the event is about an order.
  assert.equal(n.data.url, '/owner/complaints');
});

test('the four owner events have text, links and default preferences', async () => {
  const fresh = [
    EVENT_TYPE.DEPOSIT_REQUESTED,
    EVENT_TYPE.WITHDRAWAL_REQUESTED,
    EVENT_TYPE.KYC_SUBMITTED,
    EVENT_TYPE.COMPLAINT_CREATED,
  ];
  const ownerEvents = eventsFor(ROLES.OWNER);
  fresh.forEach((eventType) => {
    assert.ok(ownerEvents.includes(eventType), `${eventType} is tunable by the owner`);
    assert.notEqual(textFor(eventType, {}).title, eventType, `${eventType} has Bengali text`);
  });
  assert.equal(
    urlFor(ROLES.OWNER, EVENT_TYPE.COMPLAINT_CREATED, { orderId: '66f1a1a1a1a1a1a1a1a1a1a1' }),
    '/owner/complaints'
  );

  const owner = await f.makeOwner();
  const prefs = await as(owner.user).get('/api/owner/notification-preferences');
  assert.equal(prefs.status, 200);
  const rows = prefs.body.data.groups.flatMap((g) => g.events);
  fresh.forEach((eventType) => {
    const row = rows.find((r) => r.eventType === eventType);
    assert.deepEqual([row.push, row.telegram, row.sms], [true, true, false], eventType);
  });
  assert.deepEqual(
    prefs.body.data.groups.map((g) => g.key),
    ['orders', 'wallet', 'kyc', 'alerts']
  );
});

/* ------------------------------------------------------ per-item read */

test('one notification is marked read for its owner only, and the unread count comes back', async () => {
  const owner = await f.makeOwner();
  const stranger = await f.makeOwner();
  const [a, b] = await Notification.create([
    { user: owner.user._id, eventType: EVENT_TYPE.ORDER_CONFIRMED, title: 'A' },
    { user: owner.user._id, eventType: EVENT_TYPE.ORDER_CONFIRMED, title: 'B' },
  ]);
  const api = as(owner.user);

  const res = await api.post(`/api/owner/notifications/${a._id}/read`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(String(res.body.data.notification._id), String(a._id));
  assert.ok(res.body.data.notification.readAt);
  assert.equal(res.body.data.unread, 1);
  assert.equal((await Notification.findById(b._id)).readAt, null, 'only the one tapped');

  // Reading it again keeps the first time it was read.
  const firstRead = (await Notification.findById(a._id)).readAt.getTime();
  await api.post(`/api/owner/notifications/${a._id}/read`).expect(200);
  assert.equal((await Notification.findById(a._id)).readAt.getTime(), firstRead);

  assert.equal((await as(stranger.user).post(`/api/owner/notifications/${b._id}/read`)).status, 404);
  assert.equal((await api.post('/api/owner/notifications/not-an-id/read')).status, 404);
});

test('a reseller marks one read too, even while deactivated', async () => {
  const reseller = await f.makeReseller();
  const n = await Notification.create({ user: reseller.user._id, eventType: EVENT_TYPE.ORDER_ACCEPTED, title: 'X' });
  await User.updateOne({ _id: reseller.user._id }, { $set: { isActive: false } });
  const api = as(reseller.user);

  const res = await api.post(`/api/reseller/notifications/${n._id}/read`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.unread, 0);

  // Every other write is still refused.
  const refused = await api.patch('/api/reseller/profile').send({ shopName: 'New Name' });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, 'RESELLER_INACTIVE');
});

/* ----------------------------------------------------------- dashboard */

test('the dashboard names the debtors and compares today with yesterday at this hour', async () => {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller({ creditLimit: 100000 });
  const product = await f.makeProduct({ cost: 50 });
  await f.listProduct(reseller.profile, product, 70);
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const source = await f.makeSource();
  // The shop placing today's orders stays in credit, so it is no debtor.
  await credit(reseller.profile, 5000);

  // Six shops in debt; the five deepest are named, deepest first.
  const owing = [100, 600, 300, 50, 500, 200];
  for (const [i, taka] of owing.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const r = await f.makeReseller();
    // eslint-disable-next-line no-await-in-loop
    await ResellerProfile.updateOne(
      { _id: r.profile._id },
      { $set: { shopName: `Shop ${i}`, balancePoisha: -toPoisha(taka) } }
    );
  }

  const place = async () => {
    const { order } = await orderService.createPendingOrder({
      resellerProfile: reseller.profile,
      paymentMode: PAYMENT_MODE.COD,
      submissionId: crypto.randomUUID(),
      customer: { name: 'C', phoneE164: '+8801912345678', address: '12 Road', district: 'Dhaka' },
      items: [{ product: product._id, variant: product.variants[0]._id, qty: 1 }],
    });
    const profile = await ResellerProfile.findById(reseller.profile._id);
    return orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: reseller.user });
  };

  // Delivered today, though placed days ago.
  const old = await place();
  for (const action of ['accept', 'pack', 'ship', 'deliver']) {
    const payload = { courierName: 'Sundarban' };
    // eslint-disable-next-line no-await-in-loop
    if (action === 'accept') payload.sources = f.sourcesFor(await Order.findById(old._id), source);
    // eslint-disable-next-line no-await-in-loop
    await orderService.transitionOrder({ orderId: old._id, action, actorUser: owner.user, role: ROLES.OWNER, payload });
  }
  await Order.collection.updateOne({ _id: old._id }, { $set: { businessDate: '2026-01-01' } });

  // Yesterday: one placed before this time of day, one after, one never confirmed.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterday = businessDate(dayAgo);
  const early = await place();
  const late = await place();
  const { order: pending } = await orderService.createPendingOrder({
    resellerProfile: reseller.profile,
    paymentMode: PAYMENT_MODE.COD,
    submissionId: crypto.randomUUID(),
    customer: { name: 'C', phoneE164: '+8801912345678', address: '12 Road', district: 'Dhaka' },
    items: [{ product: product._id, variant: product.variants[0]._id, qty: 1 }],
  });
  const earlyAt = new Date(startOfBusinessDay(yesterday).getTime() + 60 * 1000);
  await Order.collection.updateOne({ _id: early._id }, { $set: { businessDate: yesterday, createdAt: earlyAt } });
  await Order.collection.updateOne(
    { _id: late._id },
    { $set: { businessDate: yesterday, createdAt: new Date(dayAgo.getTime() + 10 * 60 * 1000) } }
  );
  await Order.collection.updateOne({ _id: pending._id }, { $set: { businessDate: yesterday, createdAt: earlyAt } });

  const res = await as(owner.user).get('/api/owner/reports/dashboard');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const data = res.body.data;

  assert.deepEqual(
    data.debtors.map((d) => [d.shopName, d.owed]),
    [
      ['Shop 1', 600],
      ['Shop 4', 500],
      ['Shop 2', 300],
      ['Shop 5', 200],
      ['Shop 0', 100],
    ]
  );
  assert.ok(data.debtors.every((d) => d.id));
  assert.equal(data.ordersYesterdaySameTime, 1);
  assert.equal(data.deliveredToday, 1);
  assert.equal(data.closedToday.delivered, 0, 'placed today and delivered is a different count');
  assert.equal(data.health.smsGateway, 'not_configured');
  assert.equal(data.health.smsBalance, null);
});

test('the dashboard asks the SMS gateway rather than reading the master switch', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const realFetch = global.fetch;
  const saved = { key: env.smsApiKey, sender: env.smsSenderId, configured: env.smsConfigured };
  let reply = { response: '150' };
  let calls = 0;

  env.smsApiKey = 'test-api-key';
  env.smsSenderId = 'TESTSENDER';
  env.smsConfigured = true;
  global.fetch = async () => {
    calls += 1;
    if (reply instanceof Error) throw reply;
    return { ok: true, status: 200, json: async () => reply };
  };

  try {
    let health = (await api.get('/api/owner/reports/dashboard')).body.data.health;
    assert.equal(health.smsGateway, 'ok');
    assert.equal(health.smsBalance, 150);
    assert.equal(health.smsBalanceLow, true, 'below the digest threshold');
    // The master switch is off, which is a choice and not a fault.
    assert.equal(health.smsEnabled, false);

    // Cached: a dashboard polled every minute does not poll the gateway with it.
    await api.get('/api/owner/reports/dashboard');
    assert.equal(calls, 1);

    smsHealth.clearCache();
    reply = new Error('gateway down');
    health = (await api.get('/api/owner/reports/dashboard')).body.data.health;
    assert.equal(health.smsGateway, 'error');
    assert.equal(health.smsBalance, null);
  } finally {
    global.fetch = realFetch;
    env.smsApiKey = saved.key;
    env.smsSenderId = saved.sender;
    env.smsConfigured = saved.configured;
  }
});

/* ---------------------------------------------------- failed deliveries */

async function deadMessage(user, overrides = {}) {
  return OutboxMessage.create({
    user: user._id,
    eventType: EVENT_TYPE.ORDER_CONFIRMED,
    channels: [
      { name: 'web_push', status: CHANNEL_STATUS.SENT, attempts: 1 },
      { name: 'telegram', status: CHANNEL_STATUS.FAILED, attempts: 5, lastError: 'chat not found' },
    ],
    payload: { title: 'অর্ডার নিশ্চিত হয়েছে', body: 'ABC123', data: { url: '/owner/orders/x' } },
    status: OUTBOX_STATUS.DEAD,
    attempts: 5,
    deadAt: new Date(),
    lastError: 'telegram: chat not found',
    ...overrides,
  });
}

test('failed deliveries are listed, retried once without resending what arrived, and dismissed', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const first = await deadMessage(owner.user, { deadAt: new Date('2026-09-01T00:00:00Z') });
  const second = await deadMessage(owner.user);
  const customer = await OutboxMessage.create({
    kind: OUTBOX_KIND.CUSTOMER_SMS,
    eventType: EVENT_TYPE.ORDER_SHIPPED,
    channels: [{ name: 'sms', status: CHANNEL_STATUS.FAILED, attempts: 5, lastError: 'no balance' }],
    payload: { phoneE164: '+8801912345678', text: 'Your order has shipped' },
    status: OUTBOX_STATUS.DEAD,
    attempts: 5,
    deadAt: new Date('2026-08-01T00:00:00Z'),
  });
  await OutboxMessage.create({ user: owner.user._id, eventType: EVENT_TYPE.ORDER_CONFIRMED, channels: ['telegram'] });

  const list = await api.get('/api/owner/outbox/failed?limit=2');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.total, 3);
  assert.deepEqual(list.body.data.messages.map((m) => String(m.id)), [String(second._id), String(first._id)]);
  const row = list.body.data.messages[0];
  assert.equal(row.recipient.type, 'owner');
  assert.equal(row.title, 'অর্ডার নিশ্চিত হয়েছে');
  assert.deepEqual(row.channels.map((c) => [c.name, c.status]), [['web_push', 'sent'], ['telegram', 'failed']]);
  const page2 = await api.get('/api/owner/outbox/failed?limit=2&page=2');
  const sms = page2.body.data.messages[0];
  assert.deepEqual(sms.recipient, { type: 'customer', id: null, name: null, phone: '+8801912345678' });
  assert.equal(sms.body, 'Your order has shipped');
  assert.equal(String(sms.id), String(customer._id));

  const retried = await api.post(`/api/owner/outbox/${second._id}/retry`);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  const stored = await OutboxMessage.findById(second._id);
  assert.equal(stored.status, OUTBOX_STATUS.PENDING);
  assert.equal(stored.attempts, 0);
  assert.equal(stored.deadAt, null);
  assert.deepEqual(
    stored.channels.map((c) => [c.name, c.status, c.attempts]),
    [['web_push', 'sent', 1], ['telegram', 'pending', 0]]
  );
  const again = await api.post(`/api/owner/outbox/${second._id}/retry`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'NOT_FAILED');

  const dismissed = await api.post(`/api/owner/outbox/${first._id}/dismiss`);
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.data.message.status, OUTBOX_STATUS.DISMISSED);
  assert.equal(String((await OutboxMessage.findById(first._id)).dismissedBy), String(owner.user._id));
  assert.equal((await api.post(`/api/owner/outbox/${first._id}/retry`)).status, 409);

  // Neither counts as a fault any more.
  const dashboard = await api.get('/api/owner/reports/dashboard');
  assert.equal(dashboard.body.data.health.deadLetters, 1);
  assert.equal((await api.get('/api/owner/outbox/failed')).body.data.total, 1);

  assert.ok(await AuditLog.exists({ action: 'outbox.retry', targetId: second._id }));
  assert.ok(await AuditLog.exists({ action: 'outbox.dismiss', targetId: first._id }));
  assert.equal((await api.post(`/api/owner/outbox/${owner.user._id}/dismiss`)).status, 404);
});

/* ------------------------------------------------------ trusted devices */

test('the owner lists trusted devices, sees which is this browser, and revokes one', async () => {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller();
  const raw = crypto.randomBytes(32).toString('base64url');
  const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const here = await TrustedDevice.create({
    user: owner.user._id,
    tokenHash: tokens.hashToken(raw),
    userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    lastUsedAt: new Date(),
    expiresAt: inThirtyDays,
  });
  const laptop = await TrustedDevice.create({
    user: owner.user._id,
    tokenHash: tokens.hashToken('another'),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/121.0',
    lastUsedAt: new Date(Date.now() - 60 * 60 * 1000),
    expiresAt: inThirtyDays,
  });
  await TrustedDevice.create({
    user: owner.user._id,
    tokenHash: tokens.hashToken('expired'),
    expiresAt: new Date(Date.now() - 1000),
  });

  const api = as(owner.user, { cookie: `${tokens.DEVICE_COOKIE}=${raw}` });
  const res = await api.get('/api/auth/devices');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.data.devices.map((d) => [String(d.id), d.label, d.current]),
    [
      [String(here._id), 'Chrome · Android', true],
      [String(laptop._id), 'Firefox · Windows', false],
    ]
  );
  assert.ok(res.body.data.devices[0].lastUsedAt && res.body.data.devices[0].createdAt);

  const revoked = await api.delete(`/api/auth/devices/${laptop._id}`);
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body.data, { revoked: true, current: false });
  assert.equal(await TrustedDevice.exists({ _id: laptop._id }), null);
  assert.ok(await AuditLog.exists({ action: 'device.revoke', targetId: laptop._id }));

  // Revoking this browser also clears its cookie.
  const self = await api.delete(`/api/auth/devices/${here._id}`);
  assert.equal(self.body.data.current, true);
  assert.ok(String(self.headers['set-cookie']).includes(`${tokens.DEVICE_COOKIE}=;`));

  assert.equal((await api.delete(`/api/auth/devices/${laptop._id}`)).status, 404);
  assert.equal((await as(reseller.user).get('/api/auth/devices')).status, 403);
});

/* ---------------------------------------------------------------- audit */

test('audit entries carry a label for their target, and actor=system finds the unclicked ones', async () => {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: reseller.profile._id }, { $set: { shopName: 'Rahim Store' } });
  const product = await f.makeProduct({ name: 'হিমসাগর' });
  const zone = await f.makeZone({ name: 'Sylhet Zone', districts: ['Sylhet'] });
  const api = as(owner.user);

  await api.patch(`/api/owner/resellers/${reseller.profile._id}`).send({ creditLimit: 500 }).expect(200);
  await api.delete(`/api/owner/products/${product._id}`).expect(200);
  await api.delete(`/api/owner/delivery-zones/${zone._id}`).expect(200);
  const deposit = await as(reseller.user).post('/api/reseller/deposits').send({ amount: 100, method: 'bkash' });
  await api.post(`/api/owner/deposits/${deposit.body.data.deposit.id}/approve`).send({}).expect(200);
  await audit.record({ action: 'order.cancel', targetType: 'Order', targetId: reseller.profile._id, after: {} });

  const res = await api.get('/api/owner/audit');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const byAction = Object.fromEntries(res.body.data.entries.map((e) => [e.action, e]));
  assert.equal(byAction['product.archive'].targetLabel, 'হিমসাগর');
  assert.equal(byAction['zone.delete'].targetLabel, 'Sylhet Zone', 'from the entry when the zone is gone');
  const resellerEntry = res.body.data.entries.find((e) => e.targetType === 'ResellerProfile');
  assert.equal(resellerEntry.targetLabel, 'Rahim Store');
  const depositEntry = res.body.data.entries.find((e) => e.targetType === 'Deposit');
  assert.equal(depositEntry.targetLabel, 'Rahim Store');
  assert.equal(byAction['order.cancel'].targetLabel, null, 'nothing to name it by');

  const system = await api.get('/api/owner/audit?actor=system');
  assert.equal(system.status, 200, JSON.stringify(system.body));
  assert.deepEqual(system.body.data.entries.map((e) => e.action), ['order.cancel']);
  assert.equal(system.body.data.entries[0].actor, null);
  assert.equal((await api.get('/api/owner/audit?actor=robot')).status, 400);

  // An order is named by its code.
  const fruit = await f.makeProduct({ name: 'ফজলি' });
  await f.listProduct(reseller.profile, fruit, 70);
  await f.makeZone({ districts: ['Dhaka'] });
  const { order } = await orderService.createPendingOrder({
    resellerProfile: reseller.profile,
    paymentMode: PAYMENT_MODE.COD,
    submissionId: crypto.randomUUID(),
    customer: { name: 'C', phoneE164: '+8801912345678', address: '12 Road', district: 'Dhaka' },
    items: [{ product: fruit._id, variant: fruit.variants[0]._id, qty: 1 }],
  });
  await audit.record({ actor: owner.user._id, action: 'order.note', targetType: 'Order', targetId: order._id });
  const one = await api.get(`/api/owner/audit?targetId=${order._id}`);
  assert.equal(one.body.data.entries[0].targetLabel, order.orderCode);
});
