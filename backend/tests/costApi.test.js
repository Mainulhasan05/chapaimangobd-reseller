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
const PayeeLedgerEntry = require('../src/models/PayeeLedgerEntry');
const Purchase = require('../src/models/Purchase');

const { toMilli } = require('../src/utils/quantity');
const { businessDate } = require('../src/utils/dhakaTime');
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

/* ------------------------------------------------------------ PLAN-4 §4.2 */

const dayOffset = (days) => businessDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

/** A purchase of `quantity` crates at `unitCost` from `payeeId`. */
const buy = (api, { payeeId, crateId, quantity = 10, unitCost = 80, date }) =>
  api
    .post('/api/owner/purchases')
    .send({
      payeeId,
      lines: [{ supplyId: crateId, quantity, unitCost }],
      ...(date ? { date } : {}),
    })
    .expect(201)
    .then((res) => res.body.data.purchase);

const newPayee = (api, nameBn) =>
  api
    .post('/api/owner/payees')
    .send({ nameBn })
    .then((res) => res.body.data.payee.id);

test('the purchase totals are over the whole filter, not the page on screen', async () => {
  const { api, crateId, payeeId } = await setup();
  const other = await newPayee(api, 'অন্য দোকান');

  await buy(api, { payeeId, crateId, quantity: 10, unitCost: 80 });
  await buy(api, { payeeId, crateId, quantity: 10, unitCost: 90 });
  const undone = await buy(api, { payeeId, crateId, quantity: 10, unitCost: 100 });
  await buy(api, { payeeId: other, crateId, quantity: 1, unitCost: 50 });
  await api.post(`/api/owner/purchases/${undone.id}/cancel`).send({ reason: 'undone' });

  const page = (await api.get('/api/owner/purchases?limit=1&page=2').expect(200)).body.data;
  assert.equal(page.purchases.length, 1);
  assert.equal(page.total, 4);
  // 800 + 900 + 50: every received purchase, not the one row on this page.
  assert.equal(page.totals.spent, 1750);
  assert.equal(page.totals.goodsCost, 1750);
  assert.equal(page.totals.billedByPayees, 1750);

  const seller = (await api.get(`/api/owner/purchases?limit=1&payeeId=${payeeId}`)).body.data;
  assert.equal(seller.total, 3);
  assert.equal(seller.totals.spent, 1700);

  const cancelled = (await api.get('/api/owner/purchases?status=cancelled')).body.data;
  assert.equal(cancelled.total, 1);
  assert.equal(cancelled.totals.spent, 0, 'listed, never counted');
});

test('the expense totals are over the whole filter, and never count a voided one', async () => {
  const { api, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const labour = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });
  const transport = await ExpenseCategory.findOne({ nameBn: 'পরিবহন খরচ' });

  await api.post('/api/owner/expenses').send({ categoryId: labour._id, amount: 500 });
  await api.post('/api/owner/expenses').send({ categoryId: labour._id, amount: 300 });
  await api
    .post('/api/owner/expenses')
    .send({ categoryId: transport._id, amount: 200, payeeId, paymentStatus: 'unpaid' });
  const wrong = await api
    .post('/api/owner/expenses')
    .send({ categoryId: transport._id, amount: 999 });
  await api
    .post(`/api/owner/expenses/${wrong.body.data.expense.id}/void`)
    .send({ reason: 'typed twice' });

  const page = (await api.get('/api/owner/expenses?limit=1').expect(200)).body.data;
  assert.equal(page.expenses.length, 1);
  assert.equal(page.total, 3);
  assert.equal(page.totals.all, 1000);
  assert.equal(page.totals.period, 1000);
  assert.equal(page.totals.order, 0);
  assert.equal(page.totals.unpaid, 200);

  const withVoided = (await api.get('/api/owner/expenses?limit=1&includeVoided=true')).body.data;
  assert.equal(withVoided.total, 4, 'the voided one is listed when asked for');
  assert.equal(withVoided.totals.all, 1000, 'and still never counted');

  const one = (await api.get(`/api/owner/expenses?categoryId=${labour._id}&limit=1`)).body.data;
  assert.equal(one.totals.all, 800);
});

test('a wrong payment is reversed once, with its reason, and the due goes back', async () => {
  const { api, crateId, payeeId } = await setup();
  await buy(api, { payeeId, crateId, quantity: 10, unitCost: 80 });

  const paid = await api
    .post(`/api/owner/payees/${payeeId}/payments`)
    .send({ amount: 500, nonce: nonce(), paidFrom: 'cash' })
    .expect(201);
  const paymentId = paid.body.data.entry.id;
  assert.equal(paid.body.data.payee.due, 300);

  const noReason = await api
    .post(`/api/owner/payees/${payeeId}/ledger/${paymentId}/reverse`)
    .send({});
  assert.equal(noReason.status, 400);

  const reversed = await api
    .post(`/api/owner/payees/${payeeId}/ledger/${paymentId}/reverse`)
    .send({ reason: 'paid the wrong seller' })
    .expect(201);
  const body = reversed.body.data;
  assert.equal(body.payee.due, 800, 'the due is back where it was before the payment');
  assert.equal(body.entry.kind, PAYEE_LEDGER_KIND.REVERSAL);
  assert.equal(body.entry.amount, 500);
  assert.equal(body.entry.reversalOf, paymentId);
  assert.equal(body.entry.note, 'paid the wrong seller');
  assert.equal(body.entry.reversible, false, 'a reversal is never itself reversed');
  assert.equal(body.reversed.id, paymentId);
  assert.equal(body.reversed.reversedBy, body.entry.id);
  assert.equal(body.reversed.reversible, false);
  assert.equal(body.reopenedExpenseId, null);

  // The original is untouched: append-only.
  const original = await PayeeLedgerEntry.findById(paymentId);
  assert.equal(original.amountPoisha, -50000);

  const twice = await api
    .post(`/api/owner/payees/${payeeId}/ledger/${paymentId}/reverse`)
    .send({ reason: 'again' });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error.code, 'ALREADY_REVERSED');
  assert.equal((await Payee.findById(payeeId)).duePoisha, 80000);

  const health = (await api.get(`/api/owner/payees/${payeeId}`)).body.data.health;
  assert.equal(health.ok, true, 'the ledger still reconciles');
  assert.ok(await AuditLog.findOne({ action: 'payee.reverse' }));
});

test('only a payment or a hand-typed entry can be reversed from the ledger', async () => {
  const { api, crateId, payeeId } = await setup();
  await buy(api, { payeeId, crateId });
  await api
    .post(`/api/owner/payees/${payeeId}/ledger`)
    .send({ kind: PAYEE_LEDGER_KIND.OPENING, amount: 1200, nonce: nonce() });

  const ledger = (await api.get(`/api/owner/payees/${payeeId}/ledger`)).body.data.ledger;
  const purchaseRow = ledger.find((e) => e.kind === PAYEE_LEDGER_KIND.PURCHASE);
  const openingRow = ledger.find((e) => e.kind === PAYEE_LEDGER_KIND.OPENING);
  assert.equal(purchaseRow.reversible, false);
  assert.equal(openingRow.reversible, true);

  // A purchase is cancelled, never reversed out from under itself. docs/adr/0024.
  const purchase = await api
    .post(`/api/owner/payees/${payeeId}/ledger/${purchaseRow.id}/reverse`)
    .send({ reason: 'not this way' });
  assert.equal(purchase.status, 400);
  assert.equal(purchase.body.error.code, 'ENTRY_NOT_REVERSIBLE');

  await api
    .post(`/api/owner/payees/${payeeId}/ledger/${openingRow.id}/reverse`)
    .send({ reason: 'opening was wrong' })
    .expect(201);
  assert.equal((await Payee.findById(payeeId)).duePoisha, 80000);

  // The reversal row it produced cannot be reversed either.
  const reversal = await PayeeLedgerEntry.findOne({ reversalOf: openingRow.id });
  const ofReversal = await api
    .post(`/api/owner/payees/${payeeId}/ledger/${reversal._id}/reverse`)
    .send({ reason: 'undo the undo' });
  assert.equal(ofReversal.status, 400);
  assert.equal(ofReversal.body.error.code, 'ENTRY_NOT_REVERSIBLE');

  // Another payee's entry is not found under this one.
  const other = await newPayee(api, 'অন্য');
  const foreign = await api
    .post(`/api/owner/payees/${other}/ledger/${openingRow.id}/reverse`)
    .send({ reason: 'wrong payee' });
  assert.equal(foreign.status, 404);
});

test('a payment carries the day it was made, never a day still to come', async () => {
  const { api, crateId, payeeId } = await setup();
  const purchase = await buy(api, { payeeId, crateId, date: dayOffset(-5) });

  const yesterday = dayOffset(-1);
  const paid = await api
    .post(`/api/owner/payees/${payeeId}/payments`)
    .send({ amount: 100, nonce: nonce(), date: yesterday })
    .expect(201);
  assert.equal(paid.body.data.entry.businessDate, yesterday);

  const future = await api
    .post(`/api/owner/payees/${payeeId}/payments`)
    .send({ amount: 100, nonce: nonce(), date: dayOffset(1) });
  assert.equal(future.status, 400);
  assert.equal(future.body.error.code, 'VALIDATION_FAILED');
  assert.ok(future.body.error.fields.date);

  const notADay = await api
    .post(`/api/owner/payees/${payeeId}/payments`)
    .send({ amount: 100, nonce: nonce(), date: '2026-02-31' });
  assert.equal(notADay.status, 400);

  // Without a date it is today's. Ledger rows say which day each belongs to and
  // what it points at, in words the seller recognises.
  await api.post(`/api/owner/payees/${payeeId}/payments`).send({ amount: 50, nonce: nonce() });
  const rows = (await api.get(`/api/owner/payees/${payeeId}/ledger`)).body.data.ledger;
  const [today, back, bought] = rows;
  assert.equal(today.businessDate, businessDate());
  assert.equal(back.businessDate, yesterday);
  assert.equal(bought.businessDate, dayOffset(-5), 'the day the goods came in');
  assert.deepEqual(bought.reference, {
    type: 'purchase',
    id: purchase.id,
    label: purchase.purchaseCode,
    cancelled: false,
  });
  assert.equal(today.reference, null);
});

test('a payee detail counts every purchase, not only the ten it shows', async () => {
  const { api, crateId, payeeId } = await setup();
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await buy(api, { payeeId, crateId, quantity: 1, unitCost: 10 });
  }
  const first = await Purchase.findOne({ payee: payeeId });
  await api.post(`/api/owner/purchases/${first._id}/cancel`).send({ reason: 'undone' });

  const detail = (await api.get(`/api/owner/payees/${payeeId}`).expect(200)).body.data;
  assert.equal(detail.purchases.length, 10);
  assert.equal(detail.purchaseCount, 12);
  assert.equal(detail.expenseCount, 0);
  // The "see all" link lands on exactly that many.
  const list = (await api.get(`/api/owner/purchases?payeeId=${payeeId}`)).body.data;
  assert.equal(list.total, detail.purchaseCount);
});

test("an archived payee's due stays in the totals and is broken out", async () => {
  const { api, crateId, payeeId } = await setup();
  const gone = await newPayee(api, 'পুরনো ভ্যান');
  const ahead = await newPayee(api, 'বায়না');

  await buy(api, { payeeId, crateId, quantity: 10, unitCost: 80 });
  await api
    .post(`/api/owner/payees/${gone}/ledger`)
    .send({ kind: PAYEE_LEDGER_KIND.OPENING, amount: 300, nonce: nonce() });
  await api.post(`/api/owner/payees/${ahead}/payments`).send({ amount: 200, nonce: nonce() });
  await api.delete(`/api/owner/payees/${gone}`).expect(200);
  await api.delete(`/api/owner/payees/${ahead}`).expect(200);

  const list = (await api.get('/api/owner/payees').expect(200)).body.data;
  assert.deepEqual(
    list.payees.map((p) => p.id),
    [payeeId],
    'archived ones are not listed'
  );
  assert.equal(list.totals.count, 1);
  // Still owed, so still in the total: archiving is not settling.
  assert.equal(list.totals.due, 1100);
  assert.equal(list.totals.owingCount, 2);
  assert.equal(list.totals.advance, 200);
  assert.equal(list.totals.archivedDue, 300);
  assert.equal(list.totals.archivedAdvance, 200);
  assert.equal(list.totals.archivedOwingCount, 1);
  assert.equal(list.totals.archivedCount, 2);

  // The same figure the payables report has always given.
  const payables = (await api.get('/api/owner/reports/payables')).body.data;
  assert.equal(payables.totals.due, list.totals.due);

  const all = (await api.get('/api/owner/payees?includeArchived=true').expect(200)).body.data;
  assert.equal(all.payees.length, 3);
  assert.equal(all.totals.due, 1100);
});

test('marking an unpaid expense paid posts the payment and flips it, once', async () => {
  const { api, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const transport = await ExpenseCategory.findOne({ nameBn: 'পরিবহন খরচ' });

  const created = await api
    .post('/api/owner/expenses')
    .send({ categoryId: transport._id, amount: 900, payeeId, paymentStatus: 'unpaid' })
    .expect(201);
  const id = created.body.data.expense.id;
  assert.equal((await Payee.findById(payeeId)).duePoisha, 90000);

  const noMethod = await api.post(`/api/owner/expenses/${id}/mark-paid`).send({});
  assert.equal(noMethod.status, 400);

  const marked = await api
    .post(`/api/owner/expenses/${id}/mark-paid`)
    .send({ paidFrom: 'bkash' })
    .expect(200);
  const expense = marked.body.data.expense;
  assert.equal(expense.paymentStatus, 'paid');
  assert.equal(expense.paidFrom, 'bkash');
  assert.ok(expense.paidAt);
  assert.ok(expense.paymentEntry);
  assert.equal((await Payee.findById(payeeId)).duePoisha, 0, 'the payment is on the ledger');

  // Two facts, two entries: the bill, and then its payment.
  const payment = await PayeeLedgerEntry.findById(expense.paymentEntry);
  assert.equal(payment.kind, PAYEE_LEDGER_KIND.PAYMENT);
  assert.equal(payment.amountPoisha, -90000);
  assert.equal(String(payment.refId), id);
  const row = (await api.get(`/api/owner/payees/${payeeId}/ledger`)).body.data.ledger[0];
  assert.equal(row.reference.type, 'expense');
  assert.equal(row.reference.label, 'পরিবহন খরচ');

  const twice = await api.post(`/api/owner/expenses/${id}/mark-paid`).send({ paidFrom: 'cash' });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error.code, 'ALREADY_PAID');
  assert.equal((await Payee.findById(payeeId)).duePoisha, 0);
  assert.ok(await AuditLog.findOne({ action: 'expense.markPaid' }));

  // Reversing the payment puts the bill back to unpaid, and it can be settled again.
  const reversed = await api
    .post(`/api/owner/payees/${payeeId}/ledger/${expense.paymentEntry}/reverse`)
    .send({ reason: 'marked paid by mistake' })
    .expect(201);
  assert.equal(reversed.body.data.reopenedExpenseId, id);
  const reopened = await Expense.findById(id);
  assert.equal(reopened.paymentStatus, 'unpaid');
  assert.equal(reopened.paymentEntry, null);
  assert.equal((await Payee.findById(payeeId)).duePoisha, 90000);

  await api.post(`/api/owner/expenses/${id}/mark-paid`).send({ paidFrom: 'cash' }).expect(200);
  assert.equal((await Payee.findById(payeeId)).duePoisha, 0, 'a new payment, not the old one');
  assert.equal(
    await PayeeLedgerEntry.countDocuments({ payee: payeeId, kind: PAYEE_LEDGER_KIND.PAYMENT }),
    2
  );
});

test('a paid or voided expense cannot be marked paid', async () => {
  const { api, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const labour = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });

  const paid = await api.post('/api/owner/expenses').send({ categoryId: labour._id, amount: 400 });
  const already = await api
    .post(`/api/owner/expenses/${paid.body.data.expense.id}/mark-paid`)
    .send({ paidFrom: 'cash' });
  assert.equal(already.status, 409);
  assert.equal(already.body.error.code, 'ALREADY_PAID');

  const unpaid = await api
    .post('/api/owner/expenses')
    .send({ categoryId: labour._id, amount: 400, payeeId, paymentStatus: 'unpaid' });
  const unpaidId = unpaid.body.data.expense.id;
  await api.post(`/api/owner/expenses/${unpaidId}/void`).send({ reason: 'never happened' });

  const voided = await api
    .post(`/api/owner/expenses/${unpaidId}/mark-paid`)
    .send({ paidFrom: 'cash' });
  assert.equal(voided.status, 409);
  assert.equal(voided.body.error.code, 'EXPENSE_VOIDED');
  assert.equal((await Payee.findById(payeeId)).duePoisha, 0, 'nothing was paid');
});

test('voiding a settled expense leaves the payment standing as an advance', async () => {
  const { api, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const labour = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });

  const created = await api
    .post('/api/owner/expenses')
    .send({ categoryId: labour._id, amount: 600, payeeId, paymentStatus: 'unpaid' });
  const id = created.body.data.expense.id;
  await api.post(`/api/owner/expenses/${id}/mark-paid`).send({ paidFrom: 'cash' }).expect(200);
  await api.post(`/api/owner/expenses/${id}/void`).send({ reason: 'billed to the wrong day' });

  // The bill went away; the cash that left did not. docs/adr/0002.
  const payee = (await api.get(`/api/owner/payees/${payeeId}`)).body.data.payee;
  assert.equal(payee.due, -600);
  assert.equal(payee.isAdvance, true);
});

test('the purchase sheet takes the list filters and itemises the purchases', async () => {
  const { api, crateId, payeeId } = await setup();
  const other = await newPayee(api, 'অন্য দোকান');

  const a = await buy(api, { payeeId, crateId, quantity: 10, unitCost: 80, date: dayOffset(-2) });
  const undone = await buy(api, { payeeId, crateId, quantity: 5, unitCost: 80 });
  await buy(api, { payeeId: other, crateId, quantity: 1, unitCost: 50 });
  await api.post(`/api/owner/purchases/${undone.id}/cancel`).send({ reason: 'undone' });

  const report = (await api.get(`/api/owner/reports/purchases?payeeId=${payeeId}`).expect(200))
    .body.data;
  assert.equal(report.totals.purchases, 1, 'cancelled ones are never counted');
  assert.equal(report.totals.spent, 800);
  assert.equal(report.byPayee.length, 1);
  assert.equal(report.rowCount, 2);
  assert.equal(report.truncated, false);
  // Oldest first, cancelled listed with its status, as the list shows it.
  assert.deepEqual(
    report.rows.map((r) => [r.purchaseCode, r.status]),
    [
      [a.purchaseCode, 'received'],
      [undone.purchaseCode, 'cancelled'],
    ]
  );
  const row = report.rows[0];
  assert.equal(row.businessDate, dayOffset(-2));
  assert.equal(row.payeeId, payeeId);
  assert.equal(row.payeeNameBn, 'করিম ক্যারেট স্টোর');
  assert.equal(row.spent, 800);
  assert.equal(row.billed, 800);
  assert.deepEqual(row.supplies, ['ক্যারেট']);

  const received = (await api.get('/api/owner/reports/purchases?status=received')).body.data;
  assert.equal(received.rows.length, 2);
  assert.equal(received.totals.spent, 850);

  const capped = (await api.get('/api/owner/reports/purchases?max=1')).body.data;
  assert.equal(capped.rows.length, 1);
  assert.equal(capped.rowCount, 3);
  assert.equal(capped.truncated, true, 'a short sheet says it is short');

  const bad = await api.get('/api/owner/reports/purchases?status=lost');
  assert.equal(bad.status, 400);

  // The download takes the same filter.
  const csv = await api.get(`/api/owner/exports/purchases.csv?payeeId=${other}`).expect(200);
  assert.match(csv.text, /অন্য দোকান/);
  assert.doesNotMatch(csv.text, /করিম ক্যারেট স্টোর/);
});

test('the expense sheet takes the list filters and itemises the expenses', async () => {
  const { api, payeeId } = await setup();
  await api.post('/api/owner/expense-categories/seed');
  const labour = await ExpenseCategory.findOne({ nameBn: 'লেবার খরচ' });
  const transport = await ExpenseCategory.findOne({ nameBn: 'পরিবহন খরচ' });

  await api
    .post('/api/owner/expenses')
    .send({ categoryId: labour._id, amount: 500, date: dayOffset(-1), note: 'two hands' });
  await api
    .post('/api/owner/expenses')
    .send({ categoryId: transport._id, amount: 200, payeeId, paymentStatus: 'unpaid' });
  const wrong = await api.post('/api/owner/expenses').send({ categoryId: labour._id, amount: 999 });
  await api
    .post(`/api/owner/expenses/${wrong.body.data.expense.id}/void`)
    .send({ reason: 'typed twice' });

  const all = (await api.get('/api/owner/reports/expenses').expect(200)).body.data;
  assert.equal(all.totals.all, 700);
  assert.equal(all.rows.length, 2, 'a voided expense is never on the sheet');
  const [first, second] = all.rows;
  assert.equal(first.businessDate, dayOffset(-1));
  assert.equal(first.categoryNameBn, 'লেবার খরচ');
  assert.equal(first.scope, 'period');
  assert.equal(first.amount, 500);
  assert.equal(first.note, 'two hands');
  assert.equal(first.payeeNameBn, null);
  assert.equal(second.payeeId, payeeId);
  assert.equal(second.paymentStatus, 'unpaid');

  const byCategory = (await api.get(`/api/owner/reports/expenses?categoryId=${labour._id}`)).body
    .data;
  assert.equal(byCategory.totals.all, 500);
  assert.equal(byCategory.rows.length, 1);
  assert.equal(byCategory.byCategory.length, 1);

  const unpaid = (await api.get('/api/owner/reports/expenses?paymentStatus=unpaid')).body.data;
  assert.equal(unpaid.totals.all, 200);
  assert.equal(unpaid.totals.unpaid, 200);

  const orderScope = (await api.get('/api/owner/reports/expenses?scope=order')).body.data;
  assert.equal(orderScope.totals.all, 0);
  assert.equal(orderScope.rows.length, 0);

  const csv = await api.get('/api/owner/exports/expenses.csv?paymentStatus=unpaid').expect(200);
  assert.match(csv.text, /পরিবহন খরচ/);
  assert.doesNotMatch(csv.text, /লেবার খরচ/);
});
