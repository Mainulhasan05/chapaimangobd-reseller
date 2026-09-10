'use strict';

/*
 * End to end smoke test against the real servers.
 *
 * Starts an in-memory replica set, boots the Express API and the built Next app,
 * then walks the whole business flow over HTTP through the Next rewrite, exactly
 * as a browser would. This is what proves the two halves are actually connected:
 * the unit and API tests never exercise the proxy, the cookie path or SSR.
 *
 * Run with: node scripts/smoke.js   (build the frontend first)
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');

// Next bakes the rewrite destination into the build, so the smoke test has to
// use the same port the frontend was built against rather than a random one.
const API_PORT = Number(process.env.SMOKE_API_PORT ?? 4000);
const WEB_PORT = 3111;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

const OWNER = { phone: '01700000000', password: 'ownerpass123' };
const RESELLER = { phone: '01811111111', password: 'reseller123' };

const children = [];
let replset;

const log = (step, detail = '') => console.log(`  ${step}${detail ? ` ${detail}` : ''}`);

function fail(message) {
  throw new Error(message);
}

/** A cookie jar just big enough to act like one browser session. */
function makeSession() {
  const jar = new Map();

  return {
    async call(method, url, body, { raw = false } = {}) {
      const headers = {};
      if (jar.size > 0) {
        headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';

      const response = await fetch(`${WEB}${url}`, {
        method,
        headers,
        body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
        redirect: 'manual',
      });

      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (value === '' ) jar.delete(name);
        else jar.set(name, value);
      }

      if (raw) return response;

      const payload = await response.json().catch(() => null);
      return { status: response.status, body: payload };
    },
    get(url, opts) {
      return this.call('GET', url, undefined, opts);
    },
    post(url, body) {
      return this.call('POST', url, body);
    },
    patch(url, body) {
      return this.call('PATCH', url, body);
    },
    put(url, body) {
      return this.call('PUT', url, body);
    },
  };
}

function spawnProcess(name, command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  child.stdout.on('data', (chunk) => {
    if (process.env.SMOKE_VERBOSE) process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));

  return child;
}

async function waitFor(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`${label} did not come up within ${timeoutMs / 1000}s`);
}

async function main() {
  console.log('\nStarting an in-memory replica set (transactions need one)...');
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replset.getUri('smoke');

  const apiEnv = {
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    MONGODB_URI: uri,
    JWT_ACCESS_SECRET: 'smoke-access-secret-long-enough',
    JWT_REFRESH_SECRET: 'smoke-refresh-secret-long-enough',
    COOKIE_SECURE: 'false',
    APP_URL: WEB,
    OWNER_NAME: 'Owner',
    OWNER_PHONE: OWNER.phone,
    OWNER_PASSWORD: OWNER.password,
  };

  console.log('Seeding owner and demo data...');
  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['src/seed/seedDemo.js'], {
      cwd: BACKEND,
      env: { ...process.env, ...apiEnv },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('seed failed'))));
  });

  console.log('Booting the API...');
  spawnProcess('api', 'node', ['src/server.js'], BACKEND, apiEnv);
  await waitFor(`http://127.0.0.1:${API_PORT}/api/health`, 'API');

  console.log('Booting the web app...');
  spawnProcess('web', 'npx', ['next', 'start', '--port', String(WEB_PORT)], FRONTEND, {
    API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
  });
  await waitFor(`${WEB}/login`, 'Next');

  console.log('\nWalking the flow through the Next rewrite:\n');
  await runFlow();

  console.log('\nAll smoke checks passed.\n');
}

async function runFlow() {
  const anon = makeSession();

  // 1. The rewrite reaches the API without any CORS setup.
  const health = await anon.get('/api/health');
  if (health.status !== 200 || health.body.data.status !== 'up') fail('health check failed');
  log('health reachable at the web origin, so the rewrite works');

  // 2. The public shop renders server side, in Bengali.
  const shopPage = await anon.get('/r/demo-mango', { raw: true });
  if (shopPage.status !== 200) fail(`shop page returned ${shopPage.status}`);
  const html = await shopPage.text();
  if (!html.includes('Demo Mango Shop')) fail('shop name missing from server rendered html');
  if (!html.includes('হিমসাগর')) fail('Bengali product name missing from server rendered html');
  log('shop page server renders the shop name and Bengali product names');

  // 3. A customer orders, twice with the same submission id.
  const shop = await anon.get('/api/public/shop/demo-mango');
  if (shop.status !== 200) fail('shop api failed');
  const product = shop.body.data.products[0];
  if (!product.price) fail('expected a visible price on the demo product');

  const submissionId = crypto.randomUUID();
  const orderBody = {
    submissionId,
    paymentMode: 'cod',
    customer: {
      name: 'Smoke Customer',
      phone: '01912345678',
      address: '12 Test Road, Dhanmondi',
      district: 'Dhaka',
    },
    items: [{ product: product.id, quantity: 10 }],
  };

  const first = await anon.post('/api/public/shop/demo-mango/orders', orderBody);
  if (first.status !== 201) fail(`order failed: ${JSON.stringify(first.body)}`);
  const { orderCode } = first.body.data;

  const second = await anon.post('/api/public/shop/demo-mango/orders', orderBody);
  if (second.status !== 200 || second.body.data.duplicate !== true) {
    fail('a repeated submission id created a second order');
  }
  log(`order ${orderCode} placed, and the retry returned the same order`);

  // 4. Tracking needs the phone number as a second factor.
  const wrong = await anon.get(`/api/public/track/${orderCode}?phone=01911111111`);
  if (wrong.status !== 400) fail('tracking accepted the wrong phone number');
  const tracked = await anon.get(`/api/public/track/${orderCode}?phone=01912345678`);
  if (tracked.status !== 200 || tracked.body.data.order.status !== 'pending') fail('tracking failed');
  if (JSON.stringify(tracked.body.data.order).includes('costPrice')) {
    fail('the public tracking payload leaked a cost price');
  }
  log('tracking works with the phone number and leaks no cost price');

  // 5. The reseller signs in and confirms, which is where money moves.
  const reseller = makeSession();
  const login = await reseller.post('/api/auth/login', RESELLER);
  if (login.status !== 200) fail(`reseller login failed: ${JSON.stringify(login.body)}`);
  log('reseller signed in, cookies set through the rewrite as first party');

  const walletBefore = await reseller.get('/api/reseller/wallet');
  const startBalance = walletBefore.body.data.wallet.balance;

  const orders = await reseller.get('/api/reseller/orders?status=pending&limit=10');
  const pending = orders.body.data.orders.find((o) => o.orderCode === orderCode);
  if (!pending) fail('the new order did not appear on the reseller dashboard');

  const costSubtotal = pending.totals.costSubtotal;
  const delivery = pending.deliveryCharge;

  const confirmed = await reseller.post(`/api/reseller/orders/${pending.id}/confirm`, {
    items: [{ product: product.id, quantity: 10, sellPrice: product.price + 5 }],
  });
  if (confirmed.status !== 200) fail(`confirm failed: ${JSON.stringify(confirmed.body)}`);

  const walletAfter = await reseller.get('/api/reseller/wallet');
  const debited = startBalance - walletAfter.body.data.wallet.balance;
  const expected = costSubtotal + delivery;
  if (Math.abs(debited - expected) > 0.001) {
    fail(`wallet debited ${debited}, expected cost plus delivery of ${expected}`);
  }
  log(`confirm debited ${debited} taka, the cost plus delivery, not the selling price`);

  // 6. The owner walks it to delivered and the margin lands.
  const owner = makeSession();
  const ownerLogin = await owner.post('/api/auth/login', OWNER);
  if (ownerLogin.status !== 200) fail('owner login failed');

  // A reseller must not reach the owner panel, whatever the proxy allowed.
  const forbidden = await reseller.get('/api/owner/reports/dashboard');
  if (forbidden.status !== 403) fail('a reseller reached the owner API');
  log('role separation is enforced by the API, not just by the proxy');

  for (const [action, body] of [
    ['accept', {}],
    ['pack', {}],
    ['ship', { courierName: 'Sundarban', trackingNumber: 'SC-1001' }],
    ['deliver', {}],
  ]) {
    const res = await owner.post(`/api/owner/orders/${pending.id}/${action}`, body);
    if (res.status !== 200) fail(`${action} failed: ${JSON.stringify(res.body)}`);
  }
  log('owner walked the order to delivered');

  const walletFinal = await reseller.get('/api/reseller/wallet');
  const netChange = walletFinal.body.data.wallet.balance - startBalance;
  const margin = confirmed.body.data.order.totals.resellerMargin;
  if (Math.abs(netChange - margin) > 0.001) {
    fail(`net wallet change was ${netChange}, expected the margin of ${margin}`);
  }
  log(`cash on delivery settled: net position moved by the ${margin} taka margin`);

  // 7. Deposits credit once, however many times they are approved.
  const deposit = await reseller.post('/api/reseller/deposits', {
    amount: 1000,
    method: 'bkash',
    transactionId: `SMOKE-${Date.now()}`,
  });
  if (deposit.status !== 201) fail(`deposit request failed: ${JSON.stringify(deposit.body)}`);

  const beforeApproval = (await reseller.get('/api/reseller/wallet')).body.data.wallet.balance;
  const approve1 = await owner.post(`/api/owner/deposits/${deposit.body.data.deposit.id}/approve`, {});
  const approve2 = await owner.post(`/api/owner/deposits/${deposit.body.data.deposit.id}/approve`, {});
  if (approve1.status !== 200) fail('deposit approval failed');
  if (approve2.status === 200) fail('the same deposit was approved twice');

  const afterApproval = (await reseller.get('/api/reseller/wallet')).body.data.wallet.balance;
  if (Math.abs(afterApproval - beforeApproval - 1000) > 0.001) {
    fail(`deposit credited ${afterApproval - beforeApproval}, expected 1000`);
  }
  log('deposit approved once and credited once, despite a double approval');

  // 8. The ledger reconciles against the stored balance.
  const dashboard = await owner.get('/api/owner/reports/dashboard');
  if (dashboard.status !== 200) fail('owner dashboard failed');

  const reconcile = await owner.get('/api/owner/reports/reconcile');
  if (reconcile.status !== 200) fail('reconcile failed');
  if (reconcile.body.data.drifted.length > 0) {
    fail(`ledger drifted: ${JSON.stringify(reconcile.body.data.drifted)}`);
  }
  log(`ledger reconciles for all ${reconcile.body.data.checked} resellers`);

  // 9. The CSV export carries a byte order mark so Excel reads Bengali.
  const csv = await owner.get('/api/owner/exports/orders.csv', { raw: true });
  // Read the bytes, not text(): the fetch spec strips a leading BOM when
  // decoding, so text() would hide exactly the thing being checked.
  const bytes = Buffer.from(await csv.arrayBuffer());
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) {
    fail('the csv export has no byte order mark, so Excel will mangle Bengali');
  }
  if (!bytes.toString('utf8').includes('হিমসাগর')) {
    fail('the csv export lost the Bengali product name');
  }
  log('csv export keeps the byte order mark and Bengali text intact');

  // 10. Signing out actually revokes the session.
  await reseller.post('/api/auth/logout', {});
  const afterLogout = await reseller.get('/api/reseller/wallet');
  if (afterLogout.status !== 401) fail('the session still worked after logging out');
  log('logout revokes the session server side');
}

function shutdown() {
  for (const child of children) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // Already gone.
    }
  }
}

main()
  .then(async () => {
    shutdown();
    if (replset) await replset.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nSMOKE FAILED: ${err.message}\n`);
    shutdown();
    if (replset) await replset.stop().catch(() => {});
    process.exit(1);
  });
