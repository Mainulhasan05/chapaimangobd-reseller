'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const supplyStock = require('../src/services/supplyStock');
const payeeLedger = require('../src/services/payeeLedger');
const purchaseService = require('../src/services/purchaseService');
const { withTransaction } = require('../src/services/tx');

const Supply = require('../src/models/Supply');
const Payee = require('../src/models/Payee');
const Purchase = require('../src/models/Purchase');
const StockMovement = require('../src/models/StockMovement');
const PayeeLedgerEntry = require('../src/models/PayeeLedgerEntry');

const { toPoisha } = require('../src/utils/money');
const { toMilli } = require('../src/utils/quantity');
const {
  MOVEMENT_KIND,
  PAYEE_LEDGER_KIND,
  PAYEE_KIND,
  PURCHASE_STATUS,
  CHARGE_PAID_TO,
  ALLOCATION_BASIS,
} = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

const nonce = () => crypto.randomUUID();

/**
 * A supply with stock already on the shelf.
 *
 * `opening` goes through a real OPENING movement rather than being written
 * straight onto `onHandMilli`, because that is what production does and because
 * seeding the field directly manufactures exactly the drift `reconcile` exists to
 * catch — as an earlier version of these tests discovered.
 */
async function makeSupply({ opening = 0, openingCostPoisha = 0, ...over } = {}) {
  const supply = await Supply.create({ nameBn: 'ক্যারেট', unit: 'pcs', ...over });
  if (opening > 0) {
    await withTransaction((s) =>
      supplyStock.postMovement(s, {
        supply: supply._id,
        kind: MOVEMENT_KIND.OPENING,
        qtyMilli: opening,
        unitCostPoisha: openingCostPoisha,
        idempotencyKey: `open:${supply._id}`,
        refType: 'manual',
      })
    );
    return Supply.findById(supply._id);
  }
  return supply;
}

const makePayee = (over = {}) =>
  Payee.create({ nameBn: 'করিম ক্যারেট স্টোর', kind: PAYEE_KIND.SUPPLIER, ...over });

/* ------------------------------------------------------------ payee ledger */

test('a purchase raises the due and a payment lowers it, provably', async () => {
  const payee = await makePayee();

  await withTransaction((s) =>
    payeeLedger.postEntry(s, {
      payee: payee._id,
      kind: PAYEE_LEDGER_KIND.PURCHASE,
      amountPoisha: toPoisha(450),
      idempotencyKey: `t:${nonce()}`,
      refType: 'purchase',
    })
  );
  await withTransaction((s) =>
    payeeLedger.postEntry(s, {
      payee: payee._id,
      kind: PAYEE_LEDGER_KIND.PAYMENT,
      amountPoisha: -toPoisha(200),
      idempotencyKey: `t:${nonce()}`,
      refType: 'payment',
    })
  );

  const after = await Payee.findById(payee._id);
  // Positive means the owner owes, the opposite of a reseller wallet.
  assert.equal(after.duePoisha, toPoisha(250));

  const report = await payeeLedger.reconcile(payee._id);
  assert.ok(report.ok, report.problems.join('; '));
  assert.equal(report.entries, 2);
});

test('overpaying a payee is an advance, never a refused entry', async () => {
  const payee = await makePayee();

  await withTransaction((s) =>
    payeeLedger.postEntry(s, {
      payee: payee._id,
      kind: PAYEE_LEDGER_KIND.PAYMENT,
      amountPoisha: -toPoisha(5000),
      idempotencyKey: `t:${nonce()}`,
      refType: 'payment',
    })
  );

  const after = await Payee.findById(payee._id);
  // বায়না: the owner is ahead and the payee owes goods. No guard exists to stop it.
  assert.equal(after.duePoisha, -toPoisha(5000));
  assert.ok((await payeeLedger.reconcile(payee._id)).ok);
});

test('the same payee entry cannot be posted twice', async () => {
  const payee = await makePayee();
  const key = `dup:${nonce()}`;
  const post = () =>
    withTransaction((s) =>
      payeeLedger.postEntry(s, {
        payee: payee._id,
        kind: PAYEE_LEDGER_KIND.PURCHASE,
        amountPoisha: toPoisha(100),
        idempotencyKey: key,
        refType: 'purchase',
      })
    );

  const first = await post();
  const second = await post();

  // The second call returns the first entry rather than moving the due again.
  assert.equal(String(first._id), String(second._id));
  assert.equal((await Payee.findById(payee._id)).duePoisha, toPoisha(100));
  assert.equal(await PayeeLedgerEntry.countDocuments({ payee: payee._id }), 1);
});

test('a payee ledger entry can never be edited or deleted', async () => {
  const payee = await makePayee();
  const entry = await withTransaction((s) =>
    payeeLedger.postEntry(s, {
      payee: payee._id,
      kind: PAYEE_LEDGER_KIND.PURCHASE,
      amountPoisha: toPoisha(100),
      idempotencyKey: `t:${nonce()}`,
      refType: 'purchase',
    })
  );

  await assert.rejects(
    () => PayeeLedgerEntry.updateOne({ _id: entry._id }, { $set: { amountPoisha: 1 } }),
    /append-only/
  );
  await assert.rejects(() => PayeeLedgerEntry.deleteOne({ _id: entry._id }), /append-only/);
});

test('concurrent payee entries keep a gap-free sequence and a coherent due', async () => {
  const payee = await makePayee();

  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      withTransaction((s) =>
        payeeLedger.postEntry(s, {
          payee: payee._id,
          kind: PAYEE_LEDGER_KIND.PURCHASE,
          amountPoisha: toPoisha(10 + i),
          idempotencyKey: `race:${i}:${nonce()}`,
          refType: 'purchase',
        })
      )
    )
  );

  const report = await payeeLedger.reconcile(payee._id);
  assert.ok(report.ok, report.problems.join('; '));
  assert.equal(report.entries, 12);
  const { duePoisha } = await payeeLedger.computeDue(payee._id);
  assert.equal(duePoisha, report.payeeDuePoisha);
});

/* ------------------------------------------------------------ supply stock */

test('a receipt raises the count and re-averages the cost', async () => {
  const supply = await makeSupply();

  // 100 at 80, then 100 at 88.
  await withTransaction((s) =>
    supplyStock.postMovement(s, {
      supply: supply._id,
      kind: MOVEMENT_KIND.PURCHASE,
      qtyMilli: toMilli(100),
      unitCostPoisha: toPoisha(80),
      idempotencyKey: `r1:${nonce()}`,
      refType: 'purchase',
    })
  );
  await withTransaction((s) =>
    supplyStock.postMovement(s, {
      supply: supply._id,
      kind: MOVEMENT_KIND.PURCHASE,
      qtyMilli: toMilli(100),
      unitCostPoisha: toPoisha(88),
      idempotencyKey: `r2:${nonce()}`,
      refType: 'purchase',
    })
  );

  const after = await Supply.findById(supply._id);
  assert.equal(after.onHandMilli, toMilli(200));
  assert.equal(after.avgCostPoisha, toPoisha(84));
  assert.ok((await supplyStock.reconcile(supply._id)).ok);
});

test('consumption is allowed to take a supply negative rather than refuse a parcel', async () => {
  const supply = await makeSupply({ opening: toMilli(2), openingCostPoisha: toPoisha(88) });
  const orderId = new (require('mongoose').Types.ObjectId)();

  await withTransaction((s) =>
    supplyStock.consume(s, {
      supply: supply._id,
      qtyMilli: toMilli(5),
      unitCostPoisha: toPoisha(88),
      orderId,
    })
  );

  const after = await Supply.findById(supply._id);
  // Five went out and only two were on the books. Negative is the honest answer.
  assert.equal(after.onHandMilli, -toMilli(3));

  const movement = await StockMovement.findOne({ supply: supply._id, kind: MOVEMENT_KIND.CONSUMED });
  // Worked out from a recipe, not counted.
  assert.equal(movement.isEstimated, true);
  assert.ok((await supplyStock.reconcile(supply._id)).ok);
});

test('a deliberate take is guarded, unlike consumption', async () => {
  const supply = await makeSupply({ opening: toMilli(2) });

  await assert.rejects(
    () =>
      withTransaction((s) =>
        supplyStock.adjust(s, {
          supply: supply._id,
          kind: MOVEMENT_KIND.RETURN_TO_PAYEE,
          qtyMilli: -toMilli(5),
          nonce: nonce(),
          allowNegative: false,
        })
      ),
    /is left/
  );

  // Refused means nothing moved.
  assert.equal((await Supply.findById(supply._id)).onHandMilli, toMilli(2));
});

test('delivering the same order twice consumes once', async () => {
  const supply = await makeSupply({ opening: toMilli(10), openingCostPoisha: toPoisha(88) });
  const orderId = new (require('mongoose').Types.ObjectId)();

  const consume = () =>
    withTransaction((s) =>
      supplyStock.consume(s, { supply: supply._id, qtyMilli: toMilli(3), orderId })
    );

  const first = await consume();
  const second = await consume();

  assert.equal(String(first._id), String(second._id));
  assert.equal((await Supply.findById(supply._id)).onHandMilli, toMilli(7));
  // The opening movement and one consumption, not two consumptions.
  assert.equal(await StockMovement.countDocuments({ supply: supply._id }), 2);
});

test('a stock take posts only the difference, and nothing when it already agrees', async () => {
  const supply = await makeSupply({ opening: toMilli(100), openingCostPoisha: toPoisha(88) });

  // The shelf really holds 94.
  const movement = await withTransaction((s) =>
    supplyStock.stockTake(s, { supply: supply._id, countedMilli: toMilli(94), nonce: nonce() })
  );
  assert.equal(movement.qtyMilli, -toMilli(6));
  assert.equal(movement.kind, MOVEMENT_KIND.ADJUSTMENT);
  // Somebody looked at the shelf, so this is evidence and not an estimate.
  assert.equal(movement.isEstimated, false);
  assert.equal((await Supply.findById(supply._id)).onHandMilli, toMilli(94));

  // Counting again and finding it right writes nothing: a movement of zero is
  // not a fact.
  const none = await withTransaction((s) =>
    supplyStock.stockTake(s, { supply: supply._id, countedMilli: toMilli(94), nonce: nonce() })
  );
  assert.equal(none, null);
  // The opening movement and the one correction. Nothing for the count that agreed.
  assert.equal(await StockMovement.countDocuments({ supply: supply._id }), 2);
});

test('the variance report separates what was estimated from what was counted', async () => {
  const supply = await makeSupply({ opening: toMilli(100), openingCostPoisha: toPoisha(500) });
  const mongoose = require('mongoose');

  // Two deliveries consumed 10 by recipe...
  await withTransaction((s) =>
    supplyStock.consume(s, {
      supply: supply._id,
      qtyMilli: toMilli(6),
      orderId: new mongoose.Types.ObjectId(),
    })
  );
  await withTransaction((s) =>
    supplyStock.consume(s, {
      supply: supply._id,
      qtyMilli: toMilli(4),
      orderId: new mongoose.Types.ObjectId(),
    })
  );
  // ...and the count says two more than that actually went.
  await withTransaction((s) =>
    supplyStock.stockTake(s, { supply: supply._id, countedMilli: toMilli(88), nonce: nonce() })
  );

  const [row] = await supplyStock.variance({ supplyId: supply._id });
  assert.equal(row.estimatedMilli, -toMilli(10));
  assert.equal(row.countedAdjustmentMilli, -toMilli(2));

  // The recipe understates: 12 really went out where it predicted 10.
  const { recipeAccuracy } = require('../src/domain/packaging');
  const accuracy = recipeAccuracy({
    estimatedMilli: row.estimatedMilli,
    countedMilli: row.countedAdjustmentMilli,
  });
  assert.equal(accuracy.actualMilli, toMilli(12));
  assert.equal(accuracy.ratio, 1.2);
});

test('a stock movement can never be edited or deleted', async () => {
  const supply = await makeSupply({ opening: toMilli(5) });
  const movement = await withTransaction((s) =>
    supplyStock.adjust(s, {
      supply: supply._id,
      kind: MOVEMENT_KIND.DAMAGED,
      qtyMilli: -toMilli(1),
      nonce: nonce(),
    })
  );

  await assert.rejects(
    () => StockMovement.updateOne({ _id: movement._id }, { $set: { qtyMilli: 1 } }),
    /append-only/
  );
  await assert.rejects(() => StockMovement.deleteOne({ _id: movement._id }), /append-only/);
});

/* --------------------------------------------------------------- purchases */

test('recording a purchase shelves the goods and bills the seller, together', async () => {
  const { user: owner } = await f.makeOwner();
  const payee = await makePayee();
  const crate = await makeSupply();
  const paper = await makeSupply({ nameBn: 'কাগজ', unit: 'sheet' });

  const purchase = await purchaseService.recordPurchase({
    payeeId: payee._id,
    lines: [
      { supplyId: crate._id, qtyMilli: toMilli(100), unitCostPoisha: toPoisha(80) },
      { supplyId: paper._id, qtyMilli: toMilli(500), unitCostPoisha: toPoisha(2) },
    ],
    charges: [
      { kind: 'loading', amountPoisha: toPoisha(200), paidTo: CHARGE_PAID_TO.PAYEE },
      // Cash to a van driver at the gate: costs money, owes the seller nothing.
      { kind: 'transport', amountPoisha: toPoisha(600), paidTo: CHARGE_PAID_TO.OTHER },
    ],
    allocationBasis: ALLOCATION_BASIS.VALUE,
    actorUser: owner,
  });

  assert.equal(purchase.status, PURCHASE_STATUS.RECEIVED);
  assert.ok(purchase.purchaseCode.startsWith('P'));

  // Goods 8000 + 1000 = 9000 taka; charges 800; total 9800.
  assert.equal(purchase.goodsCostPoisha, toPoisha(9000));
  assert.equal(purchase.totalPoisha, toPoisha(9800));
  // Only the seller's own charge is owed to the seller.
  assert.equal(purchase.payeeTotalPoisha, toPoisha(9200));
  assert.equal(purchase.otherChargePoisha, toPoisha(600));

  // The shelf.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, toMilli(100));
  assert.equal((await Supply.findById(paper._id)).onHandMilli, toMilli(500));

  // Landed, not the rate: every charge is spread across the lines by value.
  const crateLine = purchase.lines.find((l) => String(l.supply) === String(crate._id));
  assert.ok(crateLine.landedUnitCostPoisha > toPoisha(80));
  assert.equal(
    purchase.lines.reduce((sum, l) => sum + l.landedLineCostPoisha, 0),
    purchase.totalPoisha
  );
  // The average cost on the supply is the landed figure, not what was quoted.
  assert.equal((await Supply.findById(crate._id)).avgCostPoisha, crateLine.landedUnitCostPoisha);

  // The bill.
  assert.equal((await Payee.findById(payee._id)).duePoisha, toPoisha(9200));
  assert.ok((await payeeLedger.reconcile(payee._id)).ok);
  assert.ok((await supplyStock.reconcile(crate._id)).ok);
});

test('a purchase billed entirely to a third party owes the payee nothing', async () => {
  const payee = await makePayee();
  const crate = await makeSupply();

  const purchase = await purchaseService.recordPurchase({
    payeeId: payee._id,
    // Free crates, but the van still had to be paid.
    lines: [{ supplyId: crate._id, qtyMilli: toMilli(10), unitCostPoisha: 0 }],
    charges: [{ kind: 'transport', amountPoisha: toPoisha(300), paidTo: CHARGE_PAID_TO.OTHER }],
  });

  assert.equal(purchase.payeeTotalPoisha, 0);
  assert.equal(purchase.totalPoisha, toPoisha(300));
  // No due, and no zero-amount entry cluttering the ledger.
  assert.equal((await Payee.findById(payee._id)).duePoisha, 0);
  assert.equal(await PayeeLedgerEntry.countDocuments({ payee: payee._id }), 0);
  // The crates still cost 30 taka each to get here.
  assert.equal((await Supply.findById(crate._id)).avgCostPoisha, toPoisha(30));
});

test('cancelling a purchase reverses the stock and the due together', async () => {
  const { user: owner } = await f.makeOwner();
  const payee = await makePayee();
  const crate = await makeSupply();

  const purchase = await purchaseService.recordPurchase({
    payeeId: payee._id,
    lines: [{ supplyId: crate._id, qtyMilli: toMilli(100), unitCostPoisha: toPoisha(80) }],
    actorUser: owner,
  });

  await purchaseService.cancelPurchase({
    purchaseId: purchase._id,
    reason: 'wrong seller',
    actorUser: owner,
  });

  const cancelled = await Purchase.findById(purchase._id);
  assert.equal(cancelled.status, PURCHASE_STATUS.CANCELLED);
  assert.equal(cancelled.cancelReason, 'wrong seller');

  // Both sides back to nothing, and both still reconcile.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, 0);
  assert.equal((await Payee.findById(payee._id)).duePoisha, 0);
  assert.ok((await supplyStock.reconcile(crate._id)).ok);
  assert.ok((await payeeLedger.reconcile(payee._id)).ok);

  // Reversed, not erased: the history says it happened and was undone.
  assert.equal(await StockMovement.countDocuments({ supply: crate._id }), 2);
  assert.equal(await PayeeLedgerEntry.countDocuments({ payee: payee._id }), 2);
});

test('a purchase cannot be cancelled twice', async () => {
  const payee = await makePayee();
  const crate = await makeSupply();
  const purchase = await purchaseService.recordPurchase({
    payeeId: payee._id,
    lines: [{ supplyId: crate._id, qtyMilli: toMilli(10), unitCostPoisha: toPoisha(80) }],
  });

  await purchaseService.cancelPurchase({ purchaseId: purchase._id, reason: 'a' });
  await assert.rejects(
    () => purchaseService.cancelPurchase({ purchaseId: purchase._id, reason: 'b' }),
    /already cancelled/i
  );

  // Still balanced after the refused second attempt.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, 0);
  assert.equal((await Payee.findById(payee._id)).duePoisha, 0);
});

test('cancelling a purchase whose goods are already used leaves the shelf short', async () => {
  const payee = await makePayee();
  const crate = await makeSupply();
  const mongoose = require('mongoose');

  const purchase = await purchaseService.recordPurchase({
    payeeId: payee._id,
    lines: [{ supplyId: crate._id, qtyMilli: toMilli(10), unitCostPoisha: toPoisha(80) }],
  });
  // The crates went out on parcels before anyone noticed the purchase was wrong.
  await withTransaction((s) =>
    supplyStock.consume(s, {
      supply: crate._id,
      qtyMilli: toMilli(8),
      orderId: new mongoose.Types.ObjectId(),
    })
  );

  await purchaseService.cancelPurchase({ purchaseId: purchase._id, reason: 'duplicate entry' });

  // 10 in, 8 out, 10 reversed. Negative, and correctly so: the shelf owes the
  // books eight crates and hiding that would be worse than showing it.
  assert.equal((await Supply.findById(crate._id)).onHandMilli, -toMilli(8));
  assert.ok((await supplyStock.reconcile(crate._id)).ok);
});

test('a purchase refuses the same supply on two lines', async () => {
  const payee = await makePayee();
  const crate = await makeSupply();

  await assert.rejects(
    () =>
      purchaseService.recordPurchase({
        payeeId: payee._id,
        lines: [
          { supplyId: crate._id, qtyMilli: toMilli(10), unitCostPoisha: toPoisha(80) },
          { supplyId: crate._id, qtyMilli: toMilli(5), unitCostPoisha: toPoisha(90) },
        ],
      }),
    /two lines/
  );
  assert.equal(await Purchase.countDocuments({}), 0);
});

test('a purchase refuses an archived payee or supply', async () => {
  const live = await makePayee();
  const archivedPayee = await makePayee({ isArchived: true });
  const crate = await makeSupply();
  const archivedSupply = await makeSupply({ isArchived: true });

  await assert.rejects(
    () =>
      purchaseService.recordPurchase({
        payeeId: archivedPayee._id,
        lines: [{ supplyId: crate._id, qtyMilli: toMilli(1), unitCostPoisha: toPoisha(1) }],
      }),
    /archived/
  );
  await assert.rejects(
    () =>
      purchaseService.recordPurchase({
        payeeId: live._id,
        lines: [{ supplyId: archivedSupply._id, qtyMilli: toMilli(1), unitCostPoisha: toPoisha(1) }],
      }),
    /archived/
  );
});

/* ------------------------------------------------------------- paying them */

test('paying a payee lowers the due and is idempotent on its nonce', async () => {
  const { user: owner } = await f.makeOwner();
  const payee = await makePayee();
  const crate = await makeSupply();

  await purchaseService.recordPurchase({
    payeeId: payee._id,
    lines: [{ supplyId: crate._id, qtyMilli: toMilli(100), unitCostPoisha: toPoisha(80) }],
  });

  const key = nonce();
  const pay = () =>
    purchaseService.payPayee({
      payeeId: payee._id,
      amountPoisha: toPoisha(3000),
      nonce: key,
      paidFrom: 'bkash',
      actorUser: owner,
    });

  const first = await pay();
  const second = await pay();

  // A double-submitted form pays once.
  assert.equal(String(first._id), String(second._id));
  assert.equal((await Payee.findById(payee._id)).duePoisha, toPoisha(5000));
  assert.ok((await payeeLedger.reconcile(payee._id)).ok);
});

test('payables total what is owed, and ignore the payees holding an advance', async () => {
  const owed = await makePayee({ nameBn: 'পাওনাদার' });
  const advanced = await makePayee({ nameBn: 'অগ্রিম নেওয়া' });
  const crate = await makeSupply();

  await purchaseService.recordPurchase({
    payeeId: owed._id,
    lines: [{ supplyId: crate._id, qtyMilli: toMilli(100), unitCostPoisha: toPoisha(80) }],
  });
  await purchaseService.payPayee({
    payeeId: advanced._id,
    amountPoisha: toPoisha(1000),
    nonce: nonce(),
  });

  const total = await payeeLedger.totalPayablePoisha();
  // Only the 8000 owed. The advance is not a negative payable to be netted off:
  // it is money already gone and a different fact.
  assert.equal(total, toPoisha(8000));

  const rows = await payeeLedger.dueBalances({ owingOnly: true });
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].payee), String(owed._id));
});

test('a randomised run of purchases, cancels and payments always reconciles', async () => {
  const payee = await makePayee();
  const crate = await makeSupply();
  const purchases = [];

  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const p = await purchaseService.recordPurchase({
      payeeId: payee._id,
      lines: [{ supplyId: crate._id, qtyMilli: toMilli(5 + i), unitCostPoisha: toPoisha(70 + i) }],
      charges: i % 3 === 0 ? [{ kind: 'transport', amountPoisha: toPoisha(100 + i) }] : [],
    });
    purchases.push(p);

    if (i % 4 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await purchaseService.payPayee({
        payeeId: payee._id,
        amountPoisha: toPoisha(150),
        nonce: nonce(),
      });
    }
    if (i % 5 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await purchaseService.cancelPurchase({ purchaseId: p._id, reason: 'random' });
    }
  }

  const dueReport = await payeeLedger.reconcile(payee._id);
  assert.ok(dueReport.ok, dueReport.problems.join('; '));
  const stockReport = await supplyStock.reconcile(crate._id);
  assert.ok(stockReport.ok, stockReport.problems.join('; '));

  // The denormalised figures and the append-only records agree, which is the
  // whole point of keeping both.
  const { duePoisha } = await payeeLedger.computeDue(payee._id);
  assert.equal(duePoisha, (await Payee.findById(payee._id)).duePoisha);
  const { onHandMilli } = await supplyStock.computeOnHand(crate._id);
  assert.equal(onHandMilli, (await Supply.findById(crate._id)).onHandMilli);
});

test('reconcileAll sweeps every payee and supply', async () => {
  await makePayee();
  await makePayee({ nameBn: 'দুই' });
  await makeSupply();
  await makeSupply({ nameBn: 'কাগজ', unit: 'sheet' });

  const payees = await payeeLedger.reconcileAll({ batchSize: 1 });
  assert.equal(payees.checked, 2);
  assert.deepEqual(payees.drifted, []);

  const supplies = await supplyStock.reconcileAll({ batchSize: 1 });
  assert.equal(supplies.checked, 2);
  assert.deepEqual(supplies.drifted, []);
});

test('reconciliation notices a due that was tampered with behind the ledger', async () => {
  const payee = await makePayee();
  await withTransaction((s) =>
    payeeLedger.postEntry(s, {
      payee: payee._id,
      kind: PAYEE_LEDGER_KIND.PURCHASE,
      amountPoisha: toPoisha(100),
      idempotencyKey: `t:${nonce()}`,
      refType: 'purchase',
    })
  );

  // The ledger is append-only, but the denormalised field is not. This is
  // precisely what the nightly reconciliation exists to catch.
  await Payee.updateOne({ _id: payee._id }, { $set: { duePoisha: toPoisha(999) } });

  const report = await payeeLedger.reconcile(payee._id);
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /but payee due is/);
});

/* ---------------------------------------------------------- nightly sweep */

test('the nightly job reconciles the cost side and alerts on its drift', async () => {
  const { nightlyReconcile } = require('../src/jobs/nightlyReconcile');
  // The alert goes to an owner, so there has to be one to receive it.
  await f.makeOwner();
  const payee = await makePayee();
  const crate = await makeSupply({ opening: toMilli(50) });

  // Clean books: checked, nothing to say.
  const clean = await nightlyReconcile();
  assert.equal(clean.payeesChecked, 1);
  assert.equal(clean.suppliesChecked, 1);
  assert.equal(clean.payeeDrift, 0);
  assert.equal(clean.supplyDrift, 0);
  assert.equal(clean.alerted, 0);

  // Both denormalised figures tampered with behind their append-only logs. This
  // is the one class of bug neither log can catch on its own.
  await Payee.updateOne({ _id: payee._id }, { $set: { duePoisha: toPoisha(777) } });
  await Supply.updateOne({ _id: crate._id }, { $set: { onHandMilli: toMilli(999) } });

  const drifted = await nightlyReconcile();
  assert.equal(drifted.payeeDrift, 1);
  assert.equal(drifted.supplyDrift, 1);
  // A supply drift alone is worth waking the owner for, with no wallet drift.
  assert.equal(drifted.driftedCount, 0);
  assert.ok(drifted.alerted > 0, 'the owner was told');
});

test('the drift alert names whichever books actually drifted', () => {
  const { textFor } = require('../src/domain/notificationText');
  const { EVENT_TYPE } = require('../src/domain/constants');

  const costOnly = textFor(EVENT_TYPE.ALERT_LEDGER_DRIFT, {
    payeeDrift: 2,
    supplyDrift: 1,
    driftedCount: 0,
  });
  assert.match(costOnly.body, /পাওনাদার/);
  assert.match(costOnly.body, /ইনভেন্টরি/);
  // No wallet drift, so no reseller sentence invented.
  assert.doesNotMatch(costOnly.body, /রিসেলার/);

  // The pre-existing case still reads exactly as it did.
  const walletOnly = textFor(EVENT_TYPE.ALERT_LEDGER_DRIFT, {
    driftedCount: 1,
    shops: ['Test Shop'],
  });
  assert.match(walletOnly.body, /রিসেলারের হিসাব মিলছে না/);
  assert.match(walletOnly.body, /Test Shop/);
  assert.doesNotMatch(walletOnly.body, /ইনভেন্টরি/);
});
