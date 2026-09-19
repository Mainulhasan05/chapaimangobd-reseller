'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const orderService = require('../src/services/orderService');
const ledger = require('../src/services/ledger');
const { withTransaction } = require('../src/services/tx');
const { updateSettings } = require('../src/services/settings');

const LedgerEntry = require('../src/models/LedgerEntry');
const ResellerProfile = require('../src/models/ResellerProfile');
const Product = require('../src/models/Product');
const Source = require('../src/models/Source');
const Order = require('../src/models/Order');

const { toPoisha, toTaka } = require('../src/utils/money');
const { toMilli } = require('../src/utils/quantity');
const { LEDGER_KIND, PAYMENT_MODE, ROLES, ORDER_STATUS } = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

/**
 * One lifecycle step as the owner.
 *
 * Accept has to name a source for every line, and the ids it names are the
 * confirmed ones, so the order is read back here rather than taken from the
 * pending copy whose items confirm has already replaced.
 */
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

/** Places a pending order and returns it. */
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

test('confirm debits the owner cost plus delivery, never the selling price', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 5000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 60);

  const order = await placeOrder({ profile, product, quantity: 10 });

  const confirmed = await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: user,
    itemOverrides: [{ product: product._id, variant: product.variants[0]._id, sellPricePoisha: toPoisha(62) }],
  });

  // 10 kg at cost 55 is 550, plus 80 delivery. The 620 selling value never appears.
  assert.equal(toTaka(confirmed.totals.costSubtotalPoisha), 550);
  assert.equal(toTaka(confirmed.totals.sellSubtotalPoisha), 620);
  assert.equal(toTaka(confirmed.totals.walletDebitPoisha), 630);

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(toTaka(after.balancePoisha), -630);

  const entries = await LedgerEntry.find({ reseller: profile._id }).sort({ seq: 1 });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, LEDGER_KIND.ORDER_COST_DEBIT);
  assert.equal(toTaka(entries[0].amountPoisha), -550);
  assert.equal(entries[1].kind, LEDGER_KIND.DELIVERY_DEBIT);
  assert.equal(toTaka(entries[1].amountPoisha), -80);
});

test('the ledger always reconciles against the stored balance', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 60);

  // A randomised but reproducible sequence of confirms, cancels and credits.
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const order = await placeOrder({ profile, product, quantity: 5 + i });
    // eslint-disable-next-line no-await-in-loop
    await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });

    if (i % 3 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await orderService.transitionOrder({
        orderId: order._id,
        action: 'cancel',
        actorUser: user,
        role: ROLES.RESELLER,
        resellerProfile: await ResellerProfile.findById(profile._id),
        payload: { reason: 'customer changed mind' },
      });
    }

    if (i % 4 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await withTransaction((session) =>
        ledger.postEntry(session, {
          reseller: profile._id,
          kind: LEDGER_KIND.DEPOSIT_CREDIT,
          amountPoisha: toPoisha(1000),
          idempotencyKey: `deposit:test-${i}:credit:v1`,
          refType: 'deposit',
        })
      );
    }
  }

  const report = await ledger.reconcile(profile._id);
  assert.deepEqual(report.problems, []);
  assert.ok(report.ok);
  assert.equal(report.ledgerTotalPoisha, report.profileBalancePoisha);
});

test('sequence numbers are gap free and balanceAfter never lies', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 60);

  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const order = await placeOrder({ profile, product, quantity: 5 });
    // eslint-disable-next-line no-await-in-loop
    await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });
  }

  const entries = await LedgerEntry.find({ reseller: profile._id }).sort({ seq: 1 }).lean();
  let running = 0;

  entries.forEach((entry, index) => {
    assert.equal(entry.seq, index + 1, 'sequence has a gap');
    running += entry.amountPoisha;
    assert.equal(entry.balanceAfterPoisha, running, 'balanceAfter disagrees with the running total');
  });
});

test('two concurrent confirms of one order produce exactly one debit pair', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 60);

  const order = await placeOrder({ profile, product, quantity: 10 });

  const results = await Promise.allSettled([
    orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user }),
    orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'both confirms succeeded, which means the status guard failed');

  const entries = await LedgerEntry.find({ reseller: profile._id });
  assert.equal(entries.length, 2, 'the order was debited more than once');

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(toTaka(after.balancePoisha), -630);
});

test('a confirm past the credit limit leaves no entry and no stock change', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 100 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5, trackStock: true, stockQty: 100 });
  await f.listProduct(profile, product, 60);

  const order = await placeOrder({ profile, product, quantity: 10 });

  await assert.rejects(
    orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user }),
    /credit limit/i
  );

  const entries = await LedgerEntry.countDocuments({ reseller: profile._id });
  assert.equal(entries, 0, 'a rejected confirm still wrote to the ledger');

  const afterProduct = await Product.findById(product._id);
  assert.equal(afterProduct.variants[0].stockQty, 100, 'stock moved despite the confirm failing');

  const afterProfile = await ResellerProfile.findById(profile._id);
  assert.equal(afterProfile.balancePoisha, 0);

  const afterOrder = await Order.findById(order._id);
  assert.equal(afterOrder.status, ORDER_STATUS.PENDING, 'the order was not rolled back');
});

test('the same idempotency key credits once, however many times it is posted', async () => {
  const { profile } = await f.makeReseller();

  const post = () =>
    withTransaction((session) =>
      ledger.postEntry(session, {
        reseller: profile._id,
        kind: LEDGER_KIND.DEPOSIT_CREDIT,
        amountPoisha: toPoisha(1000),
        idempotencyKey: 'deposit:same-id:credit:v1',
        refType: 'deposit',
      })
    );

  const first = await post();
  const second = await post();

  assert.equal(String(first._id), String(second._id), 'a second post created a new entry');

  const entries = await LedgerEntry.countDocuments({ reseller: profile._id });
  assert.equal(entries, 1);

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(toTaka(after.balancePoisha), 1000, 'the deposit was credited twice');
});

test('a cash on delivery order leaves the reseller up by exactly the margin', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({
    profile,
    product,
    quantity: 10,
    paymentMode: PAYMENT_MODE.COD,
  });

  await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });

  for (const action of ['accept', 'pack', 'ship', 'deliver']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(order._id, action, owner, source);
  }

  const after = await ResellerProfile.findById(profile._id);
  // Debited 550 + 80, credited the 700 the courier collected: margin of 70.
  assert.equal(toTaka(after.balancePoisha), 70);

  const credit = await LedgerEntry.findOne({
    reseller: profile._id,
    kind: LEDGER_KIND.COD_COLLECTION_CREDIT,
  });
  assert.ok(credit, 'no collection credit was posted on delivery');
  assert.equal(toTaka(credit.amountPoisha), 700);
});

test('a prepaid order posts nothing extra on delivery', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });

  for (const action of ['accept', 'pack', 'ship', 'deliver']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(order._id, action, owner, source);
  }

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(toTaka(after.balancePoisha), -630, 'delivery changed a prepaid balance');

  const credits = await LedgerEntry.countDocuments({
    reseller: profile._id,
    kind: LEDGER_KIND.COD_COLLECTION_CREDIT,
  });
  assert.equal(credits, 0);
});

test('a returned order reverses the goods but keeps the courier fee by default', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5, trackStock: true, stockQty: 100 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10, paymentMode: PAYMENT_MODE.COD });
  await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });

  for (const action of ['accept', 'pack', 'ship']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(order._id, action, owner, source);
  }

  await orderService.transitionOrder({
    orderId: order._id,
    action: 'return',
    actorUser: owner,
    role: ROLES.OWNER,
    payload: { reason: 'customer refused at the door' },
  });

  const after = await ResellerProfile.findById(profile._id);
  // The 550 of goods comes back, the 80 courier fee does not.
  assert.equal(toTaka(after.balancePoisha), -80);

  const credits = await LedgerEntry.countDocuments({
    reseller: profile._id,
    kind: LEDGER_KIND.COD_COLLECTION_CREDIT,
  });
  assert.equal(credits, 0, 'a refused order was credited as if it had been collected');

  // Without the "put back in stock" box, a return leaves stock where it is.
  const afterProduct = await Product.findById(product._id);
  assert.equal(afterProduct.variants[0].stockQty, 90);
});

test('the owner can choose to refund the delivery charge on a return', async () => {
  await updateSettings({ reverseDeliveryChargeOnReturn: true });

  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource();
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });

  for (const action of ['accept', 'pack', 'ship', 'return']) {
    // eslint-disable-next-line no-await-in-loop
    await walk(order._id, action, owner, source, { reason: 'damaged' });
  }

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(toTaka(after.balancePoisha), 0);
});

test('cancelling a pending order posts nothing, because nothing was debited', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5, trackStock: true, stockQty: 100 });
  await f.listProduct(profile, product, 60);

  const order = await placeOrder({ profile, product, quantity: 10 });

  await orderService.transitionOrder({
    orderId: order._id,
    action: 'cancel',
    actorUser: user,
    role: ROLES.RESELLER,
    resellerProfile: profile,
    payload: { reason: 'wrong address' },
  });

  const entries = await LedgerEntry.countDocuments({ reseller: profile._id });
  assert.equal(entries, 0);

  // Stock was never taken, so it must not be handed back either.
  const afterProduct = await Product.findById(product._id);
  assert.equal(afterProduct.variants[0].stockQty, 100);
});

test('cancelling a confirmed order reverses the debits and restores stock', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5, trackStock: true, stockQty: 100 });
  await f.listProduct(profile, product, 60);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await orderService.confirmOrder({ orderId: order._id, resellerProfile: profile, actorUser: user });

  await orderService.transitionOrder({
    orderId: order._id,
    action: 'cancel',
    actorUser: user,
    role: ROLES.RESELLER,
    resellerProfile: await ResellerProfile.findById(profile._id),
    payload: { reason: 'customer changed mind' },
  });

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(after.balancePoisha, 0);

  const reversals = await LedgerEntry.find({ reseller: profile._id, kind: LEDGER_KIND.REVERSAL });
  assert.equal(reversals.length, 2);
  reversals.forEach((r) => assert.ok(r.reversalOf, 'a reversal does not reference its original'));

  const afterProduct = await Product.findById(product._id);
  assert.equal(afterProduct.variants[0].stockQty, 100);
});

test('repricing a product does not move an existing order or its ledger entry', async () => {
  const { user, profile } = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 60);

  const order = await placeOrder({ profile, product, quantity: 10 });
  const confirmed = await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: user,
  });

  await Product.updateOne({ _id: product._id }, { $set: { costPricePoisha: toPoisha(80) } });

  const reloaded = await Order.findById(confirmed._id);
  assert.equal(toTaka(reloaded.items[0].costPricePoisha), 55, 'the snapshot followed the catalog');
  assert.equal(toTaka(reloaded.totals.walletDebitPoisha), 630);

  const entry = await LedgerEntry.findOne({
    reseller: profile._id,
    kind: LEDGER_KIND.ORDER_COST_DEBIT,
  });
  assert.equal(toTaka(entry.amountPoisha), -550);
});

test('the ledger refuses to be edited or deleted', async () => {
  const { profile } = await f.makeReseller();

  const entry = await withTransaction((session) =>
    ledger.postEntry(session, {
      reseller: profile._id,
      kind: LEDGER_KIND.MANUAL_CREDIT,
      amountPoisha: toPoisha(100),
      idempotencyKey: 'manual:immutable-test',
      refType: 'manual',
    })
  );

  await assert.rejects(
    LedgerEntry.updateOne({ _id: entry._id }, { $set: { amountPoisha: 1 } }),
    /append-only/
  );
  await assert.rejects(LedgerEntry.deleteOne({ _id: entry._id }), /append-only/);

  entry.amountPoisha = 999;
  await assert.rejects(entry.save(), /append-only/);
});

/* ------------------------------------------------------- sources and history */

/**
 * The source is decided when the owner accepts, not when the product is created,
 * because a product is fixed and the orchard it comes from is not. These tests
 * pin that down, and pin down the promise that matters more: retiring a source
 * or a product must never change what an old order says happened.
 */

test('accepting records which source each line is collected from', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource({ name: 'কানসাট আম বাজার' });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  const confirmed = await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });

  // Nothing is decided before the owner accepts.
  assert.equal(confirmed.items[0].source, null);
  assert.equal(confirmed.items[0].sourceNameBn, null);

  const accepted = await walk(order._id, 'accept', owner, source);

  assert.equal(String(accepted.items[0].source), String(source._id));
  assert.equal(accepted.items[0].sourceNameBn, 'কানসাট আম বাজার');
});

test('an order cannot be accepted until every line has a source', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });

  await assert.rejects(
    orderService.transitionOrder({
      orderId: order._id,
      action: 'accept',
      actorUser: owner,
      role: ROLES.OWNER,
      payload: { sources: [] },
    }),
    /source for every item/i
  );

  // The order did not move. A refused accept must leave nothing behind.
  const after = await Order.findById(order._id);
  assert.equal(after.status, ORDER_STATUS.CONFIRMED);
  assert.equal(after.acceptedAt, undefined);
});

test('an archived source cannot be chosen for a new order', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource({ name: 'Closed orchard' });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });

  await Source.updateOne({ _id: source._id }, { $set: { isArchived: true } });

  await assert.rejects(walk(order._id, 'accept', owner, source), /no longer exists/i);

  const after = await Order.findById(order._id);
  assert.equal(after.status, ORDER_STATUS.CONFIRMED, 'a refused accept still moved the order');
});

test('retiring a product and a source leaves an accepted order intact', async () => {
  const { user: reseller, profile } = await f.makeReseller({ creditLimit: 100000 });
  const { user: owner } = await f.makeOwner();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  const source = await f.makeSource({ name: 'কানসাট আম বাজার' });
  await f.listProduct(profile, product, 62);

  const order = await placeOrder({ profile, product, quantity: 10 });
  await orderService.confirmOrder({
    orderId: order._id,
    resellerProfile: profile,
    actorUser: reseller,
  });
  await walk(order._id, 'accept', owner, source);

  /*
   * The season ends: the orchard is retired, the variety is dropped, and both
   * are renamed on the way out. Everything an old order shows comes from its own
   * snapshots, so none of this may reach it.
   */
  await Source.updateOne(
    { _id: source._id },
    { $set: { isArchived: true, name: 'RENAMED AFTER THE FACT' } }
  );
  await Product.updateOne(
    { _id: product._id },
    { $set: { isArchived: true, nameBn: 'RENAMED AFTER THE FACT', costPricePoisha: toPoisha(999) } }
  );

  const after = await Order.findById(order._id);

  assert.equal(after.items[0].sourceNameBn, 'কানসাট আম বাজার');
  assert.equal(after.items[0].productNameBn, 'হিমসাগর আম');
  assert.equal(toTaka(after.items[0].costPricePoisha), 55);
  assert.equal(toTaka(after.totals.walletDebitPoisha), 630);

  // And the ledger still reconciles against the balance it produced.
  const entries = await LedgerEntry.find({ reseller: profile._id }).sort({ seq: 1 });
  const sum = entries.reduce((total, entry) => total + entry.amountPoisha, 0);
  const settled = await ResellerProfile.findById(profile._id);
  assert.equal(sum, settled.balancePoisha);
});
