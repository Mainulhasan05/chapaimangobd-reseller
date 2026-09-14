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
 *
 * It never reads backend/.env. Every variable the servers see is set below, the
 * integrations are blanked, and SKIP_DOTENV stops config/env.js from filling in
 * anything else, so a developer's real database, gateway, bot or bucket stays
 * untouched.
 *
 * One-time codes are read from the API's own log: with no SMS gateway and
 * NODE_ENV other than production, services/otp.js logs the code instead of
 * sending it, which is exactly what a developer without an SMS account sees.
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

/** The latest code the API logged, by `${phoneE164}:${purpose}`. */
const loggedCodes = new Map();

const log = (step, detail = '') => console.log(`  ${step}${detail ? ` ${detail}` : ''}`);

function fail(message) {
  throw new Error(message);
}

/** 01XXXXXXXXX to +8801XXXXXXXXX, the form the API stores and logs. */
const e164 = (local) => `+88${local}`;

/** Two amounts in taka agree to the poisha. */
const same = (a, b) => Math.abs(a - b) < 0.001;

/**
 * Reads pino's JSON lines for the "code logged instead" warning. Buffered,
 * because a chunk can end halfway through a line.
 */
function captureOtpCodes(stream) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (!line.includes('"code"')) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.code && entry.phone && entry.purpose) {
          loggedCodes.set(`${entry.phone}:${entry.purpose}`, String(entry.code));
        }
      } catch {
        // Not a JSON line.
      }
    }
  });
}

/** Waits for the API to log a code for this phone and purpose, and takes it. */
async function codeFor(phoneE164, purpose, timeoutMs = 10_000) {
  const key = `${phoneE164}:${purpose}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (loggedCodes.has(key)) {
      const code = loggedCodes.get(key);
      loggedCodes.delete(key);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return fail(`no ${purpose} code was logged for ${phoneE164}`);
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

  if (name === 'api') captureOtpCodes(child.stdout);
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

/**
 * Refuse to run against someone else's server. The frontend build hard-codes the
 * rewrite destination, so the smoke test has to use that exact port; if a
 * development API is already sitting on it, every call would silently hit the
 * real database instead of the throwaway one.
 */
async function assertPortFree() {
  try {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
  } catch {
    return; // Nothing listening, which is what we want.
  }

  fail(
    `Something is already serving the API on port ${API_PORT}. Stop your ` +
      'development server first, or the smoke test would run against your real ' +
      'database instead of a throwaway one.'
  );
}

async function main() {
  await assertPortFree();

  console.log('\nStarting an in-memory replica set (transactions need one)...');
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replset.getUri('smoke');

  const apiEnv = {
    // Never read backend/.env: see the note at the top of this file.
    SKIP_DOTENV: 'true',
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    MONGODB_URI: uri,
    JWT_ACCESS_SECRET: 'smoke-access-secret-long-enough-for-boot',
    JWT_REFRESH_SECRET: 'smoke-refresh-secret-long-enough-for-boot',
    OTP_PEPPER: 'smoke-otp-pepper-long-enough-for-boot-0000',
    COOKIE_SECURE: 'false',
    TRUST_PROXY: '0',
    LOG_LEVEL: 'info',
    APP_URL: WEB,
    // On, as in production, and walked below through the code the API logs.
    OWNER_DEVICE_OTP: 'true',
    RUN_JOBS: 'false',
    OWNER_NAME: 'Owner',
    OWNER_PHONE: OWNER.phone,
    OWNER_PASSWORD: OWNER.password,
    // Every integration blanked, whatever the shell happens to hold. Empty
    // counts as unset in config/env.js.
    AUTOMAS_API_KEY: '',
    AUTOMAS_SENDER_ID: '',
    SMS_API_KEY: '',
    SMS_SENDER_ID: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_BOT_USERNAME: '',
    TELEGRAM_WEBHOOK_URL: '',
    TELEGRAM_WEBHOOK_SECRET: '',
    PUBLIC_APP_URL: '',
    R2_ACCOUNT_ID: '',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
    R2_BUCKET: '',
    R2_PUBLIC_BUCKET: '',
    R2_PUBLIC_BASE_URL: '',
    IMGBB_API_KEY: '',
    VAPID_PUBLIC_KEY: '',
    VAPID_PRIVATE_KEY: '',
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
  if (health.status !== 200 || health.body.db !== 'up') fail('health check failed');
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

  // 5. Registration through the proxy: the phone is proved by a code first.
  const signup = makeSession();
  const newPhone = `019${String(Date.now()).slice(-8)}`;
  const registration = { name: 'রিফাত ম্যাঙ্গো ঘর', phone: newPhone, password: 'password123' };

  const withoutCode = await signup.post('/api/auth/register', registration);
  if (withoutCode.status !== 400) fail(`register without a code returned ${withoutCode.status}`);

  const sent = await signup.post('/api/auth/register/otp', { phone: newPhone });
  if (sent.status !== 200 || sent.body.data.sent !== true) {
    fail(`register otp failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  }
  const registered = await signup.post('/api/auth/register', {
    ...registration,
    otp: await codeFor(e164(newPhone), 'register'),
  });
  if (registered.status !== 201) {
    fail(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
  }
  const me = await signup.get('/api/auth/me');
  if (me.status !== 200) fail('the session from register did not work');
  if (me.body.data.profile.kycStatus !== 'not_submitted') fail('unexpected kyc status after register');
  log('registration proves the phone by OTP, then signs the new reseller straight in');

  // A registered number is refused before any code is sent.
  const duplicate = await makeSession().post('/api/auth/register/otp', { phone: newPhone });
  if (duplicate.status !== 400 || duplicate.body.error.code !== 'PHONE_TAKEN') {
    fail(`duplicate register returned ${duplicate.status} ${JSON.stringify(duplicate.body)}`);
  }
  log('a duplicate phone number is rejected cleanly');

  // 6. The reseller signs in and confirms, which is where money moves.
  const reseller = makeSession();
  const login = await reseller.post('/api/auth/login', RESELLER);
  if (login.status !== 200) fail(`reseller login failed: ${JSON.stringify(login.body)}`);
  log('reseller signed in, cookies set through the rewrite as first party');

  const balanceNow = async () =>
    (await reseller.get('/api/reseller/wallet')).body.data.wallet.balance;
  const startBalance = await balanceNow();

  const orders = await reseller.get('/api/reseller/orders?status=pending&limit=10');
  const pending = orders.body.data.orders.find((o) => o.orderCode === orderCode);
  if (!pending) fail('the new order did not appear on the reseller dashboard');

  const costSubtotal = pending.totals.costSubtotal;
  const delivery = pending.deliveryCharge;

  const confirmed = await reseller.post(`/api/reseller/orders/${pending.id}/confirm`, {
    items: [{ product: product.id, quantity: 10, sellPrice: product.price + 5 }],
  });
  if (confirmed.status !== 200) fail(`confirm failed: ${JSON.stringify(confirmed.body)}`);
  if (!Array.isArray(confirmed.body.data.order.actions)) {
    fail('confirm did not answer with the order and its actions');
  }

  const debited = startBalance - (await balanceNow());
  const expected = costSubtotal + delivery;
  if (!same(debited, expected)) {
    fail(`wallet debited ${debited}, expected cost plus delivery of ${expected}`);
  }
  log(`confirm debited ${debited} taka, the cost plus delivery, not the selling price`);

  // 7. The owner signs in from a device never seen before, which takes a code.
  const owner = makeSession();
  const ownerLogin = await owner.post('/api/auth/login', OWNER);
  if (ownerLogin.status !== 200 || ownerLogin.body.data.requiresOtp !== true) {
    fail(`owner login did not ask for a device code: ${JSON.stringify(ownerLogin.body)}`);
  }
  const verified = await owner.post('/api/auth/login/verify', {
    challengeId: ownerLogin.body.data.challengeId,
    otp: await codeFor(e164(OWNER.phone), 'owner_device'),
  });
  if (verified.status !== 200) {
    fail(`owner device verification failed: ${JSON.stringify(verified.body)}`);
  }
  if ((await owner.get('/api/owner/reports/dashboard')).status !== 200) {
    fail('the owner session from the verified login did not work');
  }

  const again = await owner.post('/api/auth/login', OWNER);
  if (again.status !== 200 || again.body.data.requiresOtp) {
    fail('a trusted device was asked for a code again');
  }
  log('owner login from a new device takes an OTP, and that device is trusted afterwards');

  // A reseller must not reach the owner panel, whatever the proxy allowed.
  const forbidden = await reseller.get('/api/owner/reports/dashboard');
  if (forbidden.status !== 403) fail('a reseller reached the owner API');
  log('role separation is enforced by the API, not just by the proxy');

  // The customer SMS preview renders without a gateway, and says it cannot send.
  const preview = await owner.get(
    `/api/owner/orders/${pending.id}/customer-sms-preview?action=accept`
  );
  if (preview.status !== 200) fail(`customer sms preview failed: ${JSON.stringify(preview.body)}`);
  if (preview.body.data.available !== false) {
    fail('customer sms claimed to be available with no gateway configured');
  }
  if (!preview.body.data.text || !preview.body.data.text.includes(orderCode)) {
    fail(`customer sms preview did not render the order: ${JSON.stringify(preview.body.data)}`);
  }
  log('customer sms preview renders the text and reports available: false with no gateway');

  const sources = (await owner.get('/api/owner/sources')).body.data.sources;
  if (sources.length === 0) fail('the demo seed has no sources');
  const acceptBody = (order) => ({
    sources: order.items.map((item) => ({ itemId: item.id, sourceId: sources[0]._id })),
  });

  // Asking to text the customer with no gateway is refused, and nothing moves.
  const unsendable = await owner.post(`/api/owner/orders/${pending.id}/accept`, {
    ...acceptBody(confirmed.body.data.order),
    sendCustomerSms: true,
  });
  if (unsendable.status !== 400 || unsendable.body.error.code !== 'SMS_UNAVAILABLE') {
    fail(`an accept asking for an unsendable sms returned ${JSON.stringify(unsendable.body)}`);
  }

  // 8. The owner walks it to delivered and the margin lands.
  let current = confirmed.body.data.order;
  for (const [action, body] of [
    ['accept', acceptBody(current)],
    ['pack', {}],
    ['ship', { courierName: 'Sundarban', trackingNumber: 'SC-1001' }],
    ['deliver', {}],
  ]) {
    const res = await owner.post(`/api/owner/orders/${pending.id}/${action}`, body);
    if (res.status !== 200) fail(`${action} failed: ${JSON.stringify(res.body)}`);
    current = res.body.data.order;
    if (!Array.isArray(current.actions)) fail(`${action} did not answer with the order actions`);
  }
  if (current.status !== 'delivered') fail(`expected delivered, got ${current.status}`);
  log('owner walked the order to delivered, each step answering with the order and its actions');

  const netChange = (await balanceNow()) - startBalance;
  const margin = confirmed.body.data.order.totals.resellerMargin;
  if (!same(netChange, margin)) {
    fail(`net wallet change was ${netChange}, expected the margin of ${margin}`);
  }
  log(`cash on delivery settled: net position moved by the ${margin} taka margin`);

  // 9. A second order: the delivery charge changes after confirm, then the
  //    parcel comes back from the courier and goes back on the shelf.
  const ownedProducts = async () => (await owner.get('/api/owner/products')).body.data.products;
  const owned = await ownedProducts();
  const stocked = shop.body.data.products.find((p) =>
    owned.some((o) => String(o.id) === String(p.id) && o.stockQty != null)
  );
  if (!stocked) fail('the demo shop has no stock-tracked product');
  const stockOf = async () =>
    (await ownedProducts()).find((p) => String(p.id) === String(stocked.id)).stockQty;

  const secondPlaced = await anon.post('/api/public/shop/demo-mango/orders', {
    submissionId: crypto.randomUUID(),
    paymentMode: 'cod',
    customer: {
      name: 'Return Customer',
      phone: '01912345670',
      address: '5 Lake Road, Gulshan',
      district: 'Dhaka',
    },
    items: [{ product: stocked.id, quantity: 6 }],
  });
  if (secondPlaced.status !== 201) fail(`second order failed: ${JSON.stringify(secondPlaced.body)}`);
  const secondList = await reseller.get('/api/reseller/orders?status=pending&limit=10');
  const returning = secondList.body.data.orders.find(
    (o) => o.orderCode === secondPlaced.body.data.orderCode
  );
  if (!returning) fail('the second order did not reach the reseller');

  const stockBefore = await stockOf();
  const beforeSecond = await balanceNow();
  const secondConfirmed = await reseller.post(`/api/reseller/orders/${returning.id}/confirm`, {});
  if (secondConfirmed.status !== 200) {
    fail(`second confirm failed: ${JSON.stringify(secondConfirmed.body)}`);
  }
  if (!same(await stockOf(), stockBefore - 6)) fail('confirm did not take the stock');

  const raisedTo = returning.deliveryCharge + 20;
  const adjusted = await owner.patch(`/api/owner/orders/${returning.id}/delivery-charge`, {
    deliveryCharge: raisedTo,
  });
  if (adjusted.status !== 200) fail(`delivery charge change failed: ${JSON.stringify(adjusted.body)}`);
  const adjustment = adjusted.body.data.adjustment;
  if (!adjustment || adjustment.kind !== 'DELIVERY_ADJUSTMENT' || !same(adjustment.amount, -20)) {
    fail(`expected a -20 DELIVERY_ADJUSTMENT entry, got ${JSON.stringify(adjustment)}`);
  }
  const secondDebit = secondConfirmed.body.data.order.totals.costSubtotal + raisedTo;
  if (!same(beforeSecond - (await balanceNow()), secondDebit)) {
    fail('the delivery adjustment did not move the wallet by the difference');
  }
  log('raising the delivery charge after confirm posted its own -20 adjustment entry');

  current = adjusted.body.data.order;
  for (const [action, body] of [
    ['accept', acceptBody(current)],
    ['pack', {}],
    ['ship', { courierName: 'Pathao' }],
  ]) {
    const res = await owner.post(`/api/owner/orders/${returning.id}/${action}`, body);
    if (res.status !== 200) fail(`${action} failed: ${JSON.stringify(res.body)}`);
    current = res.body.data.order;
  }
  const locked = await owner.patch(`/api/owner/orders/${returning.id}/delivery-charge`, {
    deliveryCharge: 10,
  });
  if (locked.status === 200) fail('the delivery charge changed after the parcel shipped');

  const returned = await owner.post(`/api/owner/orders/${returning.id}/return`, {
    reason: 'Customer refused the parcel',
    restock: true,
  });
  if (returned.status !== 200) fail(`return failed: ${JSON.stringify(returned.body)}`);
  const returnedOrder = returned.body.data.order;
  if (returnedOrder.status !== 'returned' || returnedOrder.restockedOnReturn !== true) {
    fail('the return was not recorded with its restock');
  }
  if (!same(await stockOf(), stockBefore)) fail('restock on return did not put the stock back');

  // By default the courier still charged for the trip, so the delivery charge
  // and its adjustment stand and only the goods are refunded (docs/adr/0008).
  const settings = (await owner.get('/api/owner/settings')).body.data.settings;
  const keptOnReturn = settings.reverseDeliveryChargeOnReturn ? 0 : raisedTo;
  const downAfterReturn = beforeSecond - (await balanceNow());
  if (!same(downAfterReturn, keptOnReturn)) {
    fail(`after the return the wallet is ${downAfterReturn} down, expected ${keptOnReturn}`);
  }
  log('returned from shipped with restock: the stock is back and the goods debit reversed');

  // 10. Deposits credit once, however many times they are approved.
  const deposit = await reseller.post('/api/reseller/deposits', {
    amount: 1000,
    method: 'bkash',
    transactionId: `SMOKE-${Date.now()}`,
  });
  if (deposit.status !== 201) fail(`deposit request failed: ${JSON.stringify(deposit.body)}`);

  const beforeApproval = await balanceNow();
  const approve1 = await owner.post(`/api/owner/deposits/${deposit.body.data.deposit.id}/approve`, {});
  const approve2 = await owner.post(`/api/owner/deposits/${deposit.body.data.deposit.id}/approve`, {});
  if (approve1.status !== 200) fail('deposit approval failed');
  if (approve2.status === 200) fail('the same deposit was approved twice');

  const afterApproval = await balanceNow();
  if (!same(afterApproval - beforeApproval, 1000)) {
    fail(`deposit credited ${afterApproval - beforeApproval}, expected 1000`);
  }
  log('deposit approved once and credited once, despite a double approval');

  // 11. A withdrawal pays out of the balance and never past it (docs/adr/0009).
  const tooMuch = await reseller.post('/api/reseller/withdrawals', {
    amount: Math.floor(afterApproval) + 1,
    method: 'bkash',
    destinationNumber: RESELLER.phone,
  });
  if (tooMuch.status !== 400) fail(`a withdrawal above the balance returned ${tooMuch.status}`);

  const withdrawal = await reseller.post('/api/reseller/withdrawals', {
    amount: 500,
    method: 'bkash',
    destinationNumber: RESELLER.phone,
  });
  if (withdrawal.status !== 201) fail(`withdrawal request failed: ${JSON.stringify(withdrawal.body)}`);
  const paid = await owner.post(
    `/api/owner/withdrawals/${withdrawal.body.data.withdrawal.id}/approve`,
    { payoutReference: 'BK-SMOKE-1' }
  );
  if (paid.status !== 200) fail(`withdrawal approval failed: ${JSON.stringify(paid.body)}`);
  if (!same(afterApproval - (await balanceNow()), 500)) fail('the withdrawal did not debit 500');

  const history = await reseller.get('/api/reseller/withdrawals?limit=1&page=1');
  if (history.status !== 200 || history.body.data.total !== 1 || history.body.data.withdrawals.length !== 1) {
    fail(`the withdrawal history is not paged: ${JSON.stringify(history.body)}`);
  }
  log('withdrawal refused above the balance, then approved and debited exactly once');

  // 12. The ledger reconciles against the stored balance.
  const dashboard = await owner.get('/api/owner/reports/dashboard');
  if (dashboard.status !== 200) fail('owner dashboard failed');

  const reconcile = await owner.get('/api/owner/reports/reconcile');
  if (reconcile.status !== 200) fail('reconcile failed');
  if (reconcile.body.data.drifted.length > 0) {
    fail(`ledger drifted: ${JSON.stringify(reconcile.body.data.drifted)}`);
  }
  log(`ledger reconciles for all ${reconcile.body.data.checked} resellers`);

  const inbox = await reseller.get('/api/reseller/notifications?limit=2');
  if (
    inbox.status !== 200 ||
    !('nextCursor' in inbox.body.data) ||
    typeof inbox.body.data.unread !== 'number'
  ) {
    fail(`the notification inbox is not paged: ${JSON.stringify(inbox.body)}`);
  }
  log('the notification inbox pages by cursor, with the unread count alongside');

  // 13. The CSV export carries a byte order mark so Excel reads Bengali.
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

  // 14. Signing out actually revokes the session.
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
