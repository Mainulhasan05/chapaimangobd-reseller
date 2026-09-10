'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const money = require('../src/utils/money');
const quantity = require('../src/utils/quantity');
const phone = require('../src/utils/phone');
const dhaka = require('../src/utils/dhakaTime');
const slug = require('../src/utils/slug');
const orderCode = require('../src/utils/orderCode');

test('money converts taka to integer poisha without float drift', () => {
  assert.equal(money.toPoisha(55), 5500);
  assert.equal(money.toPoisha(0.1) + money.toPoisha(0.2), money.toPoisha(0.3));
  assert.equal(money.toPoisha('62.50'), 6250);
  // Rounds rather than truncates, so a third decimal does not silently vanish.
  assert.equal(money.toPoisha(12.345), 1235);
});

test('money rejects values that are not finite numbers', () => {
  assert.throws(() => money.toPoisha('abc'), /must be a number/);
  assert.throws(() => money.toPoisha(Infinity), /must be a number/);
});

test('line totals round per line, and an order total sums rounded lines', () => {
  // 2.5 kg at 55.55 taka is 138.875, which must land on a whole poisha.
  const line = money.lineTotalPoisha(money.toPoisha(55.55), quantity.toMilli(2.5));
  assert.equal(line, 13888);
  assert.ok(Number.isSafeInteger(line));

  const a = money.lineTotalPoisha(money.toPoisha(10.005), quantity.toMilli(1));
  const b = money.lineTotalPoisha(money.toPoisha(10.005), quantity.toMilli(1));
  assert.equal(a + b, 2002);
});

test('quantity enforces the product minimum and step', () => {
  const product = { unit: 'kg', minOrderQtyMilli: 5000, qtyStepMilli: 500 };

  assert.doesNotThrow(() => quantity.assertOrderable(5500, product));
  assert.throws(() => quantity.assertOrderable(4000, product), /Minimum order/);
  assert.throws(() => quantity.assertOrderable(5300, product), /multiple of/);
});

test('whole units default to a step of one', () => {
  assert.equal(quantity.defaultStepMilli('pcs'), 1000);
  assert.equal(quantity.defaultStepMilli('kg'), 250);
});

test('phone numbers normalise to one E.164 identity', () => {
  const expected = '+8801712345678';
  ['01712345678', '8801712345678', '+8801712345678', '+880 1712-345678', '(017) 1234 5678'].forEach(
    (input) => assert.equal(phone.normalizeBdPhone(input), expected)
  );
});

test('phone rejects numbers that are not Bangladeshi mobiles', () => {
  assert.throws(() => phone.normalizeBdPhone('01212345678'), /valid Bangladeshi/);
  assert.throws(() => phone.normalizeBdPhone('12345'), /valid Bangladeshi/);
});

test('the gateway wants the local form, not E.164', () => {
  assert.equal(phone.toLocalBd('+8801712345678'), '01712345678');
});

test('business dates follow Dhaka, not the server clock', () => {
  // 20:00 UTC is already the next calendar day in Dhaka, which is UTC+6.
  const lateUtc = new Date('2026-06-15T20:00:00Z');
  assert.equal(dhaka.businessDate(lateUtc), '2026-06-16');

  const earlyUtc = new Date('2026-06-15T02:00:00Z');
  assert.equal(dhaka.businessDate(earlyUtc), '2026-06-15');
});

test('a business day starts at Dhaka midnight, expressed in UTC', () => {
  assert.equal(dhaka.startOfBusinessDay('2026-06-15').toISOString(), '2026-06-14T18:00:00.000Z');
  assert.equal(dhaka.endOfBusinessDay('2026-06-15').toISOString(), '2026-06-15T18:00:00.000Z');
});

test('slugs stay ASCII and reserved route names are refused', () => {
  assert.equal(slug.slugify('Rifat Mango Ghor'), 'rifat-mango-ghor');
  assert.doesNotThrow(() => slug.assertValidSlug('rifat-mango'));
  assert.throws(() => slug.assertValidSlug('api'), /reserved/);
  assert.throws(() => slug.assertValidSlug('track'), /reserved/);
  assert.throws(() => slug.assertValidSlug('Bad Slug'), /lowercase/);
});

test('order codes avoid characters that are ambiguous over the phone', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(orderCode.generateOrderCode(), /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  }
});

test('order code lookup forgives what a customer actually types', () => {
  assert.equal(orderCode.normalizeOrderCode('ab-c0 iO'), 'ABC010');
});
