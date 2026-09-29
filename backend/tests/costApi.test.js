'use strict';

/*
 * Phases C and E of docs/PLAN-3.md: the owner API for the cost side, and the
 * reports built on it. The services themselves are covered by supplies.test.js
 * and the consumption wiring by packaging.test.js; this file is about the routes,
 * their validation, and whether the profit figure actually adds up.
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
const expenseService = require('../src/services/expenseService');

const Supply = require('../src/models/Supply');
const Payee = require('../src/models/Payee');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const Expense = require('../src/models/Expense');
const ExpenseCategory = require('../src/models/ExpenseCategory');
const AuditLog = require('../src/models/AuditLog');

const { toMilli } = require('../src/utils/quantity');
const {
  ROLES,
  PAYMENT_MODE,
  CATEGORY_SCOPE,
  CHARGE_PAID_TO,
  PAYEE_LEDGER_KIND,
  MOVEMENT_KIND,
} = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

function as(user) {
  const auth = `Bearer ${tokens.signAccessToken(user)}`;
  const wrap = (method) => (url) => request(app)[method](url).set('Authorization', auth);
  return {
    get: wrap('get'),
    post: wrap('post'),
    put: wrap('put'),
    patch: wrap('patch'),
    delete: wrap('delete'),
  };
}

const nonce = () => crypto.randomUUID();

/** An owner, a supply and a payee: the three things most of these tests need. */
async function setup() {
  const owner = await f.makeOwner();
  const api = as(owner.user);

  const crate = await api.post('/api/owner/supplies').send({ nameBn: 'ক্যারেট', unit: 'pcs' });
  const payee = await api
    .post('/api/owner/payees')
    .send({ nameBn: 'করিম ক্যারেট স্টোর', kind: 'supplier' });

  return {
    owner,
    api,
    crateId: crate.body.data.supply.id,
    payeeId: payee.body.data.payee.id,
  };
}

/* ------------------------------------------------------------------ supplies */

test('a supply is created, listed with its value, and archived not deleted', async () => {
  const { api, crateId } = await setup();

  await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.OPENING, quantity: 100, nonce: nonce() })
    .expect(201);

  const list = await api.get('/api/owner/supplies').expect(200);
  assert.equal(list.body.data.supplies.length, 1);
  assert.equal(list.body.data.supplies[0].onHand, 100);

  const archived = await api.delete(`/api/owner/supplies/${crateId}`).expect(200);
  assert.equal(archived.body.data.supply.isArchived, true);

  // Gone from the default list, still in the database and still resolvable.
  assert.equal((await api.get('/api/owner/supplies')).body.data.supplies.length, 0);
  assert.equal(
    (await api.get('/api/owner/supplies?includeArchived=true')).body.data.supplies.length,
    1
  );
  assert.ok(await Supply.findById(crateId));
  assert.ok(await AuditLog.findOne({ action: 'supply.archive' }));
});

test('a one-directional movement cannot be inverted by typing a minus sign', async () => {
  const { api, crateId } = await setup();
  await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.OPENING, quantity: 10, nonce: nonce() });

  // "Five were damaged", typed as -5 by somebody being helpful.
  await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.DAMAGED, quantity: -5, nonce: nonce() })
    .expect(201);

  // Breakage reduces the shelf whichever way it was written.
  assert.equal((await Supply.findById(crateId)).onHandMilli, toMilli(5));
});

test('returning goods to a payee is refused when the shelf cannot cover it', async () => {
  const { api, crateId } = await setup();
  await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.OPENING, quantity: 2, nonce: nonce() });

  const res = await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.RETURN_TO_PAYEE, quantity: 5, nonce: nonce() });

  // Unlike consumption, this one is a promise to somebody. See docs/adr/0026.
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'SUPPLY_SHORT');
  assert.equal((await Supply.findById(crateId)).onHandMilli, toMilli(2));
});

test('a stock take takes a counted total, and accepts an empty shelf', async () => {
  const { api, crateId } = await setup();
  await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.OPENING, quantity: 100, nonce: nonce() });

  const counted = await api
    .post(`/api/owner/supplies/${crateId}/stock-take`)
    .send({ counted: 94, nonce: nonce() })
    .expect(200);
  assert.equal(counted.body.data.supply.onHand, 94);
  assert.equal(counted.body.data.movement.quantity, -6);
  // Somebody looked at the shelf, so this is evidence rather than an estimate.
  assert.equal(counted.body.data.movement.isEstimated, false);

  // Counting again and finding it right writes nothing.
  const again = await api
    .post(`/api/owner/supplies/${crateId}/stock-take`)
    .send({ counted: 94, nonce: nonce() })
    .expect(200);
  assert.equal(again.body.data.movement, null);
  assert.equal(again.body.data.agreed, true);

  // An empty shelf is a real count, and `toMilli` refusing zero must not block it.
  const empty = await api
    .post(`/api/owner/supplies/${crateId}/stock-take`)
    .send({ counted: 0, nonce: nonce() })
    .expect(200);
  assert.equal(empty.body.data.supply.onHand, 0);
});

/* -------------------------------------------------------------------- payees */

test('a payee accrues a due from a purchase and is paid it down', async () => {
  const { api, crateId, payeeId } = await setup();

  const purchase = await api
    .post('/api/owner/purchases')
    .send({
      payeeId,
      lines: [{ supplyId: crateId, quantity: 100, unitCost: 80 }],
      charges: [
        { kind: 'loading', amount: 200, paidTo: CHARGE_PAID_TO.PAYEE },
        // Cash to a van driver at the gate: raises the cost, owes the seller nothing.
        { kind: 'transport', amount: 600, paidTo: CHARGE_PAID_TO.OTHER },
      ],
    })
    .expect(201);

  const p = purchase.body.data.purchase;
  assert.equal(p.goodsCost, 8000);
  assert.equal(p.total, 8800);
  assert.equal(p.payeeTotal, 8200, 'only what this seller billed');
  assert.equal(p.otherCharge, 600);
  // 88 a crate, not the 80 that was quoted.
  assert.equal(p.lines[0].landedUnitCost, 88);

  const detail = await api.get(`/api/owner/payees/${payeeId}`).expect(200);
  assert.equal(detail.body.data.payee.due, 8200);
  assert.equal(detail.body.data.health.ok, true);

  await api
    .post(`/api/owner/payees/${payeeId}/payments`)
    .send({ amount: 8200, nonce: nonce(), paidFrom: 'bkash' })
    .expect(201);

  assert.equal((await api.get(`/api/owner/payees/${payeeId}`)).body.data.payee.due, 0);
});

test('paying a payee more than the due leaves an advance, not an error', async () => {
  const { api, payeeId } = await setup();

  await api
    .post(`/api/owner/payees/${payeeId}/payments`)
    .send({ amount: 5000, nonce: nonce() })
    .expect(201);

  const payee = (await api.get(`/api/owner/payees/${payeeId}`)).body.data.payee;
  assert.equal(payee.due, -5000);
  // Flagged rather than left as a minus sign to be misread.
  assert.equal(payee.isAdvance, true);
  assert.equal(payee.advance, 5000);
});

test('a payment cannot be made twice on one request key', async () => {
  const { api, payeeId } = await setup();
  const key = nonce();

  await api.post(`/api/owner/payees/${payeeId}/payments`).send({ amount: 500, nonce: key });
  await api.post(`/api/owner/payees/${payeeId}/payments`).send({ amount: 500, nonce: key });

  assert.equal((await Payee.findById(payeeId)).duePoisha, -50000);
});

test('only the three typeable kinds are accepted as a manual payee entry', async () => {
  const { api, payeeId } = await setup();

  await api
    .post(`/api/owner/payees/${payeeId}/ledger`)
    .send({ kind: PAYEE_LEDGER_KIND.OPENING, amount: 1200, nonce: nonce() })
    .expect(201);
  assert.equal((await Payee.findById(payeeId)).duePoisha, 120000);

  // A discount only ever reduces the due, whichever sign was typed.
  await api
    .post(`/api/owner/payees/${payeeId}/ledger`)
    .send({ kind: PAYEE_LEDGER_KIND.DISCOUNT, amount: 200, nonce: nonce() })
    .expect(201);
  assert.equal((await Payee.findById(payeeId)).duePoisha, 100000);

  // A purchase due has to come from a purchase; typing one would invent a debt.
  const refused = await api
    .post(`/api/owner/payees/${payeeId}/ledger`)
    .send({ kind: PAYEE_LEDGER_KIND.PURCHASE, amount: 500, nonce: nonce() });
  assert.equal(refused.status, 400);
});

/* ----------------------------------------------------------------- purchases */

test('cancelling a purchase through the API reverses both sides', async () => {
  const { api, crateId, payeeId } = await setup();

  const created = await api
    .post('/api/owner/purchases')
    .send({ payeeId, lines: [{ supplyId: crateId, quantity: 50, unitCost: 80 }] })
    .expect(201);
  const id = created.body.data.purchase.id;

  await api.post(`/api/owner/purchases/${id}/cancel`).send({ reason: 'wrong seller' }).expect(200);

  assert.equal((await Supply.findById(crateId)).onHandMilli, 0);
  assert.equal((await Payee.findById(payeeId)).duePoisha, 0);

  // A second cancel is refused rather than reversing twice.
  const again = await api.post(`/api/owner/purchases/${id}/cancel`).send({ reason: 'again' });
  assert.equal(again.status, 409);
});

test('a purchase list reports what was spent, ignoring cancelled ones', async () => {
  const { api, crateId, payeeId } = await setup();

  const a = await api
    .post('/api/owner/purchases')
    .send({ payeeId, lines: [{ supplyId: crateId, quantity: 10, unitCost: 80 }] });
  await api
    .post('/api/owner/purchases')
    .send({ payeeId, lines: [{ supplyId: crateId, quantity: 10, unitCost: 90 }] });
  await api
    .post(`/api/owner/purchases/${a.body.data.purchase.id}/cancel`)
    .send({ reason: 'undone' });

  const list = await api.get('/api/owner/purchases').expect(200);
  assert.equal(list.body.data.total, 2, 'both are listed');
  // Only the live one is counted: a cancelled purchase was undone.
  assert.equal(list.body.data.totals.spent, 900);
});

/* ------------------------------------------------------------------ expenses */

test('the six categories seed once and are idempotent', async () => {
  const { api } = await setup();

  const first = await api.post('/api/owner/expense-categories/seed').expect(200);
  assert.equal(first.body.data.created, 6);

  const second = await api.post('/api/owner/expense-categories/seed').expect(200);
  assert.equal(second.body.data.created, 0);
  assert.equal(await ExpenseCategory.countDocuments({}), 6);

  const labour = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });
  assert.equal(labour.scope, CATEGORY_SCOPE.PERIOD);
  const courier = await ExpenseCategory.findOne({ nameBn: 'কুরিয়ার খরচ' });
  assert.equal(courier.scope, CATEGORY_SCOPE.ORDER);
});

test('a period category cannot be filed against an order, and vice versa', async () => {
  const { api } = await setup();
  await api.post('/api/owner/expense-categories/seed');

  const labour = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });
  const courier = await ExpenseCategory.findOne({ nameBn: 'কুরিয়ার খরচ' });

  const { profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1 });
  await f.listProduct(profile, product, 60);
  const { order } = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode: PAYMENT_MODE.PREPAID,
    customer: {
      name: 'Customer',
      phoneE164: '+8801912345678',
      address: '12 Test Road',
      district: 'Dhaka',
    },
    items: [{ product: product._id, variant: product.variants[0]._id, qty: 1 }],
  });

  // লেবার is a day's cost. Attaching it to one parcel would invent a number.
  const wrong = await api
    .post('/api/owner/expenses')
    .send({ categoryId: labour._id, amount: 500, orderId: order._id });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'WRONG_EXPENSE_SCOPE');

  // And a courier charge belongs to a parcel, not to a day.
  const alsoWrong = await api
    .post('/api/owner/expenses')
    .send({ categoryId: courier._id, amount: 120 });
  assert.equal(alsoWrong.status, 400);

  // Each in its right place.
  await api.post('/api/owner/expenses').send({ categoryId: labour._id, amount: 500 }).expect(201);
  await api
    .post('/api/owner/expenses')
    .send({ categoryId: courier._id, amount: 120, orderId: order._id })
    .expect(201);
});

test('an unpaid expense raises a due, and voiding it takes the due back', async () => {
  const { api, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const category = await ExpenseCategory.findOne({ nameBn: 'পরিবহন খরচ' });

  const created = await api
    .post('/api/owner/expenses')
    .send({ categoryId: category._id, amount: 900, payeeId, paymentStatus: 'unpaid' })
    .expect(201);

  assert.equal((await Payee.findById(payeeId)).duePoisha, 90000);

  await api
    .post(`/api/owner/expenses/${created.body.data.expense.id}/void`)
    .send({ reason: 'entered twice' })
    .expect(200);

  assert.equal((await Payee.findById(payeeId)).duePoisha, 0);
  // Voided, not deleted: a printed month must not change behind the paper.
  const row = await Expense.findById(created.body.data.expense.id);
  assert.ok(row.voidedAt);
  // And hidden from the running total by default.
  const list = await api.get('/api/owner/expenses').expect(200);
  assert.equal(list.body.data.total, 0);
  assert.equal((await api.get('/api/owner/expenses?includeVoided=true')).body.data.total, 1);
});

test('an unpaid expense owed to nobody is refused', async () => {
  const { api } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const category = await ExpenseCategory.findOne({ nameBn: 'অন্যান্য' });

  const res = await api
    .post('/api/owner/expenses')
    .send({ categoryId: category._id, amount: 100, paymentStatus: 'unpaid' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'PAYEE_REQUIRED');
});

/* ------------------------------------------------------------------- recipes */

test('a packaging recipe is set per box and refuses a duplicate supply', async () => {
  const { api, crateId } = await setup();
  const paper = await api.post('/api/owner/supplies').send({ nameBn: 'কাগজ', unit: 'sheet' });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1 });
  const variantId = product.variants[0]._id;

  const set = await api
    .put(`/api/owner/products/${product._id}/variants/${variantId}/packaging`)
    .send({
      packaging: [
        { supplyId: crateId, quantity: 1 },
        // Fractional: an 11 kg box takes about one and a half sheets.
        { supplyId: paper.body.data.supply.id, quantity: 1.5 },
      ],
    })
    .expect(200);

  assert.equal(set.body.data.packaging.length, 2);
  assert.equal(set.body.data.packaging[1].quantity, 1.5);

  const saved = await Product.findById(product._id);
  assert.equal(saved.variants[0].packaging.length, 2);
  assert.equal(saved.variants[0].packaging[1].qtyMilli, 1500);

  // The same supply twice is the owner having picked it twice, not a sum.
  const dup = await api
    .put(`/api/owner/products/${product._id}/variants/${variantId}/packaging`)
    .send({ packaging: [{ supplyId: crateId, quantity: 1 }, { supplyId: crateId, quantity: 2 }] });
  assert.equal(dup.status, 400);

  // An empty list is meaningful: this box is not counted.
  await api
    .put(`/api/owner/products/${product._id}/variants/${variantId}/packaging`)
    .send({ packaging: [] })
    .expect(200);
  assert.equal((await Product.findById(product._id)).variants[0].packaging.length, 0);
  assert.ok(await AuditLog.findOne({ action: 'product.setRecipe' }));
});

test('a recipe cannot name an archived supply', async () => {
  const { api, crateId } = await setup();
  await api.delete(`/api/owner/supplies/${crateId}`);
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1 });

  const res = await api
    .put(`/api/owner/products/${product._id}/variants/${product.variants[0]._id}/packaging`)
    .send({ packaging: [{ supplyId: crateId, quantity: 1 }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'SUPPLY_ARCHIVED');
});

/* ------------------------------------------------------------------- reports */

test('the profit report equals revenue minus every cost', async () => {
  const { api, crateId, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');

  // Crates on the shelf at a known landed cost: 100 at 80 plus 800 of charges.
  await api.post('/api/owner/purchases').send({
    payeeId,
    lines: [{ supplyId: crateId, quantity: 100, unitCost: 80 }],
    charges: [{ kind: 'transport', amount: 800 }],
  });

  const owner = await f.makeOwner();
  const { user, profile } = await f.makeReseller({ creditLimit: 1000000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const source = await f.makeSource();
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1 });
  await f.listProduct(profile, product, 60);
  await api
    .put(`/api/owner/products/${product._id}/variants/${product.variants[0]._id}/packaging`)
    .send({ packaging: [{ supplyId: crateId, quantity: 1 }] });

  const { order } = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode: PAYMENT_MODE.PREPAID,
    customer: {
      name: 'Customer',
      phoneE164: '+8801912345678',
      address: '12 Test Road',
      district: 'Dhaka',
    },
    items: [{ product: product._id, variant: product.variants[0]._id, qty: 2 }],
  });

  await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });
  const ownerApi = as(owner.user);
  const current = await Order.findById(order._id);
  await ownerApi
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: f.sourcesFor(current, source) });
  await ownerApi.post(`/api/owner/orders/${order._id}/pack`).send({});
  await ownerApi.post(`/api/owner/orders/${order._id}/ship`).send({ courierName: 'Sundarban' });
  await ownerApi.post(`/api/owner/orders/${order._id}/deliver`).send({});

  // A courier bill against this parcel, and a day of labour against nothing.
  const courier = await ExpenseCategory.findOne({ nameBn: 'কুরিয়ার খরচ' });
  const labour = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });
  await api
    .post('/api/owner/expenses')
    .send({ categoryId: courier._id, amount: 60, orderId: order._id });
  await api.post('/api/owner/expenses').send({ categoryId: labour._id, amount: 500 });

  const report = (await api.get('/api/owner/reports/profit').expect(200)).body.data;
  const t = report.totals;

  // 2 boxes at cost 55 = 110, plus 80 delivery = 190 billed.
  assert.equal(t.revenue, 190);
  assert.equal(t.goods, 110);
  // Two crates at the landed 88.
  assert.equal(t.packaging, 176);
  assert.equal(t.orderExpenses, 60);
  assert.equal(t.orderCost, 110 + 176 + 60);
  assert.equal(t.grossMargin, 190 - 346);
  // লেবার is subtracted once, at the period level, and never split per parcel.
  assert.equal(t.periodExpenses, 500);
  assert.equal(t.netProfit, t.grossMargin - t.periodExpenses);

  // The identity the whole report rests on.
  assert.equal(t.netProfit, t.revenue - t.orderCost - t.periodExpenses);

  // The delivery figures sit side by side rather than being netted for us.
  assert.equal(t.deliveryCharged, 80);

  // And the order screen agrees with the report about this parcel.
  const detail = (await ownerApi.get(`/api/owner/orders/${order._id}`).expect(200)).body.data;
  assert.equal(detail.cost.packaging, 176);
  assert.equal(detail.cost.expenses, 60);
  assert.equal(detail.cost.margin, 190 - 346);
  assert.equal(detail.order.packagingCost, 176);
});

test('the payables report keeps dues and advances apart', async () => {
  const { api, crateId, payeeId } = await setup();
  const other = await api.post('/api/owner/payees').send({ nameBn: 'অগ্রিম', kind: 'labour' });

  await api
    .post('/api/owner/purchases')
    .send({ payeeId, lines: [{ supplyId: crateId, quantity: 10, unitCost: 80 }] });
  await api
    .post(`/api/owner/payees/${other.body.data.payee.id}/payments`)
    .send({ amount: 300, nonce: nonce() });

  const report = (await api.get('/api/owner/reports/payables').expect(200)).body.data;
  assert.equal(report.payables.length, 1);
  assert.equal(report.totals.due, 800);
  assert.equal(report.advances.length, 1);
  assert.equal(report.totals.advance, 300);
  // Never netted into one figure: they are different people's money.
  assert.notEqual(report.totals.due, 500);
});

test('receivable and payable are reported side by side, never netted', async () => {
  const { api, crateId, payeeId } = await setup();
  await api
    .post('/api/owner/purchases')
    .send({ payeeId, lines: [{ supplyId: crateId, quantity: 10, unitCost: 80 }] });

  const position = (await api.get('/api/owner/reports/position').expect(200)).body.data;
  assert.equal(position.payable, 800);
  assert.equal(position.receivable, 0);
  assert.ok(!('net' in position), 'there is deliberately no net figure');
});

test('the supply and expense reports answer, and the CSVs stream', async () => {
  const { api, crateId, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const category = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });

  await api
    .post('/api/owner/purchases')
    .send({ payeeId, lines: [{ supplyId: crateId, quantity: 100, unitCost: 80 }] });
  await api.post('/api/owner/expenses').send({ categoryId: category._id, amount: 500 });

  const supplies = (await api.get('/api/owner/reports/supplies').expect(200)).body.data;
  assert.equal(supplies.supplies[0].onHand, 100);
  assert.equal(supplies.totals.value, 8000);

  const purchases = (await api.get('/api/owner/reports/purchases').expect(200)).body.data;
  assert.equal(purchases.totals.spent, 8000);
  assert.equal(purchases.bySupply[0].avgLandedUnitCost, 80);

  const expenses = (await api.get('/api/owner/reports/expenses').expect(200)).body.data;
  assert.equal(expenses.totals.period, 500);
  assert.equal(expenses.totals.order, 0);

  const purchaseCsv = await api.get('/api/owner/exports/purchases.csv').expect(200);
  assert.match(purchaseCsv.headers['content-type'], /text\/csv/);
  assert.match(purchaseCsv.text, /landedUnitCost/);
  assert.match(purchaseCsv.text, /ক্যারেট/);

  const expenseCsv = await api.get('/api/owner/exports/expenses.csv').expect(200);
  assert.match(expenseCsv.text, /লেবার খরচ/);
});

test('the packaging estimate endpoint answers before anything is deducted', async () => {
  const { api, crateId } = await setup();
  await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.OPENING, quantity: 1, nonce: nonce() });

  const owner = await f.makeOwner();
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1 });
  await f.listProduct(profile, product, 60);
  await api
    .put(`/api/owner/products/${product._id}/variants/${product.variants[0]._id}/packaging`)
    .send({ packaging: [{ supplyId: crateId, quantity: 1 }] });

  const { order } = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode: PAYMENT_MODE.PREPAID,
    customer: {
      name: 'Customer',
      phoneE164: '+8801912345678',
      address: '12 Test Road',
      district: 'Dhaka',
    },
    items: [{ product: product._id, variant: product.variants[0]._id, qty: 3 }],
  });
  await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });

  const est = (
    await as(owner.user).get(`/api/owner/orders/${order._id}/packaging-estimate`).expect(200)
  ).body.data;

  assert.equal(est.isEstimated, true);
  assert.equal(est.isRecorded, false, 'nothing deducted yet');
  assert.equal(est.rows[0].quantity, 3);
  // One on the shelf, three needed: said out loud, well before the packing table.
  assert.equal(est.shortages.length, 1);
  assert.equal(est.shortages[0].short, 2);
});

test('a reseller cannot reach any of the cost side', async () => {
  const { crateId } = await setup();
  const { user } = await f.makeReseller();
  const api = as(user);

  for (const url of [
    '/api/owner/supplies',
    '/api/owner/payees',
    '/api/owner/purchases',
    '/api/owner/expenses',
    '/api/owner/reports/profit',
    '/api/owner/reports/payables',
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await api.get(url);
    assert.equal(res.status, 403, `${url} must refuse a reseller`);
  }

  const write = await api
    .post(`/api/owner/supplies/${crateId}/adjust`)
    .send({ kind: MOVEMENT_KIND.DAMAGED, quantity: 1, nonce: nonce() });
  assert.equal(write.status, 403);
});
