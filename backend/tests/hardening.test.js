'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { startDb, stopDb, resetDb, mongoose } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const Order = require('../src/models/Order');
const RefreshToken = require('../src/models/RefreshToken');
const tokens = require('../src/services/tokens');
const { csvCell } = require('../src/utils/csv');
const { formatDhakaDateTime } = require('../src/utils/dhakaTime');
const { PAYMENT_MODE } = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

/** The raw value of a cookie set by a supertest response, or null. */
function cookieFrom(res, name) {
  const header = res.headers['set-cookie'] || [];
  const line = header.find((c) => c.startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(name.length + 1).split(';')[0];
}

async function login() {
  const { phone, password, user } = await f.makeReseller();
  const res = await request(app).post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200);
  return { user, refresh: cookieFrom(res, tokens.REFRESH_COOKIE) };
}

const refreshWith = (raw) =>
  request(app).post('/api/auth/refresh').set('Cookie', `${tokens.REFRESH_COOKIE}=${raw}`);

/* ------------------------------------------------------------ error envelope */

test('malformed JSON is a 400 in the standard envelope, not a 500', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"phone": "0171');
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'BAD_JSON');
});

test('an oversized body is a 413 in the standard envelope', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ phone: 'x'.repeat(200 * 1024) }));
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('every response carries a request id, and a sane incoming one is kept', async () => {
  const fresh = await request(app).get('/api/nope');
  assert.match(fresh.headers['x-request-id'], /^[0-9a-f-]{36}$/);

  const kept = await request(app).get('/api/nope').set('X-Request-Id', 'edge-abc.123');
  assert.equal(kept.headers['x-request-id'], 'edge-abc.123');

  // Echoed into a header and every log line, so anything odd is replaced.
  const odd = await request(app).get('/api/nope').set('X-Request-Id', 'bad id <script>');
  assert.notEqual(odd.headers['x-request-id'], 'bad id <script>');
});

/* -------------------------------------------------------------------- health */

test('public health says only whether the database is up', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, db: 'up' });
});

test('public health is a 503 when the database does not answer', async (t) => {
  const { db } = mongoose.connection;
  // An own property shadows the prototype method for this one test.
  db.admin = () => ({ command: () => Promise.reject(new Error('no primary')) });
  t.after(() => {
    delete db.admin;
  });

  const res = await request(app).get('/api/health');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { ok: false, db: 'down' });
});

test('integration details are neither public nor for resellers', async () => {
  const anon = await request(app).get('/api/owner/system/health');
  assert.equal(anon.status, 401);

  const { phone, password } = await f.makeReseller();
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ phone, password });
  const reseller = await agent.get('/api/owner/system/health');
  assert.equal(reseller.status, 403);
});

/* ------------------------------------------------------------------- refresh */

test('refresh rotates the token and the new one works', async () => {
  const { refresh } = await login();

  const first = await refreshWith(refresh);
  assert.equal(first.status, 200);
  const next = cookieFrom(first, tokens.REFRESH_COOKIE);
  assert.ok(next && next !== refresh);

  const second = await refreshWith(next);
  assert.equal(second.status, 200);
});

test('replaying a rotated refresh token revokes the whole family', async () => {
  const { refresh, user } = await login();

  const rotated = await refreshWith(refresh);
  assert.equal(rotated.status, 200);
  const successor = cookieFrom(rotated, tokens.REFRESH_COOKIE);

  // Push the use outside the multi-tab grace window, so this is a replay, not a race.
  await RefreshToken.updateOne(
    { tokenHash: tokens.hashToken(refresh) },
    { $set: { usedAt: new Date(Date.now() - tokens.REUSE_GRACE_MS - 1000) } }
  );

  const replay = await refreshWith(refresh);
  assert.equal(replay.status, 401);

  const live = await RefreshToken.countDocuments({ user: user._id, revokedAt: null });
  assert.equal(live, 0, 'a token in the family survived the replay');

  // Whoever holds the successor is signed out too, which is the point.
  const afterReplay = await refreshWith(successor);
  assert.equal(afterReplay.status, 401);
});

test('concurrent refreshes with one token: exactly one succeeds, nobody is signed out', async () => {
  const { refresh, user } = await login();

  const results = await Promise.all(Array.from({ length: 6 }, () => refreshWith(refresh)));
  const winners = results.filter((r) => r.status === 200);
  assert.equal(winners.length, 1, `expected one winner, got ${winners.length}`);
  results
    .filter((r) => r.status !== 200)
    .forEach((r) => {
      assert.equal(r.status, 401);
      // Clearing cookies on a loser would wipe the winner's fresh ones in a shared jar.
      assert.equal(cookieFrom(r, tokens.REFRESH_COOKIE), null);
    });

  // A race inside the grace window is not theft: the winner's session lives on.
  const successor = cookieFrom(winners[0], tokens.REFRESH_COOKIE);
  assert.equal((await refreshWith(successor)).status, 200);
  assert.ok((await RefreshToken.countDocuments({ user: user._id, revokedAt: null })) >= 1);
});

test('logout revokes the family server side and clears cookies with their scope', async () => {
  const { refresh, user } = await login();

  const res = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', `${tokens.REFRESH_COOKIE}=${refresh}`);
  assert.equal(res.status, 200);

  const cleared = res.headers['set-cookie'];
  const access = cleared.find((c) => c.startsWith(`${tokens.ACCESS_COOKIE}=;`));
  const refreshCookie = cleared.find((c) => c.startsWith(`${tokens.REFRESH_COOKIE}=;`));
  assert.ok(access && refreshCookie, cleared.join('\n'));
  assert.match(access, /Path=\/;/);
  assert.match(access, /HttpOnly/);
  assert.match(access, /SameSite=Lax/);
  assert.match(refreshCookie, /Path=\/api\/auth;/);
  assert.match(refreshCookie, /HttpOnly/);

  assert.equal(await RefreshToken.countDocuments({ user: user._id, revokedAt: null }), 0);
  assert.equal((await refreshWith(refresh)).status, 401);
});

/* ----------------------------------------------------------------------- csv */

test('csv cells a spreadsheet would run as a formula are neutralised', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('+8801712345678'), "'+8801712345678");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tcmd'), "'\tcmd");
  assert.equal(csvCell('\rcmd'), `"'\rcmd"`);
  // Real numbers are data, including a negative balance.
  assert.equal(csvCell(-120.5), '-120.5');
  assert.equal(csvCell('Rahim, Dhaka'), '"Rahim, Dhaka"');
  assert.equal(csvCell(null), '');
});

test('csv timestamps are Dhaka wall-clock time', () => {
  // 20:30 UTC is 02:30 the next morning in Dhaka.
  assert.equal(formatDhakaDateTime(new Date('2026-06-01T20:30:00Z')), '2026-06-02 02:30:00');
});

test('the orders export escapes a customer name written as a formula', async () => {
  const owner = await f.makeOwner();
  const { profile } = await f.makeReseller();
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(profile, product, 62);

  const created = await request(app)
    .post(`/api/public/shop/${profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.PREPAID,
      customer: f.customer({ name: '=cmd|calc!A1' }),
      items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 10 }],
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(await Order.exists({ orderCode: created.body.data.orderCode }));

  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ phone: owner.phone, password: owner.password });
  const res = await agent.get('/api/owner/exports/orders.csv');

  assert.equal(res.status, 200);
  assert.equal(res.text.charCodeAt(0), 0xfeff);
  assert.ok(res.text.includes(",'=cmd|calc!A1,"), res.text);
  // The exporter's own phone formula is deliberate and left intact.
  assert.match(res.text, /,"=""\+880\d+""",/);
});
