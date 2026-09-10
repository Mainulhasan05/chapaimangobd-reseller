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

/* ------------------------------------------------------------------ storage */

const storage = require('../src/config/storage');
const orderSearch = require('../src/utils/orderSearch');

test('storage refuses to work when R2 is not configured', () => {
  // The test environment has no R2 credentials, which is the point: an
  // unconfigured integration must fail as a clear 503, not a generic crash.
  assert.equal(storage.isConfigured(), false);
  try {
    storage.assertConfigured();
    assert.fail('expected assertConfigured to throw');
  } catch (err) {
    assert.equal(err.status, 503);
    assert.equal(err.code, 'NOT_CONFIGURED');
  }
});

test('storage knows which folders must stay private', () => {
  // KYC scans and bKash screenshots are the sensitive ones; a mistake here
  // would put a national ID behind a guessable public URL.
  assert.equal(storage.isPrivateFolder(storage.FOLDERS.KYC), true);
  assert.equal(storage.isPrivateFolder(storage.FOLDERS.DEPOSIT), true);
  assert.equal(storage.isPrivateFolder(storage.FOLDERS.PRODUCT), false);
  assert.equal(storage.isPrivateFolder(storage.FOLDERS.LOGO), false);
});

test('storage returns no public url when delivery is not configured', () => {
  // Callers render a placeholder rather than a broken image.
  assert.equal(storage.publicUrl('products/abc.jpg'), null);
  assert.equal(storage.publicUrl(null), null);
});

/* -------------------------------------------------------------- order search */

test('order search escapes regex metacharacters in a typed term', () => {
  // A customer name reaching new RegExp unescaped is an injection, and a stray
  // bracket would throw and take the whole order list down.
  const escaped = orderSearch.escapeRegex('a.b*c[d]');
  assert.doesNotThrow(() => new RegExp(escaped));
  assert.match('a.b*c[d]', new RegExp(escaped));
  // The escaped term must match literally, never as a wildcard.
  assert.doesNotMatch('axbxcxdx', new RegExp(`^${escaped}$`));
});

test('order search escapes a backslash, which is the case that broke the build', () => {
  const escaped = orderSearch.escapeRegex('back\slash');
  assert.doesNotThrow(() => new RegExp(escaped));
  assert.match('back\slash', new RegExp(escaped));
});

test('order search matches a phone by its tail, and ignores short digit runs', () => {
  const filter = orderSearch.orderSearchFilter('01712345678');
  const phoneClause = filter.$or.find((c) => c['customer.phoneE164']);
  assert.ok(phoneClause, 'expected a phone clause for an 11 digit term');
  assert.match('+8801712345678', phoneClause['customer.phoneE164']);

  // Three digits would match most of the collection, so no phone clause.
  assert.equal(
    orderSearch.orderSearchFilter('123').$or.some((c) => c['customer.phoneE164']),
    false
  );
});

test('order search returns null for an empty term', () => {
  assert.equal(orderSearch.orderSearchFilter(''), null);
  assert.equal(orderSearch.orderSearchFilter('   '), null);
});
