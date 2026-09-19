'use strict';

/*
 * Phase B, money correctness. Every test here pins down a rule from ADRs 0007
 * to 0010: what a withdrawal may do, what a reversal may ignore, when stock
 * comes back, how a delivery charge changes after the wallet was debited, and
 * that a status flip and its ledger entry are one fact.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const orderService = require('../src/services/orderService');
const finance = require('../src/services/finance');
const ledger = require('../src/services/ledger');
const { withTransaction } = require('../src/services/tx');
const { updateSettings } = require('../src/services/settings');

const LedgerEntry = require('../src/models/LedgerEntry');
const ResellerProfile = require('../src/models/ResellerProfile');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const Deposit = require('../src/models/Deposit');
const Withdrawal = require('../src/models/Withdrawal');
const AuditLog = require('../src/models/AuditLog');

const { toPoisha, toTaka } = require('../src/utils/money');
const { toMilli } = require('../src/utils/quantity');
const {
  LEDGER_KIND,
  PAYMENT_MODE,
  ROLES,
  ORDER_STATUS,
  REVIEW_STATUS,
} = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

/* ------------------------------------------------------------------- helpers */

async function signIn({ phone, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

async function placeOrder({ profile, product, quantity = 10, paymentMode = PAYMENT_MODE.PREPAID }) {
  const { order } = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode,
    customer: {
      name: 'Customer',
      phoneE164: '+8801912345678',
      address: '12 Test Road',
      district: 'Dhaka',
    },
    items: [{ product: product._id, variant: product.variants[0]._id, qty: quantity }],
  });
  return order;
}

const confirm = (order, profile, user, extra = {}) =>
  orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: user,
    ...extra,
  });

async function walk(orderId, action, owner, source, payload = {}) {
  const body = { courierName: 'Sundarban', ...payload };
  if (action === 'accept') body.sources = f.sourcesFor(await Order.findById(orderId), source);
  return orderService.transitionOrder({
    orderId,
    action,
    actorUser: owner,
    role: ROLES.OWNER,
    payload: body,
  });
}

const changeCharge = (orderId, taka, owner) =>
  orderService.changeDeliveryCharge({
    orderId,
    deliveryChargePoisha: toPoisha(taka),
    actorUser: owner,
  });

const balanceOf = async (profile) => (await ResellerProfile.findById(profile._id)).balancePoisha;

async function credit(profile, taka, key = crypto.randomUUID()) {
  return withTransaction((session) =>
    ledger.postEntry(session, {
      reseller: profile._id,
      kind: LEDGER_KIND.MANUAL_CREDIT,
      amountPoisha: toPoisha(taka),
      idempotencyKey: ledger.keys.manual(key),
      refType: 'manual',
    })
  );
}

/** A small, seeded, reproducible PRNG (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The three ledger invariants, asserted directly rather than through reconcile. */
async function assertLedgerSound(profile) {
  const entries = await LedgerEntry.find({ reseller: profile._id }).sort({ seq: 1 }).lean();
  let running = 0;
  entries.forEach((entry, index) => {
    assert.equal(entry.seq, index + 1, `sequence gap at entry ${index + 1}`);
    running += entry.amountPoisha;
    assert.equal(entry.balanceAfterPoisha, running, `balanceAfter lies at seq ${entry.seq}`);
  });
  assert.equal(running, await balanceOf(profile), 'ledger sum differs from the stored balance');

  const report = await ledger.reconcile(profile._id);
  assert.deepEqual(report.problems, []);
  return running;
}

/* ------------------------------------------------------ randomised sequence */

test('a randomised sequence of every money movement keeps the ledger sound', async () => {
  const random = prng(20260914);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 1000000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5, trackStock: true, stockQty: 100000 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  // An independent model of what the balance and the stock must be.
  let expectedBalance = 0;
  // Boxes, because that is what stock counts now. docs/adr/0021.
  let expectedStock = 100000;
  let reverseDeliveryOnReturn = false;
  const orders = [];

  const inStatus = (...statuses) => orders.filter((o) => statuses.includes(o.status));
  const counts = {};

  for (let step = 0; step < 120; step += 1) {
    const op = pick([
      'place', 'place', 'confirm', 'confirm', 'advance', 'advance', 'deliver',
      'return', 'cancel', 'adjust', 'adjust', 'deposit', 'withdraw', 'setting',
    ]);
    counts[op] = (counts[op] || 0) + 1;

    /* eslint-disable no-await-in-loop */
    if (op === 'place') {
      const quantity = between(5, 15);
      const paymentMode = pick([PAYMENT_MODE.PREPAID, PAYMENT_MODE.COD]);
      const order = await placeOrder({ profile, product, quantity, paymentMode });
      orders.push({
        id: order._id,
        status: ORDER_STATUS.PENDING,
        qty: quantity,
        costPoisha: order.totals.costSubtotalPoisha,
        sellPoisha: order.totals.sellSubtotalPoisha,
        chargePoisha: order.deliveryChargePoisha,
        paymentMode,
      });
    } else if (op === 'confirm') {
      const o = pick(inStatus(ORDER_STATUS.PENDING));
      if (!o) continue;
      const paymentMode = pick([undefined, PAYMENT_MODE.PREPAID, PAYMENT_MODE.COD]);
      const confirmed = await confirm({ _id: o.id }, profile, reseller, { paymentMode });
      o.status = ORDER_STATUS.CONFIRMED;
      o.paymentMode = confirmed.paymentMode;
      expectedBalance -= o.costPoisha + o.chargePoisha;
      expectedStock -= o.qty;
    } else if (op === 'advance') {
      const o = pick(inStatus(ORDER_STATUS.CONFIRMED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PACKED));
      if (!o) continue;
      const action = { confirmed: 'accept', accepted: 'pack', packed: 'ship' }[o.status];
      const moved = await walk(o.id, action, owner, source);
      o.status = moved.status;
    } else if (op === 'deliver') {
      const o = pick(inStatus(ORDER_STATUS.SHIPPED));
      if (!o) continue;
      await walk(o.id, 'deliver', owner, source);
      o.status = ORDER_STATUS.DELIVERED;
      if (o.paymentMode === PAYMENT_MODE.COD) expectedBalance += o.sellPoisha + o.chargePoisha;
    } else if (op === 'return') {
      const o = pick(inStatus(ORDER_STATUS.SHIPPED));
      if (!o) continue;
      const restock = random() < 0.5;
      await walk(o.id, 'return', owner, source, { reason: 'refused', restock });
      o.status = ORDER_STATUS.RETURNED;
      expectedBalance += o.costPoisha + (reverseDeliveryOnReturn ? o.chargePoisha : 0);
      if (restock) expectedStock += o.qty;
    } else if (op === 'cancel') {
      const o = pick(
        inStatus(ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PACKED)
      );
      if (!o) continue;
      if (o.status !== ORDER_STATUS.PENDING) {
        expectedBalance += o.costPoisha + o.chargePoisha;
        expectedStock += o.qty;
      }
      await walk(o.id, 'cancel', owner, source, { reason: 'random cancel' });
      o.status = ORDER_STATUS.CANCELLED;
    } else if (op === 'adjust') {
      const o = pick(
        inStatus(ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PACKED)
      );
      if (!o) continue;
      const newCharge = toPoisha(between(0, 20) * 10);
      await orderService.changeDeliveryCharge({
        orderId: o.id,
        deliveryChargePoisha: newCharge,
        actorUser: owner,
      });
      if (o.status !== ORDER_STATUS.PENDING) expectedBalance -= newCharge - o.chargePoisha;
      o.chargePoisha = newCharge;
    } else if (op === 'deposit') {
      const amountPoisha = toPoisha(between(100, 3000));
      const deposit = await Deposit.create({ reseller: profile._id, amountPoisha, method: 'bkash' });
      const approve = random() < 0.8;
      await finance.decideDeposit({ depositId: deposit._id, approve, actorUser: owner });
      if (approve) expectedBalance += amountPoisha;
    } else if (op === 'withdraw') {
      const ceiling = Math.max(Math.round(toTaka(Math.max(expectedBalance, 0)) * 1.5), 100);
      const amountPoisha = toPoisha(between(1, ceiling));
      const withdrawal = await Withdrawal.create({
        reseller: profile._id,
        amountPoisha,
        method: 'bkash',
        destinationNumber: '+8801712345678',
      });
      const attempt = finance.decideWithdrawal({
        withdrawalId: withdrawal._id,
        approve: true,
        actorUser: owner,
      });
      if (amountPoisha > expectedBalance) {
        await assert.rejects(attempt, { code: 'INSUFFICIENT_BALANCE' });
        const still = await Withdrawal.findById(withdrawal._id);
        assert.equal(still.status, REVIEW_STATUS.PENDING, 'a refused approval left its status');
      } else {
        await attempt;
        expectedBalance -= amountPoisha;
      }
    } else if (op === 'setting') {
      reverseDeliveryOnReturn = !reverseDeliveryOnReturn;
      await updateSettings({ reverseDeliveryChargeOnReturn: reverseDeliveryOnReturn });
    }
    /* eslint-enable no-await-in-loop */

    // eslint-disable-next-line no-await-in-loop
    assert.equal(await balanceOf(profile), expectedBalance, `balance wrong after step ${step} (${op})`);
  }

  const settled = await assertLedgerSound(profile);
  assert.equal(settled, expectedBalance);

  const afterProduct = await Product.findById(product._id);
  assert.equal(afterProduct.variants[0].stockQty, expectedStock, 'stock drifted from the model');

  const all = await ledger.reconcileAll();
  assert.equal(all.checked, 1);
  assert.deepEqual(all.drifted, []);

  // The sequence must actually have exercised the interesting paths.
  const kinds = await LedgerEntry.distinct('kind', { reseller: profile._id });
  for (const kind of [
    LEDGER_KIND.ORDER_COST_DEBIT,
    LEDGER_KIND.DELIVERY_ADJUSTMENT,
    LEDGER_KIND.DEPOSIT_CREDIT,
    LEDGER_KIND.WITHDRAWAL_DEBIT,
    LEDGER_KIND.REVERSAL,
  ]) {
    assert.ok(kinds.includes(kind), `the random sequence never posted ${kind}: ${JSON.stringify(counts)}`);
  }
});

/* ------------------------------------------------------------------ deposits */

test('two simultaneous approvals of one deposit through the route credit it once', async () => {
  const owner = await f.makeOwner();
  const { profile } = await f.makeReseller();
  const deposit = await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(1500),
    method: 'nagad',
  });

  const agent = await signIn({ phone: owner.phone, password: owner.password });
  const results = await Promise.all([
    agent.post(`/api/owner/deposits/${deposit._id}/approve`).send({}),
    agent.post(`/api/owner/deposits/${deposit._id}/approve`).send({}),
  ]);

  const statuses = results.map((r) => r.status).sort();
  assert.equal(statuses.filter((s) => s === 200).length, 1, `statuses were ${statuses}`);

  assert.equal(toTaka(await balanceOf(profile)), 1500);
  assert.equal(await LedgerEntry.countDocuments({ reseller: profile._id }), 1);

  const reloaded = await Deposit.findById(deposit._id);
  assert.equal(reloaded.status, REVIEW_STATUS.APPROVED);
  assert.ok(reloaded.ledgerEntry, 'the approved deposit does not point at its entry');
});

test('a deposit approval whose ledger post fails leaves the deposit pending', async (t) => {
  const owner = await f.makeOwner();
  const { profile } = await f.makeReseller();
  const deposit = await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(900),
    method: 'bkash',
  });
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  t.mock.method(ledger, 'postEntry', async () => {
    throw new Error('simulated ledger failure');
  });

  const failed = await agent.post(`/api/owner/deposits/${deposit._id}/approve`).send({});
  assert.equal(failed.status, 500);

  const afterFailure = await Deposit.findById(deposit._id);
  assert.equal(afterFailure.status, REVIEW_STATUS.PENDING, 'the approval stood with no money moved');
  assert.equal(afterFailure.reviewedAt, undefined);
  assert.equal(await balanceOf(profile), 0);

  // Once the ledger is healthy the same deposit can still be approved.
  t.mock.restoreAll();
  const retried = await agent.post(`/api/owner/deposits/${deposit._id}/approve`).send({});
  assert.equal(retried.status, 200);
  assert.equal(toTaka(await balanceOf(profile)), 900);
});

test('rejecting a deposit moves no money and cannot be approved afterwards', async () => {
  const owner = await f.makeOwner();
  const { profile } = await f.makeReseller();
  const deposit = await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(400),
    method: 'bkash',
  });
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  const rejected = await agent
    .post(`/api/owner/deposits/${deposit._id}/reject`)
    .send({ reason: 'No such transaction' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, REVIEW_STATUS.REJECTED);

  const approved = await agent.post(`/api/owner/deposits/${deposit._id}/approve`).send({});
  assert.equal(approved.status, 404);
  assert.equal(await LedgerEntry.countDocuments({ reseller: profile._id }), 0);
});

/* --------------------------------------------------------------- withdrawals */

test('a withdrawal approval is refused once a confirm has spent the balance', async () => {
  const owner = await f.makeOwner();
  // A large credit limit, which a withdrawal must never be allowed to use.
  const { phone, password, profile, user } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  await credit(profile, 1000);

  const resellerAgent = await signIn({ phone, password });
  const requested = await resellerAgent
    .post('/api/reseller/withdrawals')
    .send({ amount: 800, method: 'bkash', destinationNumber: '01712345678' });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));

  // Between request and approval the reseller confirms an order for 630.
  const order = await placeOrder({ profile, product, quantity: 10 });
  await confirm(order, profile, user);
  assert.equal(toTaka(await balanceOf(profile)), 370);

  const ownerAgent = await signIn({ phone: owner.phone, password: owner.password });
  const approval = await ownerAgent
    .post(`/api/owner/withdrawals/${requested.body.data.withdrawal.id}/approve`)
    .send({ payoutReference: 'BK-1' });

  assert.equal(approval.status, 409);
  assert.equal(approval.body.error.code, 'INSUFFICIENT_BALANCE');

  const withdrawal = await Withdrawal.findById(requested.body.data.withdrawal.id);
  assert.equal(withdrawal.status, REVIEW_STATUS.PENDING);
  assert.equal(withdrawal.payoutReference, undefined);
  assert.equal(toTaka(await balanceOf(profile)), 370, 'the withdrawal dipped into credit');
  assert.equal(
    await LedgerEntry.countDocuments({ reseller: profile._id, kind: LEDGER_KIND.WITHDRAWAL_DEBIT }),
    0
  );

  // Exactly the balance is fine, and lands on zero rather than below it.
  const exact = await Withdrawal.create({
    reseller: profile._id,
    amountPoisha: toPoisha(370),
    method: 'bkash',
    destinationNumber: '+8801712345678',
  });
  const paid = await ownerAgent.post(`/api/owner/withdrawals/${exact._id}/approve`).send({});
  assert.equal(paid.status, 200);
  assert.equal(await balanceOf(profile), 0);
  await assertLedgerSound(profile);
});

/* --------------------------------------------------------- payout destination */

/*
 * A withdrawal is paid to a wallet number or to a bank account, never to both
 * and never to the wrong shape of either. See docs/adr/0018.
 */

test('a bank withdrawal is requested on an account, not a phone number', async () => {
  const { phone, password, profile } = await f.makeReseller();
  await credit(profile, 1000);
  const agent = await signIn({ phone, password });

  const res = await agent.post('/api/reseller/withdrawals').send({
    amount: 500,
    method: 'bank',
    bank: {
      accountName: 'Mainul Hasan',
      bankName: 'Islami Bank Bangladesh',
      branchName: 'Chapainawabganj',
      accountNumber: '20501234567890',
      routingNumber: '125440783',
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const stored = await Withdrawal.findById(res.body.data.withdrawal.id);
  assert.equal(stored.bank.bankName, 'Islami Bank Bangladesh');
  assert.equal(stored.bank.branchName, 'Chapainawabganj');
  assert.equal(stored.bank.accountNumber, '20501234567890');
  // The account number is never bent into a phone number, and the phone field
  // stays empty rather than holding something nobody can pay into.
  assert.equal(stored.destinationNumber, undefined);
  assert.equal(res.body.data.withdrawal.destinationNumber, null);
  assert.equal(res.body.data.withdrawal.bank.accountName, 'Mainul Hasan');
});

test('a bank withdrawal missing its account details is refused field by field', async () => {
  const { phone, password, profile } = await f.makeReseller();
  await credit(profile, 1000);
  const agent = await signIn({ phone, password });

  const bare = await agent.post('/api/reseller/withdrawals').send({ amount: 500, method: 'bank' });
  assert.equal(bare.status, 400);
  assert.ok(bare.body.error.fields.bank, JSON.stringify(bare.body));

  const partial = await agent.post('/api/reseller/withdrawals').send({
    amount: 500,
    method: 'bank',
    bank: { accountName: 'Mainul Hasan', bankName: 'Islami Bank', branchName: '', accountNumber: 'abcd' },
  });
  assert.equal(partial.status, 400);
  assert.ok(partial.body.error.fields['bank.branchName']);
  assert.ok(partial.body.error.fields['bank.accountNumber']);
});

test('a wallet withdrawal still needs a number, and takes no bank block', async () => {
  const { phone, password, profile } = await f.makeReseller();
  await credit(profile, 1000);
  const agent = await signIn({ phone, password });

  const missing = await agent
    .post('/api/reseller/withdrawals')
    .send({ amount: 500, method: 'bkash' });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.error.fields.destinationNumber, JSON.stringify(missing.body));

  const ok = await agent
    .post('/api/reseller/withdrawals')
    .send({ amount: 500, method: 'nagad', destinationNumber: '01712345678' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const stored = await Withdrawal.findById(ok.body.data.withdrawal.id);
  assert.equal(stored.destinationNumber, '+8801712345678');
  assert.equal(stored.bank, null);
});

/* ------------------------------------------------------------------- returns */

async function shippedOrder({ creditLimit = 100000, trackStock = true, paymentMode } = {}) {
  const { user: reseller, profile, phone, password } = await f.makeReseller({ creditLimit });
  const owner = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5, trackStock, stockQty: 100 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10, paymentMode });
  await confirm(order, profile, reseller);
  for (const action of ['accept', 'pack', 'ship']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(order._id, action, owner.user, source);
  }
  return { reseller, profile, phone, password, owner, product, source, order };
}

/*
 * Stock is a count of boxes, held per box size, because that is what a godown
 * holds. See docs/adr/0021.
 */
test('stock is counted per box, and one box running out does not stop the other', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 1000000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({
    trackStock: true,
    boxes: [
      { content: 6, cost: 330, stockQty: 2 },
      { content: 11, cost: 600, stockQty: 5 },
    ],
  });
  await f.listProduct(profile, product, (variant) => variant.costPricePoisha / 100 + 100);

  const place = (index, qty) =>
    orderService.createPendingOrder({
      resellerProfile: profile,
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: {
        name: 'Customer',
        phoneE164: '+8801912345678',
        address: '12 Test Road',
        district: 'Dhaka',
      },
      items: [{ product: product._id, variant: product.variants[index]._id, qty }],
    });

  // Both sixes go.
  const first = await place(0, 2);
  await confirm({ _id: first.order._id }, profile, reseller);
  let live = await Product.findById(product._id);
  assert.equal(live.variants[0].stockQty, 0);
  assert.equal(live.variants[1].stockQty, 5, 'the other box was touched');

  // A third six is refused, and names the box rather than the product.
  const third = await place(0, 1);
  await assert.rejects(
    () => confirm({ _id: third.order._id }, profile, reseller),
    (err) => {
      assert.equal(err.code, 'OUT_OF_STOCK');
      assert.match(err.message, /6 kg/);
      return true;
    }
  );

  // The eleven-kilo box still sells, which is the whole point of counting boxes.
  const big = await place(1, 3);
  const confirmed = await confirm({ _id: big.order._id }, profile, reseller);
  assert.equal(confirmed.status, ORDER_STATUS.CONFIRMED);
  live = await Product.findById(product._id);
  assert.equal(live.variants[1].stockQty, 2);

  // And cancelling puts those three boxes back on their own row.
  await orderService.transitionOrder({
    orderId: big.order._id,
    action: 'cancel',
    actorUser: reseller,
    role: ROLES.RESELLER,
    resellerProfile: profile,
    payload: { reason: 'Customer changed mind' },
  });
  live = await Product.findById(product._id);
  assert.equal(live.variants[1].stockQty, 5);
  assert.equal(live.variants[0].stockQty, 0);
});

test('a return without the restock box leaves stock where it is', async () => {
  const { owner, product, order, profile } = await shippedOrder();
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  const res = await agent.post(`/api/owner/orders/${order._id}/return`).send({ reason: 'refused' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.order.status, ORDER_STATUS.RETURNED);
  assert.equal(res.body.data.order.restockedOnReturn, false);

  assert.equal((await Product.findById(product._id)).variants[0].stockQty, 90);

  const log = await AuditLog.findOne({ action: 'order.return', targetId: order._id });
  assert.equal(log.after.restocked, false);
  await assertLedgerSound(profile);
});

test('a return with the restock box puts the stock back and records it', async () => {
  const { owner, product, order, profile } = await shippedOrder();
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  const res = await agent
    .post(`/api/owner/orders/${order._id}/return`)
    .send({ reason: 'refused, fruit intact', restock: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.order.restockedOnReturn, true);

  assert.equal((await Product.findById(product._id)).variants[0].stockQty, 100);
  assert.equal((await Order.findById(order._id)).restockedOnReturn, true);

  const log = await AuditLog.findOne({ action: 'order.return', targetId: order._id });
  assert.equal(log.after.restocked, true);

  // The goods are reversed, the courier fee kept.
  assert.equal(toTaka(await balanceOf(profile)), -80);
});

test('a delivered order cannot be returned', async () => {
  const { owner, order, source } = await shippedOrder();
  await walk(order._id, 'deliver', owner.user, source);

  await assert.rejects(walk(order._id, 'return', owner.user, source, { reason: 'late complaint' }), {
    code: 'INVALID_TRANSITION',
  });
  assert.equal((await Order.findById(order._id)).status, ORDER_STATUS.DELIVERED);
});

test('cancelling a packed order gives its stock back', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5, trackStock: true, stockQty: 100 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await confirm(order, profile, reseller);
  await walk(order._id, 'accept', owner, source);
  await walk(order._id, 'pack', owner, source);
  assert.equal((await Product.findById(product._id)).variants[0].stockQty, 90);

  await walk(order._id, 'cancel', owner, source, { reason: 'orchard short' });

  assert.equal((await Product.findById(product._id)).variants[0].stockQty, 100);
  assert.equal(await balanceOf(profile), 0);
});

test('a return reversal succeeds even when it leaves the balance past the credit limit', async () => {
  await updateSettings({ reverseDeliveryChargeOnReturn: true });

  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 2000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const first = await placeOrder({ profile, product, quantity: 10 });
  const second = await placeOrder({ profile, product, quantity: 10 });
  await confirm(first, profile, reseller);
  await confirm(second, profile, reseller);
  assert.equal(toTaka(await balanceOf(profile)), -1260);

  // The owner cuts the second order's delivery to nothing: a +80 adjustment.
  await changeCharge(second._id, 0, owner);
  assert.equal(toTaka(await balanceOf(profile)), -1180);

  for (const action of ['accept', 'pack', 'ship']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(second._id, action, owner, source);
  }

  // Then tightens the limit to zero. The reseller is now far past it.
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { creditLimitPoisha: 0 } });

  /*
   * Reversing the +80 cut is an 80 debit posted while the balance is already
   * below the limit. A limit governs new commitments, so it must go through.
   */
  const returned = await walk(second._id, 'return', owner, source, { reason: 'refused' });
  assert.equal(returned.status, ORDER_STATUS.RETURNED);

  const adjustmentReversal = await LedgerEntry.findOne({
    reseller: profile._id,
    kind: LEDGER_KIND.REVERSAL,
    amountPoisha: toPoisha(-80),
  });
  assert.ok(adjustmentReversal, 'the adjustment was not reversed');
  assert.equal(toTaka(await balanceOf(profile)), -630);
  await assertLedgerSound(profile);
});

/* ----------------------------------------------------------- delivery charge */

test('changing the delivery charge before confirm only rewrites the order', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const owner = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  const agent = await signIn({ phone: owner.phone, password: owner.password });

  const res = await agent
    .patch(`/api/owner/orders/${order._id}/delivery-charge`)
    .send({ deliveryCharge: 120 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.order.deliveryCharge, 120);
  assert.equal(res.body.data.order.totals.walletDebit, 670);
  assert.equal(res.body.data.order.totals.customerTotal, 740);
  assert.equal(res.body.data.adjustment, null);
  assert.equal(await LedgerEntry.countDocuments({ reseller: profile._id }), 0);

  await confirm(order, profile, reseller);
  const delivery = await LedgerEntry.findOne({ reseller: profile._id, kind: LEDGER_KIND.DELIVERY_DEBIT });
  assert.equal(toTaka(delivery.amountPoisha), -120);
  assert.equal(toTaka(await balanceOf(profile)), -670);
});

test('changing the delivery charge after confirm posts audited adjustments', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const owner = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10, paymentMode: PAYMENT_MODE.COD });
  await confirm(order, profile, reseller);
  await walk(order._id, 'accept', owner.user, source);

  const agent = await signIn({ phone: owner.phone, password: owner.password });

  // A raise is a debit of the difference.
  const raised = await agent
    .patch(`/api/owner/orders/${order._id}/delivery-charge`)
    .send({ deliveryCharge: 150 });
  assert.equal(raised.status, 200, JSON.stringify(raised.body));
  assert.equal(raised.body.data.adjustment.kind, LEDGER_KIND.DELIVERY_ADJUSTMENT);
  assert.equal(raised.body.data.adjustment.amount, -70);

  // A cut is a credit of the difference, under the next key.
  await walk(order._id, 'pack', owner.user, source);
  const cut = await agent
    .patch(`/api/owner/orders/${order._id}/delivery-charge`)
    .send({ deliveryCharge: 100 });
  assert.equal(cut.status, 200);
  assert.equal(cut.body.data.adjustment.amount, 50);

  // Setting the same charge again is a no-op, not a zero entry.
  const same = await agent
    .patch(`/api/owner/orders/${order._id}/delivery-charge`)
    .send({ deliveryCharge: 100 });
  assert.equal(same.status, 200);
  assert.equal(same.body.data.adjustment, null);

  const adjustments = await LedgerEntry.find({
    reseller: profile._id,
    kind: LEDGER_KIND.DELIVERY_ADJUSTMENT,
  }).sort({ seq: 1 });
  assert.deepEqual(
    adjustments.map((e) => e.idempotencyKey),
    [`order:${order._id}:delivery-adjust:1`, `order:${order._id}:delivery-adjust:2`]
  );

  const reloaded = await Order.findById(order._id);
  assert.equal(reloaded.deliveryAdjustmentCount, 2);
  assert.equal(toTaka(reloaded.totals.walletDebitPoisha), 650);
  assert.equal(toTaka(reloaded.totals.customerTotalPoisha), 720);
  assert.equal(toTaka(await balanceOf(profile)), -650);

  const logs = await AuditLog.find({ action: 'order.delivery_charge', targetId: order._id }).sort({
    _id: 1,
  });
  assert.equal(logs.length, 2, 'the no-op change was audited, or a real one was not');
  assert.equal(logs[0].before.deliveryChargePoisha, toPoisha(80));
  assert.equal(logs[0].after.deliveryChargePoisha, toPoisha(150));
  assert.equal(logs[1].before.deliveryChargePoisha, toPoisha(150));

  // Shipped: the charge is locked.
  await walk(order._id, 'ship', owner.user, source);
  const locked = await agent
    .patch(`/api/owner/orders/${order._id}/delivery-charge`)
    .send({ deliveryCharge: 60 });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error.code, 'DELIVERY_CHARGE_LOCKED');

  // The collection credit uses the final charge: 620 of goods plus 100 delivery.
  await walk(order._id, 'deliver', owner.user, source);
  const collected = await LedgerEntry.findOne({
    reseller: profile._id,
    kind: LEDGER_KIND.COD_COLLECTION_CREDIT,
  });
  assert.equal(toTaka(collected.amountPoisha), 720);
  assert.equal(toTaka(await balanceOf(profile)), 70, 'the margin is not the margin');
  await assertLedgerSound(profile);
});

test('a cancel reverses delivery adjustments along with the delivery debit', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await confirm(order, profile, reseller);
  await changeCharge(order._id, 130, owner);
  await changeCharge(order._id, 90, owner);

  await walk(order._id, 'cancel', owner, source, { reason: 'customer gone' });

  assert.equal(await balanceOf(profile), 0);
  assert.equal(
    await LedgerEntry.countDocuments({ reseller: profile._id, kind: LEDGER_KIND.REVERSAL }),
    4
  );
  await assertLedgerSound(profile);
});

test('a return keeps the adjusted delivery charge unless the setting says otherwise', async () => {
  const { profile, owner, order, source } = await shippedOrder({ trackStock: false });
  // Adjustments are only allowed before shipping, so post one on a fresh order.
  assert.equal((await Order.findById(order._id)).status, ORDER_STATUS.SHIPPED);

  const { user: reseller, profile: p2 } = await f.makeReseller({ creditLimit: 100000 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(p2, product, 62);
  const second = await placeOrder({ profile: p2, product, quantity: 10 });
  await confirm(second, p2, reseller);
  await changeCharge(second._id, 110, owner.user);
  for (const action of ['accept', 'pack', 'ship', 'return']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(second._id, action, owner.user, source, { reason: 'refused' });
  }
  // The goods come back; the courier fee, as adjusted to 110, stays.
  assert.equal(toTaka(await balanceOf(p2)), -110);
  await assertLedgerSound(p2);

  await updateSettings({ reverseDeliveryChargeOnReturn: true });
  await walk(order._id, 'return', owner.user, source, { reason: 'refused' });
  assert.equal(await balanceOf(profile), 0);
});

/* ---------------------------------------------------------- confirm details */

test('a payment mode changed at confirm is written to the status history', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, paymentMode: PAYMENT_MODE.COD });
  const confirmed = await confirm(order, profile, reseller, { paymentMode: PAYMENT_MODE.PREPAID });

  assert.equal(confirmed.paymentMode, PAYMENT_MODE.PREPAID);
  const entry = confirmed.statusHistory[confirmed.statusHistory.length - 1];
  assert.equal(entry.status, ORDER_STATUS.CONFIRMED);
  assert.equal(entry.paymentModeFrom, PAYMENT_MODE.COD);
  assert.equal(entry.paymentModeTo, PAYMENT_MODE.PREPAID);
  assert.match(entry.note, /cod to prepaid/);

  // An unchanged mode records nothing extra.
  const other = await placeOrder({ profile, product, paymentMode: PAYMENT_MODE.COD });
  const same = await confirm(other, profile, reseller, { paymentMode: PAYMENT_MODE.COD });
  const plain = same.statusHistory[same.statusHistory.length - 1];
  assert.equal(plain.paymentModeFrom, undefined);
});

test('confirming an order that is not pending is an invalid transition', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product });
  await confirm(order, profile, reseller);

  await assert.rejects(confirm(order, profile, reseller), { code: 'INVALID_TRANSITION' });
  assert.equal(await LedgerEntry.countDocuments({ reseller: profile._id }), 2);
});

/* ---------------------------------------------------------------- reporting */

test('receivables and the dashboard come from the ledger, and flag a drifted cache', async () => {
  const owner = await f.makeOwner();
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product });
  await confirm(order, profile, reseller);

  // Corrupt the cache behind the ledger's back.
  await ResellerProfile.updateOne({ _id: profile._id }, { $inc: { balancePoisha: toPoisha(-500) } });

  const agent = await signIn({ phone: owner.phone, password: owner.password });

  const dash = await agent.get('/api/owner/reports/dashboard');
  assert.equal(dash.body.data.totalReceivable, 630);

  const receivables = await agent.get('/api/owner/reports/receivables');
  assert.equal(receivables.body.data.totalOwed, 630);
  assert.equal(receivables.body.data.resellers[0].owed, 630);
  assert.equal(receivables.body.data.resellers[0].drift, true);
  assert.equal(receivables.body.data.totalPayable, 0);
});

test('receivables list resellers in credit and any drift, and total both sides', async () => {
  const owner = await f.makeOwner();
  const { profile: owing } = await f.makeReseller({ creditLimit: 1000 });
  const { profile: inCredit } = await f.makeReseller();
  const { profile: creditDrift } = await f.makeReseller();
  const { profile: noEntriesDrift } = await f.makeReseller();
  const { profile: square } = await f.makeReseller();

  await credit(owing, -300);
  await credit(inCredit, 250);
  await credit(creditDrift, 40);
  // Positive balances with a cache that disagrees: one with entries, one without.
  await ResellerProfile.updateOne({ _id: creditDrift._id }, { $inc: { balancePoisha: toPoisha(5) } });
  await ResellerProfile.updateOne({ _id: noEntriesDrift._id }, { $set: { balancePoisha: toPoisha(12) } });

  const agent = await signIn({ phone: owner.phone, password: owner.password });
  const res = await agent.get('/api/owner/reports/receivables');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const data = res.body.data;

  assert.equal(data.totalOwed, 300, 'owed is still only the negatives');
  assert.equal(data.totalPayable, 290, 'payable is the positives, from the ledger');

  const byId = new Map(data.resellers.map((r) => [String(r.id), r]));
  assert.equal(byId.size, 4);
  assert.ok(!byId.has(String(square._id)), 'a square, consistent reseller is not listed');

  assert.equal(data.resellers[0].id, String(owing._id), 'most owed first');
  assert.deepEqual(
    [byId.get(String(owing._id)).owed, byId.get(String(owing._id)).payable, byId.get(String(owing._id)).drift],
    [300, 0, false]
  );
  assert.deepEqual(
    [byId.get(String(inCredit._id)).balance, byId.get(String(inCredit._id)).payable, byId.get(String(inCredit._id)).drift],
    [250, 250, false]
  );
  assert.equal(byId.get(String(creditDrift._id)).drift, true);
  assert.equal(byId.get(String(creditDrift._id)).cachedBalance, 45);
  const orphan = byId.get(String(noEntriesDrift._id));
  assert.deepEqual([orphan.balance, orphan.cachedBalance, orphan.drift], [0, 12, true]);
});

test('reconcileAll walks every reseller in batches and returns only the drifted', async () => {
  const profiles = [];
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { profile } = await f.makeReseller();
    // eslint-disable-next-line no-await-in-loop
    await credit(profile, 100 + i);
    profiles.push(profile);
  }
  await ResellerProfile.updateOne({ _id: profiles[3]._id }, { $inc: { balancePoisha: 1 } });

  const result = await ledger.reconcileAll({ batchSize: 2 });
  assert.equal(result.checked, 5);
  assert.equal(result.drifted.length, 1);
  assert.equal(String(result.drifted[0].reseller), String(profiles[3]._id));
  assert.equal(result.drifted[0].ok, false);
  assert.ok(result.drifted[0].problems.length > 0);
});

/* ------------------------------------------------------------ public submits */

test('identical public submissions sent at once return the same order', async () => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const body = {
    submissionId: crypto.randomUUID(),
    paymentMode: PAYMENT_MODE.PREPAID,
    customer: f.customer(),
    items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
  };

  const results = await Promise.all([
    request(app).post(`/api/public/shop/${profile.slug}/orders`).send(body),
    request(app).post(`/api/public/shop/${profile.slug}/orders`).send(body),
    request(app).post(`/api/public/shop/${profile.slug}/orders`).send(body),
  ]);

  results.forEach((r) => assert.ok([200, 201].includes(r.status), JSON.stringify(r.body)));
  const codes = new Set(results.map((r) => r.body.data.orderCode));
  assert.equal(codes.size, 1, 'the submissions produced different orders');
  assert.equal(await Order.countDocuments({ reseller: profile._id }), 1);
});

test('a submission that loses the insert race gets the winning order, not a 409', async (t) => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const body = {
    submissionId: crypto.randomUUID(),
    paymentMode: PAYMENT_MODE.PREPAID,
    customer: f.customer(),
    items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
  };

  const first = await request(app).post(`/api/public/shop/${profile.slug}/orders`).send(body);
  assert.equal(first.status, 201);

  // Blind the duplicate lookup once, exactly as a concurrent request would be.
  const lookup = t.mock.method(Order, 'findOne', async () => null, { times: 1 });

  const second = await request(app).post(`/api/public/shop/${profile.slug}/orders`).send(body);
  assert.ok(lookup.mock.callCount() >= 1, 'the duplicate lookup was never blinded');
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.data.duplicate, true);
  assert.equal(second.body.data.orderCode, first.body.data.orderCode);
});
