'use strict';

/*
 * PLAN-4 §4.2, items 2 and 3: what the owner's finance queue and reseller screens
 * are handed. The money rules behind a deposit or a withdrawal are api.test.js's
 * and the deactivation itself is lifecycle.test.js's; this file is about whether
 * the rows carry enough to decide on, and whether the reseller list finds people
 * the way the owner looks for them.
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
const { withTransaction } = require('../src/services/tx');

const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Deposit = require('../src/models/Deposit');
const Withdrawal = require('../src/models/Withdrawal');
const ResellerProfile = require('../src/models/ResellerProfile');
const LedgerEntry = require('../src/models/LedgerEntry');
const AuditLog = require('../src/models/AuditLog');

const { toPoisha } = require('../src/utils/money');
const { LEDGER_KIND, PAYMENT_MODE, ROLES, ORDER_STATUS } = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

function as(user) {
  const auth = `Bearer ${tokens.signAccessToken(user)}`;
  const wrap = (method) => (url) => request(app)[method](url).set('Authorization', auth);
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch') };
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

async function placeOrder(profile, product, qty = 1) {
  const { order } = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode: PAYMENT_MODE.PREPAID,
    submissionId: crypto.randomUUID(),
    customer: { name: 'Customer', phoneE164: '+8801912345678', address: '12 Road', district: 'Dhaka' },
    items: [{ product: product._id, variant: product.variants[0]._id, qty }],
  });
  return order;
}

/* ------------------------------------------------------------------ finance */

test('a decided deposit row says who decided, when, why, and where the wallet stands', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const { profile } = await f.makeReseller();
  await credit(profile, 300);

  const approved = await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(1000),
    method: 'bkash',
    transactionId: 'TRX-A',
    note: 'from the shop counter',
  });
  const rejected = await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(500),
    method: 'nagad',
    transactionId: 'TRX-B',
  });

  await api.post(`/api/owner/deposits/${approved._id}/approve`).send({}).expect(200);
  await api
    .post(`/api/owner/deposits/${rejected._id}/reject`)
    .send({ reason: 'No such transaction' })
    .expect(200);

  const list = (await api.get('/api/owner/deposits?status=approved').expect(200)).body.data;
  assert.equal(list.total, 1);
  const row = list.deposits[0];
  assert.equal(row.note, 'from the shop counter');
  assert.equal(row.method, 'bkash');
  assert.equal(row.reason, null);
  assert.ok(row.reviewedAt);
  assert.deepEqual(row.reviewedBy, { id: String(owner.user._id), name: 'Owner' });
  // The balance now, after the approval credited it: 300 + 1000.
  assert.equal(row.balance, 1300);
  // The reseller is presented, with an id to link to, not a raw document.
  assert.equal(row.reseller.id, String(profile._id));
  assert.equal(row.reseller.shopName, 'Test Shop');
  assert.ok(row.reseller.user.phoneE164);
  assert.ok(!('balancePoisha' in row.reseller), 'no raw poisha in the response');

  const no = (await api.get('/api/owner/deposits?status=rejected').expect(200)).body.data;
  assert.equal(no.deposits[0].reason, 'No such transaction');
  assert.equal(no.deposits[0].reviewedBy.name, 'Owner');

  const waiting = await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(200),
    method: 'rocket',
    transactionId: 'TRX-C',
  });
  const pending = (await api.get('/api/owner/deposits?status=pending').expect(200)).body.data;
  assert.equal(pending.deposits.length, 1);
  assert.equal(pending.deposits[0].id, String(waiting._id));
  assert.equal(pending.deposits[0].reviewedAt, null);
  assert.equal(pending.deposits[0].reviewedBy, null);
});

test('a withdrawal row carries the payout reference and the balance it is weighed against', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const { profile } = await f.makeReseller();
  await credit(profile, 2000);

  const paid = await Withdrawal.create({
    reseller: profile._id,
    amountPoisha: toPoisha(500),
    method: 'bkash',
    destinationNumber: '+8801712345678',
    note: 'for the van',
  });
  await api
    .post(`/api/owner/withdrawals/${paid._id}/approve`)
    .send({ payoutReference: 'BKASH-9XK2' })
    .expect(200);

  await Withdrawal.create({
    reseller: profile._id,
    amountPoisha: toPoisha(5000),
    method: 'nagad',
    destinationNumber: '+8801712345678',
  });

  const done = (await api.get('/api/owner/withdrawals?status=approved').expect(200)).body.data;
  const row = done.withdrawals[0];
  assert.equal(row.payoutReference, 'BKASH-9XK2');
  assert.equal(row.note, 'for the van');
  assert.equal(row.method, 'bkash');
  assert.equal(row.reviewedBy.name, 'Owner');
  assert.equal(row.balance, 1500);

  // A request bigger than the balance: the row says so before the owner taps.
  const queue = (await api.get('/api/owner/withdrawals?status=pending').expect(200)).body.data;
  assert.equal(queue.withdrawals[0].amount, 5000);
  assert.equal(queue.withdrawals[0].balance, 1500);
  assert.equal(queue.withdrawals[0].payoutReference, null);
});

test('the finance lists refuse an unknown status and narrow to one reseller', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const a = await f.makeReseller();
  const b = await f.makeReseller();
  await Deposit.create({ reseller: a.profile._id, amountPoisha: 100, method: 'bkash', transactionId: 'A1' });
  await Deposit.create({ reseller: b.profile._id, amountPoisha: 100, method: 'bkash', transactionId: 'B1' });

  // A typo used to answer an empty list, which reads as "nothing waiting".
  const typo = await api.get('/api/owner/deposits?status=pendng');
  assert.equal(typo.status, 400);
  assert.equal(typo.body.error.code, 'VALIDATION_FAILED');

  const blank = await api.get('/api/owner/deposits?status=').expect(200);
  assert.equal(blank.body.data.total, 2, 'an empty select is no filter');

  const one = await api.get(`/api/owner/deposits?resellerId=${a.profile._id}`).expect(200);
  assert.equal(one.body.data.total, 1);
  assert.equal(one.body.data.deposits[0].reseller.id, String(a.profile._id));

  const none = await api.get(`/api/owner/withdrawals?resellerId=${b.profile._id}`).expect(200);
  assert.equal(none.body.data.total, 0);
});

/* ---------------------------------------------------------------- resellers */

test('the reseller list is searched on the server by shop, person and phone', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);

  const mango = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: mango.profile._id }, { shopName: 'Rajshahi Mango House' });
  const karim = await f.makeReseller();
  await User.updateOne({ _id: karim.user._id }, { name: 'Abdul Karim' });
  const other = await f.makeReseller();

  const byShop = (await api.get('/api/owner/resellers?q=mango').expect(200)).body.data;
  assert.deepEqual(byShop.resellers.map((r) => r.id), [String(mango.profile._id)]);

  const byName = (await api.get('/api/owner/resellers?q=karim').expect(200)).body.data;
  assert.deepEqual(byName.resellers.map((r) => r.id), [String(karim.profile._id)]);

  // The tail of the login phone, as the owner reads it off a call log...
  const tail = other.user.phoneE164.slice(-6);
  const byPhone = (await api.get(`/api/owner/resellers?q=${tail}`).expect(200)).body.data;
  assert.deepEqual(byPhone.resellers.map((r) => r.id), [String(other.profile._id)]);

  // ...and typed on a Bangla keyboard.
  const bn = tail.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
  const byBn = (await api.get(`/api/owner/resellers?q=${encodeURIComponent(bn)}`).expect(200))
    .body.data;
  assert.deepEqual(byBn.resellers.map((r) => r.id), [String(other.profile._id)]);

  // A pattern character is a character, not a regular expression.
  const odd = await api.get('/api/owner/resellers?q=(.*');
  assert.equal(odd.status, 200);
  assert.equal(odd.body.data.resellers.length, 0);

  // Search pages by cursor like the plain list.
  const paged = (await api.get('/api/owner/resellers?q=a&limit=1').expect(200)).body.data;
  assert.equal(paged.resellers.length, 1);
});

test('the reseller list sorts by balance both ways and by name, whole', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);

  const rich = await f.makeReseller();
  await credit(rich.profile, 900);
  const owing = await f.makeReseller({ creditLimit: 1000 });
  await withTransaction((session) =>
    ledger.postEntry(session, {
      reseller: owing.profile._id,
      kind: LEDGER_KIND.MANUAL_DEBIT,
      amountPoisha: toPoisha(-400),
      idempotencyKey: ledger.keys.manual(crypto.randomUUID()),
      refType: 'manual',
      bypassCreditLimit: true,
    })
  );
  const square = await f.makeReseller();

  await ResellerProfile.updateOne({ _id: rich.profile._id }, { shopName: 'Charu' });
  await ResellerProfile.updateOne({ _id: owing.profile._id }, { shopName: 'Amin' });
  await ResellerProfile.updateOne({ _id: square.profile._id }, { shopName: 'Bokul' });

  const ids = (res) => res.body.data.resellers.map((r) => r.id);
  const [r, o, s] = [rich, owing, square].map((x) => String(x.profile._id));

  const desc = await api.get('/api/owner/resellers?sort=balance_desc&limit=1').expect(200);
  assert.deepEqual(ids(desc), [r, s, o], 'whole, even when a limit was sent');
  assert.equal(desc.body.data.nextCursor, null);
  assert.equal(desc.body.data.resellers[2].balance, -400);

  assert.deepEqual(ids(await api.get('/api/owner/resellers?sort=balance_asc')), [o, s, r]);
  assert.deepEqual(ids(await api.get('/api/owner/resellers?sort=name')), [o, s, r]);

  const bad = await api.get('/api/owner/resellers?sort=richest');
  assert.equal(bad.status, 400);
});

test('a reseller detail carries their trading record', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  const product = await f.makeProduct({ cost: 50 });
  await f.listProduct(profile, product, 70);
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const source = await f.makeSource();

  const empty = (await api.get(`/api/owner/resellers/${profile._id}`).expect(200)).body.data;
  assert.deepEqual(empty.stats, {
    orderCount: 0,
    deliveredCount: 0,
    salesTotal: 0,
    customerTotal: 0,
    lastOrderAt: null,
  });

  // One delivered (2 boxes), one only confirmed (1 box), one still pending.
  const walkTo = async (order, steps) => {
    for (const action of steps) {
      const payload = { courierName: 'Sundarban' };
      // eslint-disable-next-line no-await-in-loop
      if (action === 'accept') payload.sources = f.sourcesFor(await Order.findById(order._id), source);
      // eslint-disable-next-line no-await-in-loop
      await orderService.transitionOrder({
        orderId: order._id,
        action,
        actorUser: owner.user,
        role: ROLES.OWNER,
        payload,
      });
    }
  };
  const delivered = await placeOrder(profile, product, 2);
  await orderService.confirmOrder({ orderId: delivered._id, resellerProfile: profile, actorUser: user });
  await walkTo(delivered, ['accept', 'pack', 'ship', 'deliver']);

  const confirmed = await placeOrder(profile, product, 1);
  await orderService.confirmOrder({ orderId: confirmed._id, resellerProfile: profile, actorUser: user });
  const pending = await placeOrder(profile, product, 1);

  const { stats } = (await api.get(`/api/owner/resellers/${profile._id}`).expect(200)).body.data;
  assert.equal(stats.orderCount, 3);
  assert.equal(stats.deliveredCount, 1);
  // Owner revenue of what traded: (2×50 + 80) + (1×50 + 80). The pending order
  // was never billed and is not in it.
  assert.equal(stats.salesTotal, 180 + 130);
  // What the customers paid for the same two: (2×70 + 80) + (1×70 + 80).
  assert.equal(stats.customerTotal, 220 + 150);
  assert.equal(
    new Date(stats.lastOrderAt).getTime(),
    (await Order.findById(pending._id)).createdAt.getTime()
  );
  assert.equal((await Order.findById(delivered._id)).status, ORDER_STATUS.DELIVERED);
});

test('the deactivation preview counts exactly what deactivating then cancels', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  const product = await f.makeProduct({ cost: 50 });
  await f.listProduct(profile, product, 70);
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });

  await placeOrder(profile, product);
  await placeOrder(profile, product);
  const confirmed = await placeOrder(profile, product);
  await orderService.confirmOrder({ orderId: confirmed._id, resellerProfile: profile, actorUser: user });

  const preview = await api.get(`/api/owner/resellers/${profile._id}/deactivation-preview`);
  assert.equal(preview.status, 200);
  // The confirmed one is fulfilled as normal and not counted. docs/adr/0011.
  assert.deepEqual(preview.body.data, { pendingOrders: 2 });

  const off = await api.patch(`/api/owner/resellers/${profile._id}`).send({ isActive: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.cancelledOrders.length, preview.body.data.pendingOrders);

  const after = await api.get(`/api/owner/resellers/${profile._id}/deactivation-preview`);
  assert.equal(after.body.data.pendingOrders, 0);

  const missing = await api.get('/api/owner/resellers/64b000000000000000000000/deactivation-preview');
  assert.equal(missing.status, 404);
});

test('a manual wallet entry retried with its nonce credits once, and a changed one is refused', async () => {
  const owner = await f.makeOwner();
  const api = as(owner.user);
  const { profile } = await f.makeReseller();
  const url = `/api/owner/resellers/${profile._id}/ledger`;
  const key = crypto.randomUUID();
  const body = { amount: 100, direction: 'credit', note: 'cash at the counter', nonce: key };

  const first = await api.post(url).send(body).expect(201);
  // The response was lost and the form sent again.
  const retry = await api.post(url).send(body).expect(201);
  assert.equal(retry.body.data.entry.id, first.body.data.entry.id);
  assert.equal((await ResellerProfile.findById(profile._id)).balancePoisha, 10000);
  assert.equal(await LedgerEntry.countDocuments({ reseller: profile._id }), 1);
  assert.equal(await AuditLog.countDocuments({ action: 'ledger.manual' }), 1, 'audited once');

  const changed = await api.post(url).send({ ...body, amount: 200 });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, 'NONCE_REUSED');
  const flipped = await api.post(url).send({ ...body, direction: 'debit' });
  assert.equal(flipped.status, 409);
  assert.equal((await ResellerProfile.findById(profile._id)).balancePoisha, 10000);

  // Without a nonce, as older screens send it, every submit is its own entry.
  const plain = { amount: 100, direction: 'credit', note: 'cash at the counter' };
  await api.post(url).send(plain).expect(201);
  await api.post(url).send(plain).expect(201);
  assert.equal((await ResellerProfile.findById(profile._id)).balancePoisha, 30000);
});
