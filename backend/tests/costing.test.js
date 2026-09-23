'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { allocateByWeight, costPurchase } = require('../src/domain/landedCost');
const supplyValue = require('../src/domain/supplyValue');
const packaging = require('../src/domain/packaging');
const { ALLOCATION_BASIS, CHARGE_PAID_TO } = require('../src/domain/constants');

/* -------------------------------------------------------------- allocation */

test('allocation always sums to exactly the charge, however it divides', () => {
  // The case the naive round() gets wrong: three equal lines splitting 100.
  const even = allocateByWeight(100, [1, 1, 1]);
  assert.equal(
    even.reduce((a, b) => a + b, 0),
    100
  );
  assert.deepEqual(even, [34, 33, 33]);

  // Exhaustive over awkward totals and weightings: the invariant is the point.
  for (let total = 0; total <= 200; total += 1) {
    for (const weights of [[1, 1, 1], [1, 2, 3], [7, 11, 13, 17], [1], [999, 1]]) {
      const shares = allocateByWeight(total, weights);
      assert.equal(
        shares.reduce((a, b) => a + b, 0),
        total,
        `total ${total} over ${weights.join(',')} did not add up`
      );
      assert.ok(shares.every(Number.isSafeInteger), 'every share is a whole poisha');
      assert.ok(shares.every((s) => s >= 0), 'no share is negative');
    }
  }
});

test('allocation is proportional, and deterministic in a tie', () => {
  assert.deepEqual(allocateByWeight(600, [1000, 2000, 3000]), [100, 200, 300]);
  // Remainder goes to the earlier line, so re-costing gives the same answer.
  assert.deepEqual(allocateByWeight(10, [1, 1, 1]), allocateByWeight(10, [1, 1, 1]));
  assert.deepEqual(allocateByWeight(10, [1, 1, 1]), [4, 3, 3]);
});

test('allocation splits evenly when there is nothing to weigh on', () => {
  // Free goods still have to carry their share of the van.
  const shares = allocateByWeight(100, [0, 0]);
  assert.deepEqual(shares, [50, 50]);
});

/* ------------------------------------------------------------- landed cost */

test('landed cost is the rate plus a share of everything else', () => {
  // 100 crates at 80 taka, 600 taka van hire, 200 taka loading.
  const result = costPurchase(
    [{ supply: 'crate', qtyMilli: 100 * 1000, unitCostPoisha: 8000 }],
    [
      { kind: 'transport', amountPoisha: 60000 },
      { kind: 'loading', amountPoisha: 20000 },
    ]
  );

  assert.equal(result.goodsCostPoisha, 800000);
  assert.equal(result.chargeTotalPoisha, 80000);
  assert.equal(result.totalPoisha, 880000);
  // The number the owner actually asked for: 88 taka a crate, not 80.
  assert.equal(result.lines[0].landedUnitCostPoisha, 8800);
  assert.equal(result.lines[0].landedLineCostPoisha, 880000);
});

test('a charge paid to someone else costs money but owes the payee nothing', () => {
  const result = costPurchase(
    [{ qtyMilli: 100 * 1000, unitCostPoisha: 8000 }],
    [
      // Billed by the crate seller.
      { kind: 'loading', amountPoisha: 20000, paidTo: CHARGE_PAID_TO.PAYEE },
      // Cash to a van driver at the gate.
      { kind: 'transport', amountPoisha: 60000, paidTo: CHARGE_PAID_TO.OTHER },
    ]
  );

  // Both raise what a crate cost...
  assert.equal(result.lines[0].landedUnitCostPoisha, 8800);
  assert.equal(result.totalPoisha, 880000);
  // ...but only the seller's own charge is owed to the seller.
  assert.equal(result.payeeTotalPoisha, 820000);
  assert.equal(result.otherChargePoisha, 60000);
});

test('a charge marked not to allocate is still owed, but does not raise the goods', () => {
  const result = costPurchase(
    [{ qtyMilli: 100 * 1000, unitCostPoisha: 8000 }],
    [{ kind: 'commission', amountPoisha: 20000, allocate: false }]
  );

  assert.equal(result.lines[0].landedUnitCostPoisha, 8000, 'the crates still cost 80');
  assert.equal(result.lines[0].allocatedChargePoisha, 0);
  assert.equal(result.payeeTotalPoisha, 820000, 'but the commission is still owed');
  assert.equal(result.totalPoisha, 820000);
});

test('the allocation basis changes which line carries the charge', () => {
  // A cheap heavy line and an expensive light one.
  const lines = [
    { qtyMilli: 100 * 1000, unitCostPoisha: 1000 },
    { qtyMilli: 10 * 1000, unitCostPoisha: 10000 },
  ];
  const charges = [{ kind: 'transport', amountPoisha: 11000 }];

  const byValue = costPurchase(lines, charges, ALLOCATION_BASIS.VALUE);
  const byQty = costPurchase(lines, charges, ALLOCATION_BASIS.QUANTITY);

  // Equal value, so value splits it evenly.
  assert.deepEqual(byValue.lines.map((l) => l.allocatedChargePoisha), [5500, 5500]);
  // Ten times the quantity, so quantity puts ten times as much on the first.
  assert.deepEqual(byQty.lines.map((l) => l.allocatedChargePoisha), [10000, 1000]);

  // Whichever basis, the purchase costs the same in total.
  assert.equal(byValue.totalPoisha, byQty.totalPoisha);
});

test('every line sums back to the purchase total, across awkward splits', () => {
  const result = costPurchase(
    [
      { qtyMilli: 7000, unitCostPoisha: 333 },
      { qtyMilli: 11000, unitCostPoisha: 777 },
      { qtyMilli: 13000, unitCostPoisha: 1111 },
    ],
    [{ kind: 'transport', amountPoisha: 1000 }, { kind: 'labour', amountPoisha: 333 }]
  );

  const summed = result.lines.reduce((sum, l) => sum + l.landedLineCostPoisha, 0);
  assert.equal(summed, result.totalPoisha, 'no poisha invented or lost in the round trip');
});

test('costing refuses input that cannot be money or a quantity', () => {
  assert.throws(() => costPurchase([]), /at least one line/);
  assert.throws(() => costPurchase([{ qtyMilli: 0, unitCostPoisha: 100 }]), /positive whole/);
  assert.throws(() => costPurchase([{ qtyMilli: 1000, unitCostPoisha: 1.5 }]), /whole number/);
  assert.throws(
    () => costPurchase([{ qtyMilli: 1000, unitCostPoisha: 100 }], [{ amountPoisha: -1 }]),
    /cannot be negative/
  );
});

/* ----------------------------------------------------------- average cost */

test('average cost is weighted by what is held, not by how many lots there were', () => {
  // 100 at 80, then 100 at 88, is 84 — not 84 by luck, by weight.
  const after = supplyValue.nextAverage({
    onHandMilli: 100 * 1000,
    avgCostPoisha: 8000,
    receivedMilli: 100 * 1000,
    receivedUnitCostPoisha: 8800,
  });
  assert.equal(after, 8400);

  // 10 held at 80 and 90 arriving at 88 lands near the new lot, not halfway.
  const skewed = supplyValue.nextAverage({
    onHandMilli: 10 * 1000,
    avgCostPoisha: 8000,
    receivedMilli: 90 * 1000,
    receivedUnitCostPoisha: 8800,
  });
  assert.equal(skewed, 8720);
});

test('an empty or negative shelf takes the new rate outright', () => {
  assert.equal(
    supplyValue.nextAverage({
      onHandMilli: 0,
      avgCostPoisha: 9999,
      receivedMilli: 1000,
      receivedUnitCostPoisha: 8000,
    }),
    8000,
    'nothing held, so nothing to blend with'
  );

  // Negative on hand is a debt, not a holding: blending against it would give a
  // nonsense average, so the new lot simply sets the rate.
  assert.equal(
    supplyValue.nextAverage({
      onHandMilli: -20 * 1000,
      avgCostPoisha: 9999,
      receivedMilli: 100 * 1000,
      receivedUnitCostPoisha: 8000,
    }),
    8000
  );
});

test('holding value follows the count, including below zero', () => {
  assert.equal(supplyValue.holdingValuePoisha(340 * 1000, 8800), 2992000);
  assert.equal(supplyValue.holdingValuePoisha(0, 8800), 0);
  // Not clamped: a stock report that hid this would add up while being wrong.
  assert.equal(supplyValue.holdingValuePoisha(-5 * 1000, 8800), -44000);
});

test('low stock is off unless the owner set a level', () => {
  assert.equal(supplyValue.isLow({ onHandMilli: 0, reorderLevelMilli: 0 }), false);
  assert.equal(supplyValue.isLow({ onHandMilli: 50000, reorderLevelMilli: 50000 }), true);
  assert.equal(supplyValue.isLow({ onHandMilli: 51000, reorderLevelMilli: 50000 }), false);
});

/* -------------------------------------------------------------- packaging */

test('a variant with no packaging rule consumes nothing', () => {
  assert.deepEqual(packaging.expand(null, 3), []);
  assert.deepEqual(packaging.expand({}, 3), []);
  assert.deepEqual(packaging.expand({ packaging: [] }, 3), []);
});

test('a packaging rule multiplies by the boxes packed', () => {
  const variant = { packaging: [{ supply: 'crate', qtyMilli: 1000 }] };
  assert.deepEqual(packaging.expand(variant, 3), [{ supply: 'crate', qtyMilli: 3000 }]);
  // Nothing is packed, so nothing is consumed.
  assert.deepEqual(packaging.expand(variant, 0), []);
});

test('an order rolls its lines up per supply, not per line', () => {
  const variants = {
    big: { packaging: [{ supply: 'crate', qtyMilli: 1000 }, { supply: 'tape', qtyMilli: 500 }] },
    small: { packaging: [{ supply: 'crate', qtyMilli: 1000 }] },
  };
  const rows = packaging.forOrder(
    [{ variant: 'big', qty: 2 }, { variant: 'small', qty: 3 }],
    (id) => variants[id]
  );

  // Two box sizes that both take a crate are one movement of five, not two.
  const crate = rows.find((r) => r.supply === 'crate');
  assert.equal(crate.qtyMilli, 5000);
  assert.equal(rows.find((r) => r.supply === 'tape').qtyMilli, 1000);
  assert.equal(rows.length, 2);
});

test('the snapshot freezes the name and the cost at the moment it is recognised', () => {
  const rows = packaging.snapshot([{ supply: 'crate', qtyMilli: 3000 }], () => ({
    nameBn: 'ক্যারেট',
    avgCostPoisha: 8800,
  }));

  assert.equal(rows[0].supplyNameBn, 'ক্যারেট');
  assert.equal(rows[0].unitCostPoisha, 8800);
  assert.equal(rows[0].costPoisha, 26400);
  assert.equal(packaging.totalCostPoisha(rows), 26400);
});

test('a snapshot of a supply that has vanished still costs nothing rather than crashing', () => {
  const rows = packaging.snapshot([{ supply: 'gone', qtyMilli: 3000 }], () => null);
  assert.equal(rows[0].costPoisha, 0);
  assert.equal(packaging.totalCostPoisha([]), 0);
});

/* ------------------------------------------- the recipe is an estimate */

test('a recipe may use fractional units, which is why quantity is milli', () => {
  // An 11 kg box takes one crate, 1.5 sheets of paper and two needles.
  const big = {
    packaging: [
      { supply: 'crate', qtyMilli: 1000 },
      { supply: 'paper', qtyMilli: 1500 },
      { supply: 'needle', qtyMilli: 2000 },
    ],
  };

  const rows = packaging.expand(big, 4);
  assert.deepEqual(rows, [
    { supply: 'crate', qtyMilli: 4000 },
    // Six sheets for four boxes, and no float anywhere near it.
    { supply: 'paper', qtyMilli: 6000 },
    { supply: 'needle', qtyMilli: 8000 },
  ]);
});

test('a recipe refuses a duplicate supply rather than silently summing it', () => {
  assert.throws(
    () =>
      packaging.assertRecipe([
        { supply: 'crate', qtyMilli: 1000 },
        { supply: 'crate', qtyMilli: 2000 },
      ]),
    /already on the list/
  );
});

test('a recipe refuses a zero quantity and an over-long list', () => {
  assert.throws(() => packaging.assertRecipe([{ supply: 'paper', qtyMilli: 0 }]), /more than nothing/);
  const long = Array.from({ length: packaging.MAX_RECIPE_ROWS + 1 }, (_, i) => ({
    supply: `s${i}`,
    qtyMilli: 1000,
  }));
  assert.throws(() => packaging.assertRecipe(long), /at most/);
  // An empty recipe is legal: it means nothing is counted for this box.
  assert.doesNotThrow(() => packaging.assertRecipe([]));
});

test('the estimate says what an order will take, its cost, and what is short', () => {
  const variants = {
    big: {
      packaging: [
        { supply: 'crate', qtyMilli: 1000 },
        { supply: 'paper', qtyMilli: 1500 },
      ],
    },
    small: { packaging: [{ supply: 'crate', qtyMilli: 1000 }] },
  };
  const supplies = {
    crate: { nameBn: 'ক্যারেট', avgCostPoisha: 8800, onHandMilli: 10 * 1000 },
    // Only two sheets on the shelf, and the order wants three.
    paper: { nameBn: 'কাগজ', avgCostPoisha: 500, onHandMilli: 2 * 1000 },
  };

  const estimate = packaging.estimateForOrder(
    [{ variant: 'big', qty: 2 }, { variant: 'small', qty: 1 }],
    (id) => variants[id],
    (id) => supplies[id]
  );

  // Three crates (two big, one small) and three sheets.
  assert.equal(estimate.rows.find((r) => r.supply === 'crate').qtyMilli, 3000);
  assert.equal(estimate.rows.find((r) => r.supply === 'paper').qtyMilli, 3000);
  // 3 x 88 + 3 x 5 = 279 taka.
  assert.equal(estimate.totalCostPoisha, 27900);
  // Never presented as a measurement.
  assert.equal(estimate.isEstimated, true);

  // The shortage is information for the owner, not a refusal.
  assert.equal(estimate.shortages.length, 1);
  assert.equal(estimate.shortages[0].supplyNameBn, 'কাগজ');
  assert.equal(estimate.shortages[0].shortMilli, 1000);
});

test('an order whose boxes have no recipe estimates nothing and is not short', () => {
  const estimate = packaging.estimateForOrder(
    [{ variant: 'plain', qty: 5 }],
    () => ({ packaging: [] }),
    () => null
  );
  assert.deepEqual(estimate.rows, []);
  assert.equal(estimate.totalCostPoisha, 0);
  assert.deepEqual(estimate.shortages, []);
});

test('recipe accuracy says whether the estimate is believable yet', () => {
  // Estimates said 100 sheets; stock takes corrected down by 20, so 120 really
  // went out and the recipe understates by a fifth.
  const under = packaging.recipeAccuracy({ estimatedMilli: 100000, countedMilli: -20000 });
  assert.equal(under.actualMilli, 120000);
  assert.equal(under.ratio, 1.2);

  // Corrected upwards: less was used than the recipe claims.
  const over = packaging.recipeAccuracy({ estimatedMilli: 100000, countedMilli: 10000 });
  assert.equal(over.ratio, 0.9);

  // Nothing estimated yet is not the same statement as a perfect recipe.
  assert.equal(packaging.recipeAccuracy({ estimatedMilli: 0, countedMilli: 0 }).ratio, null);
});
