'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const orderService = require('../src/services/orderService');
const supplyStock = require('../src/services/supplyStock');
const packagingConsumption = require('../src/services/packagingConsumption');
const { withTransaction } = require('../src/services/tx');

const Supply = require('../src/models/Supply');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const StockMovement = require('../src/models/StockMovement');

const { toPoisha, toTaka } = require('../src/utils/money');
const { toMilli, fromMilli } = require('../src/utils/quantity');
const { MOVEMENT_KIND, PAYMENT_MODE, ROLES, ORDER_STATUS } = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

const nonce = () => crypto.randomUUID();

/** A supply with stock on the shelf, seeded through a real opening movement. */
async function makeSupply({ nameBn = 'ক্যারেট', unit = 'pcs', opening = 0, cost = 0 } = {}) {
  const supply = await Supply.create({ nameBn, unit });
  if (opening > 0) {
    await withTransaction((s) =>
      supplyStock.postMovement(s, {
        supply: supply._id,
        kind: MOVEMENT_KIND.OPENING,
        qtyMilli: toMilli(opening),
        unitCostPoisha: toPoisha(cost),
        idempotencyKey: `open:${supply._id}`,
        refType: 'manual',
      })
    );
  }
  return Supply.findById(supply._id);
}

/** Gives a product's first box a packaging recipe. */
async function setRecipe(product, rows) {
  const fresh = await Product.findById(product._id);
  fresh.variants[0].packaging = rows.map((r) => ({
    supply: r.supply._id,
    qtyMilli: toMilli(r.perBox),
  }));
  await fresh.save();
  return fresh;
}

async function placeOrder({ profile, product, quantity = 2, paymentMode = PAYMENT_MODE.PREPAID }) {
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

/** Walks an order to a status as the owner. */
async function walk(orderId, action, owner, source, extra = {}) {
  const payload = { courierName: 'Sundarban', ...extra };
  if (action === 'accept') {
    const current = await Order.findById(orderId);
    payload.sources = f.sourcesFor(current, source);
  }
  return orderService.transitionOrder({
    orderId,
    action,
    actorUser: owner,
    role: ROLES.OWNER,
    payload,
  });
}

/** Everything up to and including shipped, which is where the outcomes diverge. */
async function shipOne({ boxes = 2, recipe, trackStock = false, stockQty = 100 } = {}) {
  const { user: owner } = await f.makeOwner();
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const source = await f.makeSource();
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1, trackStock, stockQty });
  await f.listProduct(profile, product, 60);
  if (recipe) await setRecipe(product, recipe);

  const order = await placeOrder({ profile, product, quantity: boxes });
  await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });
  await walk(order._id, 'accept', owner, source);
  await walk(order._id, 'pack', owner);
  await walk(order._id, 'ship', owner);

  return { owner, user, profile, product, source, order };
}

/* ------------------------------------------------------------ the happy path */

test('delivering consumes the packaging its recipe describes, and snapshots it', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const paper = await makeSupply({ nameBn: 'কাগজ', unit: 'sheet', opening: 20, cost: 5 });
  const needle = await makeSupply({ nameBn: 'সুই', unit: 'pcs', opening: 20, cost: 2 });

  const { owner, order } = await shipOne({
    boxes: 2,
    recipe: [
      { supply: crate, perBox: 1 },
      // Fractional on purpose: this is why quantity is milli, not an integer.
      { supply: paper, perBox: 1.5 },
      { supply: needle, perBox: 2 },
    ],
  });

  // Nothing moved before delivery: the cost belongs to the completed sale.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(10));

  await walk(order._id, 'deliver', owner);

  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(8));
  // Two boxes at 1.5 sheets is exactly 3, with no float drift.
  assert.equal((await Supply.findById(paper._id)).onHandMilli, toMilli(17));
  assert.equal((await Supply.findById(needle._id)).onHandMilli, toMilli(16));

  // 2 crates at 88, 3 sheets at 5, 4 needles at 2 = 176 + 15 + 8 = 199.
  const delivered = await Order.findById(order._id);
  assert.equal(toTaka(delivered.packagingCostPoisha), 199);

  // Snapshotted onto the line, so a later purchase cannot restate this cost.
  const used = delivered.items[0].packagingUsed;
  assert.equal(used.length, 3);
  const crateRow = used.find((u) => String(u.supply) === String(crate._id));
  assert.equal(crateRow.supplyNameBn, 'ক্যারেট');
  assert.equal(fromMilli(crateRow.qtyMilli), 2);
  assert.equal(toTaka(crateRow.unitCostPoisha), 88);

  // Every movement is flagged as worked out rather than counted.
  const movements = await StockMovement.find({ refType: 'order', refId: order._id });
  assert.equal(movements.length, 3);
  assert.ok(movements.every((m) => m.isEstimated), 'consumption is always an estimate');
  assert.ok(movements.every((m) => m.kind === MOVEMENT_KIND.CONSUMED));
});

test('two box sizes that share a supply make one movement, not two', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const { user: owner } = await f.makeOwner();
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const source = await f.makeSource();

  // A product with two boxes, both of which take a crate.
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1 });
  const fresh = await Product.findById(product._id);
  fresh.variants.push({
    contentMilli: toMilli(11),
    costPricePoisha: toPoisha(110),
    stockQty: 100,
  });
  fresh.variants.forEach((v) => {
    v.packaging = [{ supply: crate._id, qtyMilli: toMilli(1) }];
  });
  await fresh.save();
  await f.listProduct(profile, fresh, 60);
  await f.listProduct(profile, fresh, 120, fresh.variants[1]._id).catch(() => {});

  const { order } = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode: PAYMENT_MODE.PREPAID,
    customer: {
      name: 'Customer',
      phoneE164: '+8801912345678',
      address: '12 Test Road',
      district: 'Dhaka',
    },
    items: [{ product: fresh._id, variant: fresh.variants[0]._id, qty: 2 }],
  });

  await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });
  await walk(order._id, 'accept', owner, source);
  await walk(order._id, 'pack', owner);
  await walk(order._id, 'ship', owner);
  await walk(order._id, 'deliver', owner);

  const movements = await StockMovement.find({ refType: 'order', refId: order._id });
  assert.equal(movements.length, 1, 'rolled up per supply');
  assert.equal(movements[0].qtyMilli, -toMilli(2));
});

/* ------------------------------------------------------- the three outcomes */

test('a returned parcel consumes its packaging exactly as a delivered one does', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const { owner, order } = await shipOne({ boxes: 3, recipe: [{ supply: crate, perBox: 1 }] });

  await walk(order._id, 'return', owner, null, { reason: 'refused' });

  // The parcel went out and came back: the crate travelled and is gone.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(7));
  const returned = await Order.findById(order._id);
  assert.equal(returned.status, ORDER_STATUS.RETURNED);
  assert.equal(toTaka(returned.packagingCostPoisha), 264);
});

test('restocking the fruit on a return does not put the packaging back', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const { owner, order, product } = await shipOne({
    boxes: 2,
    recipe: [{ supply: crate, perBox: 1 }],
    // Without this the fruit assertion below is vacuous: an untracked product
    // never moves stockQty, so "it came back" and "nothing happened" look alike.
    trackStock: true,
    stockQty: 100,
  });

  const before = await Product.findById(product._id);
  const stockBefore = before.variants[0].stockQty;

  await walk(order._id, 'return', owner, null, { reason: 'refused', restock: true });

  // The mangoes came back...
  const after = await Product.findById(product._id);
  assert.equal(after.variants[0].stockQty, stockBefore + 2);
  // ...and the crates did not. That tick is about the fruit. docs/adr/0026.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(8));
  assert.equal((await Order.findById(order._id)).restockedOnReturn, true);
});

test('cancelling from packed consumes nothing, because nothing left', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const { user: owner } = await f.makeOwner();
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const source = await f.makeSource();
  const product = await f.makeProduct({ cost: 55, minOrderQty: 1 });
  await f.listProduct(profile, product, 60);
  await setRecipe(product, [{ supply: crate, perBox: 1 }]);

  const order = await placeOrder({ profile, product, quantity: 2 });
  await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });
  await walk(order._id, 'accept', owner, source);
  await walk(order._id, 'pack', owner);
  await walk(order._id, 'cancel', owner, null, { reason: 'customer changed mind' });

  // A crate still on the packing table is reusable.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(10));
  const cancelled = await Order.findById(order._id);
  assert.equal(cancelled.packagingCostPoisha, 0);
  assert.equal(cancelled.items[0].packagingUsed.length, 0);
  assert.equal(await StockMovement.countDocuments({ refType: 'order' }), 0);
});

/* ----------------------------------------------------------- the edge cases */

test('a box with no recipe changes nothing at all', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const { owner, order } = await shipOne({ boxes: 2 });

  await walk(order._id, 'deliver', owner);

  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(10));
  assert.equal((await Order.findById(order._id)).packagingCostPoisha, 0);
});

test('a short shelf never blocks a delivery; it goes negative and says so', async () => {
  // One crate on the shelf, three boxes going out.
  const crate = await makeSupply({ opening: 1, cost: 88 });
  const { owner, order } = await shipOne({ boxes: 3, recipe: [{ supply: crate, perBox: 1 }] });

  // The parcel is real and already with the courier. Refusing to record it would
  // be refusing to write down what happened. docs/adr/0026.
  await walk(order._id, 'deliver', owner);

  const after = await Supply.findById(crate._id);
  assert.equal(after.onHandMilli, -toMilli(2));
  assert.equal((await Order.findById(order._id)).status, ORDER_STATUS.DELIVERED);
  // And the books still add up, which is what makes the negative trustworthy.
  assert.ok((await supplyStock.reconcile(crate._id)).ok);
});

test('the estimate shows what a parcel will take, and what the shelf cannot cover', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const paper = await makeSupply({ nameBn: 'কাগজ', unit: 'sheet', opening: 1, cost: 5 });

  const { order } = await shipOne({
    boxes: 2,
    recipe: [
      { supply: crate, perBox: 1 },
      { supply: paper, perBox: 1.5 },
    ],
  });

  const estimate = await packagingConsumption.estimate(await Order.findById(order._id));

  assert.equal(estimate.isEstimated, true);
  assert.equal(estimate.rows.length, 2);
  assert.equal(toTaka(estimate.totalCostPoisha), 191);
  // One sheet on the shelf, three needed.
  assert.equal(estimate.shortages.length, 1);
  assert.equal(estimate.shortages[0].supplyNameBn, 'কাগজ');
  assert.equal(fromMilli(estimate.shortages[0].shortMilli), 2);
});

test('delivering cannot consume twice, even if the transaction is retried', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const { owner, order } = await shipOne({ boxes: 2, recipe: [{ supply: crate, perBox: 1 }] });

  await walk(order._id, 'deliver', owner);
  // The status guard refuses a second deliver, and the idempotency key would
  // refuse the second consumption even if it did not.
  await assert.rejects(() => walk(order._id, 'deliver', owner));

  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(8));
  assert.equal(await StockMovement.countDocuments({ refType: 'order', refId: order._id }), 1);
});

test('the snapshot survives a later purchase moving the average cost', async () => {
  const crate = await makeSupply({ opening: 10, cost: 88 });
  const { owner, order } = await shipOne({ boxes: 2, recipe: [{ supply: crate, perBox: 1 }] });

  await walk(order._id, 'deliver', owner);
  const costAtDelivery = (await Order.findById(order._id)).packagingCostPoisha;

  // Crates get dearer afterwards.
  await withTransaction((s) =>
    supplyStock.postMovement(s, {
      supply: crate._id,
      kind: MOVEMENT_KIND.PURCHASE,
      qtyMilli: toMilli(100),
      unitCostPoisha: toPoisha(200),
      idempotencyKey: `later:${nonce()}`,
      refType: 'purchase',
    })
  );
  assert.ok((await Supply.findById(crate._id)).avgCostPoisha > toPoisha(88));

  // What last week's parcel cost has not changed.
  assert.equal((await Order.findById(order._id)).packagingCostPoisha, costAtDelivery);
  assert.equal(toTaka(costAtDelivery), 176);
});
