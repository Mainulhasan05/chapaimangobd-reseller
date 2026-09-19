'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const ResellerProfile = require('../src/models/ResellerProfile');
const Order = require('../src/models/Order');
const Deposit = require('../src/models/Deposit');
const ResellerProduct = require('../src/models/ResellerProduct');
const LedgerEntry = require('../src/models/LedgerEntry');
const otp = require('../src/services/otp');

const { toPoisha, toTaka } = require('../src/utils/money');
const { KYC_STATUS, PAYMENT_MODE, REVIEW_STATUS } = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

/** Signs an existing account in and returns a cookie-carrying agent. */
async function signIn({ phone, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

test('the owner can see which integrations are wired up', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn({ phone: owner.phone, password: owner.password });
  const res = await agent.get('/api/owner/system/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'up');
  assert.equal(res.body.data.db, 'up');
  assert.equal(typeof res.body.data.integrations.sms, 'boolean');
});

/** Registration proves the phone first (docs/adr/0014); this fetches the code. */
async function registrationCode(phone) {
  const sent = await request(app).post('/api/auth/register/otp').send({ phone });
  assert.equal(sent.status, 200, `otp failed: ${JSON.stringify(sent.body)}`);
  const { normalizeBdPhone } = require('../src/utils/phone');
  return otp.__lastCodeFor(normalizeBdPhone(phone), 'register');
}

test('registration creates a reseller with a slug and an unverified status', async () => {
  const phone = f.nextPhone();
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Rifat Mango Ghor', phone, password: 'password123', otp: await registrationCode(phone) });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.role, 'reseller');
  assert.equal(res.body.data.profile.kycStatus, KYC_STATUS.NOT_SUBMITTED);
  assert.equal(res.body.data.profile.slug, 'rifat-mango-ghor');
  // The hash must never reach the client.
  assert.equal(res.body.data.user.passwordHash, undefined);
});

test('the same phone cannot register twice, in any format', async () => {
  const phone = '01712345678';
  const first = await request(app)
    .post('/api/auth/register')
    .send({ name: 'First', phone, password: 'password123', otp: await registrationCode(phone) });
  assert.equal(first.status, 201);

  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Second', phone: '+880 1712-345678', password: 'password123', otp: '123456' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'PHONE_TAKEN');
});

test('a wrong password and an unknown number give the same answer', async () => {
  const { phone } = await f.makeReseller({ password: 'correct-password' });

  const wrong = await request(app).post('/api/auth/login').send({ phone, password: 'wrong-password' });
  const unknown = await request(app)
    .post('/api/auth/login')
    .send({ phone: f.nextPhone(), password: 'anything123' });

  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error.message, unknown.body.error.message);
});

test('a session survives across requests and me returns the profile', async () => {
  const { phone, password } = await f.makeReseller();
  const agent = await signIn({ phone, password });

  const res = await agent.get('/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.role, 'reseller');
  assert.ok(res.body.data.profile.slug);
});

test('a reseller cannot reach the owner panel', async () => {
  const { phone, password } = await f.makeReseller();
  const agent = await signIn({ phone, password });

  const res = await agent.get('/api/owner/products');
  assert.equal(res.status, 403);
});

test('an unauthenticated request to a reseller route is refused', async () => {
  const res = await request(app).get('/api/reseller/wallet');
  assert.equal(res.status, 401);
});

/* ------------------------------------------------------------------ kyc gate */

test('an unapproved reseller may price products but not open a shop', async () => {
  const { phone, password, profile } = await f.makeReseller({
    kycRequired: true,
    kycStatus: KYC_STATUS.PENDING,
    formActive: false,
  });
  const product = await f.makeProduct({ cost: 55 });
  const agent = await signIn({ phone, password });

  // Setup work is allowed during the wait.
  const priced = await agent.put(`/api/reseller/catalog/${product._id}`).send({ variants: [{ variant: String(product.variants[0]._id), sellPrice: 60 }] });
  assert.equal(priced.status, 200);

  // Opening the shop is not.
  const opened = await agent.patch('/api/reseller/profile').send({ formActive: true });
  assert.equal(opened.status, 403);

  // And the public form stays closed.
  const shop = await request(app).get(`/api/public/shop/${profile.slug}`);
  assert.equal(shop.status, 404);
});

test('confirming an order is blocked until KYC is approved', async () => {
  const { phone, password, profile } = await f.makeReseller({
    kycRequired: true,
    kycStatus: KYC_STATUS.PENDING,
  });
  const agent = await signIn({ phone, password });

  const res = await agent.post(`/api/reseller/orders/${profile._id}/confirm`).send({});
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /KYC/);
});

/* ---------------------------------------------------------------- public form */

test('the public shop omits hidden prices from the response body', async () => {
  const { profile } = await f.makeReseller();
  const visible = await f.makeProduct({ name: 'হিমসাগর', cost: 55 });
  const hidden = await f.makeProduct({ name: 'ল্যাংড়া', cost: 62 });
  await f.listProduct(profile, visible, 70);
  await f.listProduct(profile, hidden, 80, { hidePrice: true });

  const res = await request(app).get(`/api/public/shop/${profile.slug}`);
  assert.equal(res.status, 200);

  const byName = Object.fromEntries(res.body.data.products.map((p) => [p.name, p]));
  // A price is per box, so it is the box that carries it. docs/adr/0021.
  assert.equal(byName['হিমসাগর'].variants[0].price, 70);
  assert.equal(byName['ল্যাংড়া'].priceHidden, true);
  // Not merely hidden in the UI: the number is absent from the payload.
  assert.equal('price' in byName['ল্যাংড়া'].variants[0], false);
});

test('the public shop lists every box a reseller has priced, cheapest first', async () => {
  const { profile } = await f.makeReseller();
  const product = await f.makeProduct({
    name: 'হিমসাগর',
    boxes: [
      { content: 11, cost: 600 },
      { content: 6, cost: 330 },
    ],
  });
  // A price per box, each a hundred taka over what the owner charges.
  await f.listProduct(profile, product, (variant) => variant.costPricePoisha / 100 + 100);

  const res = await request(app).get(`/api/public/shop/${profile.slug}`);
  assert.equal(res.status, 200);

  const [box] = res.body.data.products;
  assert.equal(box.variants.length, 2);
  // Smallest box first: it is the one a first-time customer reaches for.
  assert.deepEqual(
    box.variants.map((v) => [v.label, v.content, v.price]),
    [
      ['6 kg', 6, 430],
      ['11 kg', 11, 700],
    ]
  );
});

test('a box the reseller never priced is not on their form', async () => {
  const { profile } = await f.makeReseller();
  const product = await f.makeProduct({
    name: 'হিমসাগর',
    boxes: [
      { content: 6, cost: 330 },
      { content: 11, cost: 600 },
    ],
  });

  // Only the six-kilo box: this shop does not carry the big one.
  await ResellerProduct.create({
    reseller: profile._id,
    product: product._id,
    variants: [
      { variant: product.variants[0]._id, sellPricePoisha: 43000, isListed: true },
    ],
    isListed: true,
  });

  const res = await request(app).get(`/api/public/shop/${profile.slug}`);
  assert.deepEqual(
    res.body.data.products[0].variants.map((v) => v.label),
    ['6 kg']
  );

  // And ordering the unpriced one is refused, not merely absent from the page.
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const attempt = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer(),
      items: [
        { product: String(product._id), variant: String(product.variants[1]._id), quantity: 1 },
      ],
    });
  assert.equal(attempt.status, 400);
  assert.equal(attempt.body.error.code, 'NOT_LISTED');
});

test('a customer order lands as pending and moves no money', async () => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const res = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer(),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });

  assert.equal(res.status, 201);
  assert.match(res.body.data.orderCode, /^[0-9A-Z]{8}$/);

  const order = await Order.findOne({ orderCode: res.body.data.orderCode });
  assert.equal(order.status, 'pending');

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(after.balancePoisha, 0, 'a pending order moved money');
});

test('a repeated submission id returns the first order rather than a second one', async () => {
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
  const second = await request(app).post(`/api/public/shop/${profile.slug}/orders`).send(body);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.duplicate, true);
  assert.equal(first.body.data.orderCode, second.body.data.orderCode);

  assert.equal(await Order.countDocuments({ reseller: profile._id }), 1);
});

/*
 * There is no minimum order any more: the box is the minimum, and a customer
 * either takes one or does not. What is left to refuse is a quantity that is not
 * a whole count of boxes. See docs/adr/0021.
 */
test('an order for a fraction of a box is refused', async () => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ boxes: [{ content: 6, cost: 330 }] });
  await f.listProduct(profile, product, 430);

  const order = (quantity) =>
    request(app)
      .post(`/api/public/shop/${profile.slug}/orders`)
      .send({
        paymentMode: PAYMENT_MODE.PREPAID,
        customer: f.customer(),
        items: [
          { product: String(product._id), variant: String(product.variants[0]._id), quantity },
        ],
      });

  for (const bad of [0, 1.5, -2]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await order(bad);
    assert.equal(res.status, 400, `quantity ${bad} was accepted`);
  }

  const good = await order(2);
  assert.equal(good.status, 201, JSON.stringify(good.body));
  assert.equal(await Order.countDocuments({ reseller: profile._id }), 1);
});

test('one order carries two box sizes of the same product', async () => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({
    boxes: [
      { content: 6, cost: 330 },
      { content: 11, cost: 600 },
    ],
  });
  await f.listProduct(profile, product, (variant) => variant.costPricePoisha / 100 + 100);

  // Two elevens and three sixes, which is the whole point of boxes.
  const res = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer(),
      items: [
        { product: String(product._id), variant: String(product.variants[1]._id), quantity: 2 },
        { product: String(product._id), variant: String(product.variants[0]._id), quantity: 3 },
      ],
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const order = await Order.findOne({ orderCode: res.body.data.orderCode });
  assert.equal(order.items.length, 2, 'two boxes of one product must be two lines');

  const bySize = Object.fromEntries(order.items.map((i) => [i.variantContentMilli, i]));
  assert.equal(bySize[11000].qty, 2);
  assert.equal(bySize[6000].qty, 3);
  // The content is carried too, so a pick list can add unlike boxes together.
  assert.equal(bySize[11000].qtyMilli, 22000);
  assert.equal(bySize[6000].qtyMilli, 18000);
  assert.equal(bySize[11000].variantLabelBn, '11 kg');

  // Priced per box: 2 x 700 + 3 x 430 = 2690, plus 80 delivery.
  assert.equal(order.totals.sellSubtotalPoisha, toPoisha(2690));
  assert.equal(order.totals.costSubtotalPoisha, toPoisha(2 * 600 + 3 * 330));
  assert.equal(order.totals.customerTotalPoisha, toPoisha(2770));
});

test('the same box twice in one order is refused', async () => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ boxes: [{ content: 6, cost: 330 }] });
  await f.listProduct(profile, product, 430);

  const res = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer(),
      items: [
        { product: String(product._id), variant: String(product.variants[0]._id), quantity: 1 },
        { product: String(product._id), variant: String(product.variants[0]._id), quantity: 2 },
      ],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'DUPLICATE_LINE');
});

test('an undeliverable district is refused before an order is created', async () => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const res = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer({ district: 'Atlantis' }),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'NO_ZONE');
  assert.equal(await Order.countDocuments({}), 0);
});

test('tracking needs the order code and the phone number together', async () => {
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const created = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer({ phone: '01912345678' }),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });

  const { orderCode } = created.body.data;

  const wrongPhone = await request(app)
    .get(`/api/public/track/${orderCode}`)
    .query({ phone: '01911111111' });
  assert.equal(wrongPhone.status, 400);

  const right = await request(app)
    .get(`/api/public/track/${orderCode}`)
    .query({ phone: '01912345678' });
  assert.equal(right.status, 200);
  assert.equal(right.body.data.order.status, 'pending');

  // A customer must not learn what the reseller paid.
  const payload = JSON.stringify(right.body.data.order);
  assert.equal(payload.includes('costPrice'), false);
  assert.equal(payload.includes('margin'), false);
});

/* ---------------------------------------------------------------- price rules */

test('a reseller cannot price below the owner cost or above the ceiling', async () => {
  const { phone, password } = await f.makeReseller();
  const product = await f.makeProduct({ cost: 55, maxSellPrice: 90 });
  const agent = await signIn({ phone, password });

  const tooLow = await agent.put(`/api/reseller/catalog/${product._id}`).send({ variants: [{ variant: String(product.variants[0]._id), sellPrice: 50 }] });
  assert.equal(tooLow.status, 400);
  assert.equal(tooLow.body.error.code, 'BELOW_COST');

  const tooHigh = await agent.put(`/api/reseller/catalog/${product._id}`).send({ variants: [{ variant: String(product.variants[0]._id), sellPrice: 120 }] });
  assert.equal(tooHigh.status, 400);
  assert.equal(tooHigh.body.error.code, 'ABOVE_MAX');

  const fine = await agent.put(`/api/reseller/catalog/${product._id}`).send({ variants: [{ variant: String(product.variants[0]._id), sellPrice: 62 }] });
  assert.equal(fine.status, 200);
  assert.equal(fine.body.data.product.variants[0].sellPrice, 62);
});

/*
 * The floor and the ceiling belong to the box, not to the product: a six-kilo
 * box and an eleven-kilo box have nothing to say about each other's price.
 * See docs/adr/0021.
 */
test('each box carries its own floor and ceiling', async () => {
  const { phone, password } = await f.makeReseller();
  const product = await f.makeProduct({
    boxes: [
      { content: 6, cost: 330, maxSellPrice: 540 },
      { content: 11, cost: 600, maxSellPrice: 990 },
    ],
  });
  const agent = await signIn({ phone, password });
  const url = `/api/reseller/catalog/${product._id}`;
  const box = (i) => String(product.variants[i]._id);

  // Legal for the six-kilo box, below cost for the eleven.
  const mixed = await agent.put(url).send({
    variants: [
      { variant: box(0), sellPrice: 430 },
      { variant: box(1), sellPrice: 430 },
    ],
  });
  assert.equal(mixed.status, 400);
  assert.equal(mixed.body.error.code, 'BELOW_COST');
  assert.ok(mixed.body.error.fields['variants.1.sellPrice']);

  const fine = await agent.put(url).send({
    variants: [
      { variant: box(0), sellPrice: 430 },
      { variant: box(1), sellPrice: 800 },
    ],
  });
  assert.equal(fine.status, 200, JSON.stringify(fine.body));
  assert.deepEqual(
    fine.body.data.product.variants.map((v) => [v.label, v.sellPrice, v.activated]),
    [
      ['6 kg', 430, true],
      ['11 kg', 800, true],
    ]
  );
});

test('the price floor is re-checked at confirm against the current cost', async () => {
  const Product = require('../src/models/Product');
  const { phone, password, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 60);

  const created = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer(),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });
  const order = await Order.findOne({ orderCode: created.body.data.orderCode });

  // The owner raises the cost of that box after the customer submitted.
  await Product.updateOne(
    { _id: product._id, 'variants._id': product.variants[0]._id },
    { $set: { 'variants.$.costPricePoisha': toPoisha(70) } }
  );

  const agent = await signIn({ phone, password });
  const res = await agent.post(`/api/reseller/orders/${order._id}/confirm`).send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BELOW_COST');

  // The failed confirm must leave the order untouched and the wallet at zero.
  const reloaded = await Order.findById(order._id);
  assert.equal(reloaded.status, 'pending');
  assert.equal((await ResellerProfile.findById(profile._id)).balancePoisha, 0);
});

/* -------------------------------------------------------------- owner journey */

test('an owner walks an order from confirmed to delivered', async () => {
  const owner = await f.makeOwner();
  const { phone, password, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const created = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.COD,
      customer: f.customer(),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });
  const order = await Order.findOne({ orderCode: created.body.data.orderCode });

  const resellerAgent = await signIn({ phone, password });
  const confirmed = await resellerAgent
    .post(`/api/reseller/orders/${order._id}/confirm`)
    .send({ items: [{ product: String(product._id), variant: String(product.variants[0]._id), sellPrice: 62 }] });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.order.totals.walletDebit, 630);

  const ownerAgent = await signIn({ phone: owner.phone, password: owner.password });

  // Accepting says where each line is collected from. Without that it is refused,
  // because a packing list that does not name an orchard is not a packing list.
  const source = await f.makeSource({ name: 'কানসাট আম বাজার' });
  const toAccept = await Order.findById(order._id);

  const noSource = await ownerAgent.post(`/api/owner/orders/${order._id}/accept`).send({});
  assert.equal(noSource.status, 400, 'accepting without a source was allowed');

  const accepted = await ownerAgent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: f.sourcesFor(toAccept, source) });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.order.items[0].sourceName, 'কানসাট আম বাজার');

  await ownerAgent.post(`/api/owner/orders/${order._id}/pack`).send({});

  // Shipping without a courier is refused, because the customer will ask.
  const noCourier = await ownerAgent.post(`/api/owner/orders/${order._id}/ship`).send({});
  assert.equal(noCourier.status, 400);

  const shipped = await ownerAgent
    .post(`/api/owner/orders/${order._id}/ship`)
    .send({ courierName: 'Sundarban', trackingNumber: 'SC-9931' });
  assert.equal(shipped.status, 200);

  const delivered = await ownerAgent.post(`/api/owner/orders/${order._id}/deliver`).send({});
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.data.order.status, 'delivered');

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(toTaka(after.balancePoisha), 70, 'the margin did not land after a cod delivery');
});

test('an out of order transition is refused', async () => {
  const owner = await f.makeOwner();
  const { profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const created = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer(),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });
  const order = await Order.findOne({ orderCode: created.body.data.orderCode });

  const ownerAgent = await signIn({ phone: owner.phone, password: owner.password });
  // Still pending, so it cannot ship.
  const res = await ownerAgent
    .post(`/api/owner/orders/${order._id}/ship`)
    .send({ courierName: 'Sundarban' });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'INVALID_TRANSITION');
});

test('approving one deposit twice credits the wallet once', async () => {
  const owner = await f.makeOwner();
  const { profile } = await f.makeReseller();

  const deposit = await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(2000),
    method: 'bkash',
    transactionId: 'TRX123',
  });

  const ownerAgent = await signIn({ phone: owner.phone, password: owner.password });

  const first = await ownerAgent.post(`/api/owner/deposits/${deposit._id}/approve`).send({});
  const second = await ownerAgent.post(`/api/owner/deposits/${deposit._id}/approve`).send({});

  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, REVIEW_STATUS.APPROVED);
  assert.equal(second.status, 404, 'a second approval was accepted');

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(toTaka(after.balancePoisha), 2000);
  assert.equal(await LedgerEntry.countDocuments({ reseller: profile._id }), 1);
});

test('the same gateway transaction cannot be claimed twice', async () => {
  const { profile } = await f.makeReseller();
  await Deposit.create({
    reseller: profile._id,
    amountPoisha: toPoisha(2000),
    method: 'bkash',
    transactionId: 'TRX-DUP',
  });

  await assert.rejects(
    Deposit.create({
      reseller: profile._id,
      amountPoisha: toPoisha(500),
      method: 'bkash',
      transactionId: 'TRX-DUP',
    }),
    /duplicate key/i
  );
});

test('a withdrawal cannot exceed the balance, and the credit limit is not cash', async () => {
  const { phone, password, profile } = await f.makeReseller({ creditLimit: 5000 });
  const agent = await signIn({ phone, password });

  // Balance is zero, so nothing may be withdrawn even with headroom to buy stock.
  const res = await agent
    .post('/api/reseller/withdrawals')
    .send({ amount: 1000, method: 'bkash', destinationNumber: '01712345678' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');
  assert.equal((await ResellerProfile.findById(profile._id)).balancePoisha, 0);
});

test('the owner dashboard reports receivables and aging', async () => {
  const owner = await f.makeOwner();
  const { phone, password, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const created = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer(),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });
  const order = await Order.findOne({ orderCode: created.body.data.orderCode });

  const resellerAgent = await signIn({ phone, password });
  await resellerAgent.post(`/api/reseller/orders/${order._id}/confirm`).send({});

  const ownerAgent = await signIn({ phone: owner.phone, password: owner.password });

  const dash = await ownerAgent.get('/api/owner/reports/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.body.data.totalReceivable, 630);
  assert.equal(dash.body.data.awaitingAcceptance, 1);

  const receivables = await ownerAgent.get('/api/owner/reports/receivables');
  assert.equal(receivables.body.data.totalOwed, 630);
  assert.equal(receivables.body.data.resellers[0].owed, 630);
});

test('the csv export starts with a byte order mark so Excel reads Bengali', async () => {
  const owner = await f.makeOwner();
  const ownerAgent = await signIn({ phone: owner.phone, password: owner.password });

  const res = await ownerAgent.get('/api/owner/exports/orders.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.equal(res.text.charCodeAt(0), 0xfeff, 'missing byte order mark');
});

test('an unknown route returns the standard error envelope', async () => {
  const res = await request(app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
