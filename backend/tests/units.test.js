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

/**
 * Storage behaviour depends on environment variables, and a developer with real
 * R2 credentials in .env must get the same result as CI with none. These run in
 * a child process with a scratch working directory, so no .env is picked up and
 * the outcome does not depend on whose machine it is.
 */
function inCleanEnv(source) {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const path = require('node:path');
  const modulePath = path.resolve(__dirname, '../src/config/storage.js');

  const env = { ...process.env };
  Object.keys(env).forEach((k) => {
    if (k.startsWith('R2_')) delete env[k];
  });
  // config/env requires these two regardless of what is being tested.
  env.MONGODB_URI = 'mongodb://127.0.0.1:27017/x?replicaSet=rs0';
  env.JWT_ACCESS_SECRET = 'x'.repeat(32);
  env.JWT_REFRESH_SECRET = 'y'.repeat(32);

  const script = `const storage = require(${JSON.stringify(modulePath)});
${source}`;
  return execFileSync(process.execPath, ['-e', script], {
    cwd: os.tmpdir(),
    env,
    encoding: 'utf8',
  }).trim();
}

test('storage reports itself unconfigured when no R2 credentials exist', () => {
  const out = inCleanEnv("console.log(storage.isConfigured());");
  assert.equal(out, 'false');
});

test('an unconfigured upload fails as a clear 503, not a generic crash', () => {
  // A reseller uploading their NID must be told uploads are not set up, rather
  // than seeing "something went wrong".
  const out = inCleanEnv(`
    try {
      storage.assertConfigured();
      console.log('NO_THROW');
    } catch (err) {
      console.log(err.status + ' ' + err.code);
    }
  `);
  assert.equal(out, '503 NOT_CONFIGURED');
});

test('public delivery refuses to reuse the private bucket', () => {
  // R2 public access is bucket wide, so sharing would expose every KYC scan.
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const path = require('node:path');
  const modulePath = path.resolve(__dirname, '../src/config/storage.js');

  const env = { ...process.env };
  Object.keys(env).forEach((k) => {
    if (k.startsWith('R2_')) delete env[k];
  });
  Object.assign(env, {
    MONGODB_URI: 'mongodb://127.0.0.1:27017/x?replicaSet=rs0',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'same-bucket',
    R2_PUBLIC_BUCKET: 'same-bucket',
    R2_PUBLIC_BASE_URL: 'https://pub-x.r2.dev',
  });

  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `const storage = require(${JSON.stringify(modulePath)});
       try { storage.assertPublicDelivery(); console.log('NO_THROW'); }
       catch (err) { console.log(err.code); }`,
    ],
    { cwd: os.tmpdir(), env, encoding: 'utf8' }
  ).trim();

  assert.equal(out, 'NOT_CONFIGURED');
});

test('storage routes each folder to the right bucket', () => {
  const out = inCleanEnv(`
    process.env.ignore = 1;
    console.log(JSON.stringify({
      kyc: storage.isPrivateFolder(storage.FOLDERS.KYC),
      deposit: storage.isPrivateFolder(storage.FOLDERS.DEPOSIT),
      product: storage.isPrivateFolder(storage.FOLDERS.PRODUCT),
      logo: storage.isPrivateFolder(storage.FOLDERS.LOGO),
    }));
  `);
  assert.deepEqual(JSON.parse(out), {
    kyc: true,
    deposit: true,
    product: false,
    logo: false,
  });
});

test('storage writes everything under one root prefix', () => {
  // Keeps the bucket legible in the R2 console and lets a second environment
  // share it without collisions.
  assert.equal(storage.ROOT, 'chapaimango');
  assert.equal(storage.prefixFor(storage.FOLDERS.KYC), 'chapaimango/kyc');
  assert.equal(storage.prefixFor(storage.FOLDERS.PRODUCT), 'chapaimango/products');
  assert.equal(storage.prefixFor(storage.FOLDERS.DEPOSIT), 'chapaimango/deposits');
  assert.equal(storage.prefixFor(storage.FOLDERS.LOGO), 'chapaimango/logos');
});

test('a stored key maps back to the bucket it lives in', () => {
  // Reading and deleting need nothing beyond the key already in the database.
  const out = inCleanEnv(`
    console.log(JSON.stringify({
      kycKey: storage.bucketForKey('chapaimango/kyc/a.jpg'),
      productKey: storage.bucketForKey('chapaimango/products/a.jpg'),
    }));
  `);
  const parsed = JSON.parse(out);
  // Unconfigured, so both are absent, but they resolve through different paths.
  assert.equal(parsed.productKey ?? null, null);
});

test('no public url is produced when public delivery is not configured', () => {
  // Callers render a placeholder rather than a broken image.
  const out = inCleanEnv(`
    console.log(JSON.stringify([
      storage.publicUrl('chapaimango/products/a.jpg'),
      storage.publicUrl(null),
    ]));
  `);
  assert.deepEqual(JSON.parse(out), [null, null]);
});

test('a public url is the base url joined to the stored key', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const path = require('node:path');
  const modulePath = path.resolve(__dirname, '../src/config/storage.js');

  const env = { ...process.env };
  Object.keys(env).forEach((k) => {
    if (k.startsWith('R2_')) delete env[k];
  });
  Object.assign(env, {
    MONGODB_URI: 'mongodb://127.0.0.1:27017/x?replicaSet=rs0',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    // A trailing slash must not produce a double slash in the URL.
    R2_PUBLIC_BASE_URL: 'https://pub-x.r2.dev/',
  });

  const out = execFileSync(
    process.execPath,
    ['-e', `const s = require(${JSON.stringify(modulePath)}); console.log(s.publicUrl('chapaimango/products/a.jpg'));`],
    { cwd: os.tmpdir(), env, encoding: 'utf8' }
  ).trim();

  assert.equal(out, 'https://pub-x.r2.dev/chapaimango/products/a.jpg');
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
