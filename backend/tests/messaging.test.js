'use strict';

/*
 * Phase F, messaging. Customer SMS on accept, ship and cancel (docs/adr/0013),
 * the Telegram bot, notification preferences, and the push payload.
 *
 * Nothing here reaches a real gateway or Telegram: the SMS gateway is fetch
 * stubbed per test, and Telegram is a stub client put in the registry.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const env = require('../src/config/env');
const orderService = require('../src/services/orderService');
const { drainOnce } = require('../src/services/outbox');
const { updateSettings } = require('../src/services/settings');
const { resolveChannels, notify } = require('../src/services/notify');
const telegram = require('../src/channels/telegram');
const telegramBot = require('../src/services/telegramBot');
const { setClient, createHttpClient } = require('../src/services/telegramClient');
const webpush = require('../src/channels/webpush');
const gsm7 = require('../src/utils/gsm7');
const customerSms = require('../src/domain/customerSms');

const Order = require('../src/models/Order');
const OutboxMessage = require('../src/models/OutboxMessage');
const SmsLog = require('../src/models/SmsLog');
const TelegramLink = require('../src/models/TelegramLink');
const Notification = require('../src/models/Notification');
const ResellerProfile = require('../src/models/ResellerProfile');

const { toMilli } = require('../src/utils/quantity');
const {
  ROLES,
  ORDER_STATUS,
  PAYMENT_MODE,
  EVENT_TYPE,
  NOTIFICATION_CHANNEL,
  SMS_CATEGORY,
  SMS_PAYER,
  SMS_STATUS,
} = require('../src/domain/constants');

const { OUTBOX_KIND } = OutboxMessage;

const realFetch = global.fetch;
const saved = {};
const ENV_KEYS = [
  'smsApiKey',
  'smsSenderId',
  'smsConfigured',
  'telegramConfigured',
  'telegramWebhook',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_BOT_USERNAME',
  'publicAppUrl',
  'webPushConfigured',
];

let gatewayCalls = [];

test.before(async () => {
  await startDb();
  ENV_KEYS.forEach((key) => {
    saved[key] = env[key];
  });
});

test.after(async () => {
  global.fetch = realFetch;
  ENV_KEYS.forEach((key) => {
    env[key] = saved[key];
  });
  setClient(null);
  await stopDb();
});

test.beforeEach(async () => {
  await resetDb();
  ENV_KEYS.forEach((key) => {
    env[key] = saved[key];
  });
  setClient(null);
  telegram.clearUsernameCache();

  gatewayCalls = [];
  global.fetch = async (url, init) => {
    gatewayCalls.push({ url: String(url), body: init && init.body });
    const body = JSON.stringify({ response: [{ status: 0, id: 'MSG-1' }] });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
});

const withGateway = () => {
  env.smsApiKey = 'test-api-key';
  env.smsSenderId = 'TESTSENDER';
  env.smsConfigured = true;
};

async function signIn({ phone, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

/** A confirmed order ready for the owner, plus everyone involved. */
async function confirmedOrder({ customerName = 'Rahim Uddin', shopName = 'Mango House' } = {}) {
  const owner = await f.makeOwner();
  const reseller = await f.makeReseller({ creditLimit: 100000 });
  await ResellerProfile.updateOne({ _id: reseller.profile._id }, { $set: { shopName } });
  const product = await f.makeProduct();
  await f.listProduct(reseller.profile, product, 80);
  const source = await f.makeSource();
  await f.makeZone();

  const { order: pending } = await orderService.createPendingOrder({
    resellerProfile: reseller.profile,
    paymentMode: PAYMENT_MODE.COD,
    customer: {
      name: customerName,
      phoneE164: '+8801912345678',
      address: '12 Test Road',
      district: 'Dhaka',
    },
    items: [{ product: product._id, qtyMilli: toMilli(10) }],
  });
  const order = await orderService.confirmOrder({
    orderId: pending._id,
    resellerProfile: reseller.profile,
    actorUser: reseller.user,
  });

  return { owner, reseller, order: await Order.findById(order._id || pending._id), source };
}

const customerMessages = () => OutboxMessage.find({ kind: OUTBOX_KIND.CUSTOMER_SMS }).lean();

/* ------------------------------------------------------------------ gsm-7 -- */

test('gsm7: charset and segment arithmetic follow GSM 03.38', () => {
  assert.equal(gsm7.isGsm7('Hello @ £ é ñ {x}'), true);
  assert.equal(gsm7.isGsm7('আম'), false);
  assert.equal(gsm7.isGsm7('“smart quotes”'), false);
  assert.deepEqual(gsm7.invalidChars('ok আম ok'), ['আ', 'ম']);

  assert.deepEqual(gsm7.measure('a'.repeat(160)), { encoding: 'GSM-7', chars: 160, segments: 1 });
  assert.equal(gsm7.measure('a'.repeat(161)).segments, 2);
  assert.equal(gsm7.measure('a'.repeat(306)).segments, 2);
  assert.equal(gsm7.measure('a'.repeat(307)).segments, 3);
  // An extension character costs two septets.
  assert.deepEqual(gsm7.measure('€'.repeat(80)), { encoding: 'GSM-7', chars: 160, segments: 1 });
  assert.equal(gsm7.measure('[' .repeat(81)).segments, 2);
  assert.deepEqual(gsm7.measure('আ'.repeat(70)), { encoding: 'UCS-2', chars: 70, segments: 1 });
  assert.equal(gsm7.measure('আ'.repeat(71)).segments, 2);
});

test('gsm7: sanitising keeps GSM text and reports how little of Bengali survives', () => {
  assert.deepEqual(gsm7.sanitize('Café “Zoë”'), { text: 'Café "Zoe"', kept: 1 });
  assert.equal(gsm7.sanitize('রহিম').text, '');
  assert.equal(gsm7.sanitize('রহিম').kept, 0);
});

/* ------------------------------------------------------------ templates -- */

test('templates: GSM-7 only, known placeholders, at most three segments', () => {
  customerSms.ACTIONS.forEach((action) => {
    assert.equal(customerSms.validateTemplate(customerSms.DEFAULT_TEMPLATES[action]), null);
  });
  assert.match(customerSms.validateTemplate('অর্ডার {code}'), /GSM-7/);
  assert.match(customerSms.validateTemplate('Order {orderNo}'), /Unknown placeholder/);
  assert.match(customerSms.validateTemplate('a'.repeat(460)), /3 SMS segments/);
  assert.match(customerSms.validateTemplate('   '), /required/);
});

test('rendering: Bengali names fall back, empty clauses disappear, no link without PUBLIC_APP_URL', () => {
  const order = {
    orderCode: 'AB12CD34',
    customer: { name: 'রহিম', phoneE164: '+8801912345678' },
    totals: { customerTotalPoisha: 125000 },
  };
  const render = (action, extra = {}) =>
    customerSms.renderCustomerSms({
      template: customerSms.DEFAULT_TEMPLATES[action],
      order,
      profile: { shopName: 'আম বাড়ি', slug: 'aam-bari' },
      settings: { businessName: 'ChapaiMango' },
      publicAppUrl: null,
      ...extra,
    }).text;

  assert.equal(render('accept'), 'Hi, your order AB12CD34 from aam-bari is confirmed.');
  assert.equal(render('ship', { courierName: 'Pathao' }), 'Order AB12CD34 from aam-bari shipped via Pathao.');
  assert.equal(
    render('ship', { courierName: 'পাঠাও', trackingNumber: 'PX-9', publicAppUrl: 'https://shop.test' }),
    'Order AB12CD34 from aam-bari shipped via courier, tracking PX-9. Track: https://shop.test/track?code=AB12CD34'
  );
  assert.equal(render('cancel', { reason: 'স্টক শেষ' }), 'Order AB12CD34 from aam-bari was cancelled.');
  assert.equal(
    render('cancel', { reason: 'Out of stock' }),
    'Order AB12CD34 from aam-bari was cancelled. Out of stock'
  );
  // An auto-generated slug is no name; the business name is next.
  assert.equal(
    customerSms.renderCustomerSms({
      template: '{shop}',
      order,
      profile: { shopName: 'আম', slug: 'shop-a1b2c3' },
      settings: { businessName: 'ChapaiMango' },
    }).text,
    'ChapaiMango'
  );
});

test('settings: templates are returned, validated per field, and saved', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);

  const initial = await agent.get('/api/owner/settings');
  assert.equal(initial.status, 200);
  assert.equal(
    initial.body.data.settings.customerSmsTemplates.accept,
    customerSms.DEFAULT_TEMPLATES.accept
  );
  assert.equal(initial.body.data.settings.customerSms.available, false);

  const bad = await agent.patch('/api/owner/settings').send({
    customerSmsTemplates: { accept: 'অর্ডার {code}', ship: 'Order {nope}', cancel: 'Fine {code}' },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.fields['customerSmsTemplates.accept'], /GSM-7/);
  assert.match(bad.body.error.fields['customerSmsTemplates.ship'], /Unknown placeholder/);
  assert.equal(bad.body.error.fields['customerSmsTemplates.cancel'], undefined);

  // Nothing was written by the refused save, not even the valid field.
  const still = await agent.get('/api/owner/settings');
  assert.equal(still.body.data.settings.customerSmsTemplates.cancel, customerSms.DEFAULT_TEMPLATES.cancel);

  const good = await agent
    .patch('/api/owner/settings')
    .send({ customerSmsTemplates: { cancel: 'Sorry, order {code} was cancelled. {reason}' } });
  assert.equal(good.status, 200);
  assert.equal(
    good.body.data.settings.customerSmsTemplates.cancel,
    'Sorry, order {code} was cancelled. {reason}'
  );
});

/* --------------------------------------------------------- customer sms -- */

test('customer sms: the queued text is exactly the preview, and is not gated by the master switch', async () => {
  withGateway();
  env.publicAppUrl = 'https://shop.test';
  await updateSettings({ 'features.sms': false });

  const { owner, order, source } = await confirmedOrder();
  const agent = await signIn(owner);

  // Accept, with the box ticked.
  const acceptPreview = await agent
    .get(`/api/owner/orders/${order._id}/customer-sms-preview`)
    .query({ action: 'accept' });
  assert.equal(acceptPreview.status, 200);
  assert.equal(acceptPreview.body.data.available, true);
  assert.equal(acceptPreview.body.data.encoding, 'GSM-7');
  assert.equal(acceptPreview.body.data.phone, '+8801912345678');
  assert.equal(
    acceptPreview.body.data.text,
    `Hi Rahim Uddin, your order ${order.orderCode} from Mango House is confirmed. Track: https://shop.test/track?code=${order.orderCode}`
  );
  assert.equal(acceptPreview.body.data.segments, 1);

  const accepted = await agent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: f.sourcesFor(order, source), sendCustomerSms: true });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  assert.equal((await agent.post(`/api/owner/orders/${order._id}/pack`).send({})).status, 200);

  // Ship, previewed with the same courier and tracking the request carries.
  const shipPreview = await agent
    .get(`/api/owner/orders/${order._id}/customer-sms-preview`)
    .query({ action: 'ship', courier: 'Steadfast', trackingId: 'SF-1001' });
  const shipped = await agent
    .post(`/api/owner/orders/${order._id}/ship`)
    .send({ courierName: 'Steadfast', trackingNumber: 'SF-1001', sendCustomerSms: true });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));

  const queued = await customerMessages();
  assert.equal(queued.length, 2);
  const byEvent = Object.fromEntries(queued.map((m) => [m.eventType, m]));
  assert.equal(byEvent[EVENT_TYPE.ORDER_ACCEPTED].payload.text, acceptPreview.body.data.text);
  assert.equal(byEvent[EVENT_TYPE.ORDER_SHIPPED].payload.text, shipPreview.body.data.text);
  assert.equal(byEvent[EVENT_TYPE.ORDER_SHIPPED].payload.phoneE164, '+8801912345678');

  const history = (await Order.findById(order._id)).statusHistory;
  const entry = (status) => history.find((h) => h.status === status);
  assert.equal(entry(ORDER_STATUS.ACCEPTED).customerSmsQueued, true);
  assert.equal(entry(ORDER_STATUS.SHIPPED).customerSmsQueued, true);

  // Drained with SMS switched off for everybody: owner-paid, so it still goes.
  await drainOnce();
  const logs = await SmsLog.find({ category: SMS_CATEGORY.CUSTOMER }).lean();
  assert.equal(logs.length, 2);
  logs.forEach((log) => {
    assert.equal(log.status, SMS_STATUS.SENT);
    assert.equal(log.payer, SMS_PAYER.OWNER);
    assert.equal(String(log.order), String(order._id));
    assert.equal(log.reseller, null);
  });
  assert.deepEqual(
    logs.map((l) => l.text).sort(),
    [acceptPreview.body.data.text, shipPreview.body.data.text].sort()
  );
  const sentBodies = gatewayCalls.map((c) => new URLSearchParams(c.body).get('msg'));
  assert.ok(sentBodies.includes(shipPreview.body.data.text));
});

test('customer sms: cancel with a reason, and nothing queued when the box is off', async () => {
  withGateway();
  const { owner, order } = await confirmedOrder();

  await orderService.transitionOrder({
    orderId: order._id,
    action: 'cancel',
    actorUser: owner.user,
    role: ROLES.OWNER,
    payload: { reason: 'Out of stock' },
  });
  assert.equal((await customerMessages()).length, 0);
  const history = (await Order.findById(order._id)).statusHistory;
  assert.equal(history[history.length - 1].customerSmsQueued, undefined);
});

test('customer sms: a transition that fails queues nothing', async () => {
  withGateway();
  const { owner, order, source } = await confirmedOrder();

  // Ship straight from confirmed is not a legal transition.
  await assert.rejects(
    orderService.transitionOrder({
      orderId: order._id,
      action: 'ship',
      actorUser: owner.user,
      role: ROLES.OWNER,
      payload: { courierName: 'Pathao' },
      sendCustomerSms: true,
    })
  );

  await orderService.transitionOrder({
    orderId: order._id,
    action: 'accept',
    actorUser: owner.user,
    role: ROLES.OWNER,
    payload: { sources: f.sourcesFor(order, source) },
  });
  await orderService.transitionOrder({
    orderId: order._id,
    action: 'pack',
    actorUser: owner.user,
    role: ROLES.OWNER,
  });
  // A ship with no courier fails inside the transaction, after the SMS box was read.
  await assert.rejects(
    orderService.transitionOrder({
      orderId: order._id,
      action: 'ship',
      actorUser: owner.user,
      role: ROLES.OWNER,
      payload: {},
      sendCustomerSms: true,
    }),
    (err) => err.code === 'COURIER_REQUIRED'
  );

  assert.equal((await customerMessages()).length, 0);
  assert.equal((await Order.findById(order._id)).status, ORDER_STATUS.PACKED);
});

test('customer sms: SMS_UNAVAILABLE without a gateway, before the order moves', async () => {
  const { owner, order, source } = await confirmedOrder();
  const agent = await signIn(owner);

  const preview = await agent
    .get(`/api/owner/orders/${order._id}/customer-sms-preview`)
    .query({ action: 'accept' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.available, false);

  const res = await agent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: f.sourcesFor(order, source), sendCustomerSms: true });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'SMS_UNAVAILABLE');
  assert.equal((await Order.findById(order._id)).status, ORDER_STATUS.CONFIRMED);
  assert.equal((await customerMessages()).length, 0);
});

/* -------------------------------------------------------------- telegram -- */

function stubClient({ failWith } = {}) {
  const sent = [];
  return {
    sent,
    async sendMessage(chatId, text) {
      if (failWith) throw failWith;
      sent.push({ chatId, text });
      return {};
    },
    async getMe() {
      return { username: 'chapai_test_bot' };
    },
  };
}

const privateMessage = (text, chatId = 555) => ({ chat: { id: chatId, type: 'private' }, text });

test('telegram: /start with a valid token links once; reuse and expiry are refused', async () => {
  env.telegramConfigured = true;
  const client = stubClient();
  setClient(client);
  const { user } = await f.makeReseller();

  const issued = await telegram.createLinkToken(user._id);
  assert.equal(issued.botUsername, 'chapai_test_bot');
  assert.equal(issued.deepLink, `https://t.me/chapai_test_bot?start=${issued.linkToken}`);
  const stored = await TelegramLink.findOne({ user: user._id }).lean();
  assert.notEqual(stored.linkTokenHash, issued.linkToken, 'only the hash is stored');
  assert.ok(stored.linkTokenExpiresAt.getTime() - Date.now() <= 15 * 60 * 1000);

  const linked = await telegramBot.handleMessage(privateMessage(`/start ${issued.linkToken}`), client);
  assert.equal(linked.action, 'linked');
  assert.equal((await TelegramLink.findOne({ user: user._id })).chatId, '555');
  assert.equal(client.sent.at(-1).text, telegramBot.REPLY.linked);

  const reused = await telegramBot.handleMessage(privateMessage(`/start ${issued.linkToken}`, 777), client);
  assert.equal(reused.action, 'rejected');
  assert.equal((await TelegramLink.findOne({ user: user._id })).chatId, '555');

  const other = await f.makeReseller();
  const late = await telegram.createLinkToken(other.user._id);
  await TelegramLink.updateOne(
    { user: other.user._id },
    { $set: { linkTokenExpiresAt: new Date(Date.now() - 1000) } }
  );
  const expired = await telegramBot.handleMessage(privateMessage(`/start ${late.linkToken}`, 888), client);
  assert.deepEqual(expired, { action: 'rejected', reason: 'expired' });
  assert.equal(client.sent.at(-1).text, telegramBot.REPLY.expired);

  const help = await telegramBot.handleMessage(privateMessage('hello'), client);
  assert.equal(help.action, 'help');

  const stopped = await telegramBot.handleMessage(privateMessage('/stop'), client);
  assert.equal(stopped.action, 'unlinked');
  assert.equal((await TelegramLink.findOne({ user: user._id })).chatId, null);
});

test('telegram: link-token, status and unlink endpoints for both roles', async () => {
  env.telegramConfigured = true;
  env.TELEGRAM_BOT_USERNAME = 'envbot';
  setClient(stubClient());

  const owner = await f.makeOwner();
  const reseller = await f.makeReseller();

  for (const [who, base] of [
    [owner, '/api/owner'],
    [reseller, '/api/reseller'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const agent = await signIn(who);
    // eslint-disable-next-line no-await-in-loop
    const issued = await agent.post(`${base}/telegram/link-token`);
    assert.equal(issued.status, 200);
    assert.match(issued.body.data.deepLink, /^https:\/\/t\.me\/envbot\?start=[a-f0-9]{32}$/);

    // eslint-disable-next-line no-await-in-loop
    await telegramBot.handleMessage(privateMessage(`/start ${issued.body.data.linkToken}`, 42));
    // eslint-disable-next-line no-await-in-loop
    const status = await agent.get(`${base}/telegram`);
    assert.equal(status.body.data.linked, true);
    assert.equal(status.body.data.botUsername, 'envbot');

    // eslint-disable-next-line no-await-in-loop
    const unlinked = await agent.delete(`${base}/telegram/link`);
    assert.equal(unlinked.status, 200);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await agent.get(`${base}/telegram`)).body.data.linked, false);
  }
});

test('telegram: the webhook checks the secret in the path and in the header', async () => {
  env.telegramConfigured = true;
  env.telegramWebhook = true;
  env.TELEGRAM_WEBHOOK_SECRET = 'a-very-long-webhook-secret-123';
  const client = stubClient();
  setClient(client);
  const { user } = await f.makeReseller();
  const { linkToken } = await telegram.createLinkToken(user._id);
  const update = { update_id: 1, message: privateMessage(`/start ${linkToken}`, 99) };

  const wrongPath = await request(app)
    .post('/api/telegram/webhook/wrong-secret-wrong-secret')
    .set('X-Telegram-Bot-Api-Secret-Token', env.TELEGRAM_WEBHOOK_SECRET)
    .send(update);
  assert.equal(wrongPath.status, 401);

  const wrongHeader = await request(app)
    .post(`/api/telegram/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`)
    .set('X-Telegram-Bot-Api-Secret-Token', 'nope')
    .send(update);
  assert.equal(wrongHeader.status, 401);
  assert.equal((await TelegramLink.findOne({ user: user._id })).chatId, null);

  const good = await request(app)
    .post(`/api/telegram/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`)
    .set('X-Telegram-Bot-Api-Secret-Token', env.TELEGRAM_WEBHOOK_SECRET)
    .send(update);
  assert.equal(good.status, 200);
  assert.equal((await TelegramLink.findOne({ user: user._id })).chatId, '99');

  env.telegramWebhook = false;
  const off = await request(app)
    .post(`/api/telegram/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`)
    .set('X-Telegram-Bot-Api-Secret-Token', env.TELEGRAM_WEBHOOK_SECRET)
    .send(update);
  assert.equal(off.status, 404);
});

test('telegram: a bot blocked by the user removes the link', async () => {
  env.telegramConfigured = true;
  const blocked = Object.assign(new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user'), {
    code: 'ETELEGRAM',
    response: { statusCode: 403, body: { description: 'Forbidden: bot was blocked by the user' } },
  });
  setClient(stubClient({ failWith: blocked }));
  const { user } = await f.makeReseller();
  await TelegramLink.create({ user: user._id, chatId: '123', linkedAt: new Date() });

  const result = await telegram.send({ userId: user._id, title: 'Title', body: 'Body' });
  assert.deepEqual(result, { sent: 0, unlinked: true });
  assert.equal(await TelegramLink.countDocuments({ user: user._id }), 0);
});

test('telegram: a message is sent through the client as escaped HTML', async () => {
  env.telegramConfigured = true;
  const client = stubClient();
  setClient(client);
  const { user } = await f.makeReseller();
  await TelegramLink.create({ user: user._id, chatId: '123', linkedAt: new Date() });

  assert.deepEqual(await telegram.send({ userId: user._id, title: 'a_b <c>', body: 'x*y' }), { sent: 1 });
  assert.equal(client.sent[0].text, '<b>a_b &lt;c&gt;</b>\nx*y');
});

test('telegram: only the holder of the MongoDB lease polls, and it stops when the lease moves', async () => {
  const JobLock = require('../src/models/JobLock'); // eslint-disable-line global-require
  const calls = [];
  const client = {
    ...stubClient(),
    deleteWebHook: async () => calls.push('deleteWebHook'),
    startPolling: async () => calls.push('startPolling'),
    stopPolling: async () => calls.push('stopPolling'),
  };
  setClient(client);

  try {
    await telegramBot.checkLease(client);
    assert.deepEqual(calls, ['deleteWebHook', 'startPolling']);
    const held = await JobLock.findOne({ name: telegramBot.LEASE_NAME }).lean();
    assert.ok(held.lockedUntil > new Date());

    // Renewed while held: no second start.
    await telegramBot.checkLease(client);
    assert.deepEqual(calls, ['deleteWebHook', 'startPolling']);

    // Another process took the lease (ours lapsed): this one must stop polling.
    await JobLock.updateOne({ name: telegramBot.LEASE_NAME }, { $set: { owner: 'elsewhere' } });
    await telegramBot.checkLease(client);
    assert.deepEqual(calls, ['deleteWebHook', 'startPolling', 'stopPolling']);

    // And while someone else holds it, it does not start again.
    await telegramBot.checkLease(client);
    assert.equal(calls.filter((c) => c === 'startPolling').length, 1);
  } finally {
    await telegramBot.stopTelegramBot();
  }
});

test('telegram: the http client sends JSON and reports a refusal the way the channel reads it', async () => {
  const calls = [];
  const reply = (status, payload) => ({ ok: status < 300, status, statusText: '', json: async () => payload });
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('/getMe')) return reply(200, { ok: true, result: { username: 'http_bot' } });
    if (JSON.parse(init.body).chat_id === 'gone') {
      return reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    }
    return reply(200, { ok: true, result: { message_id: 1 } });
  };
  const client = createHttpClient('123:abc', { fetchImpl });

  assert.deepEqual(await client.getMe(), { username: 'http_bot' });
  await client.sendMessage('42', '<b>hi</b>', { parse_mode: 'HTML' });
  assert.equal(calls[1].url, 'https://api.telegram.org/bot123:abc/sendMessage');
  assert.deepEqual(calls[1].body, { chat_id: '42', text: '<b>hi</b>', parse_mode: 'HTML' });

  await assert.rejects(client.sendMessage('gone', 'x'), (err) => {
    assert.equal(err.code, 'ETELEGRAM');
    assert.equal(err.response.statusCode, 403);
    assert.match(err.response.body.description, /blocked/);
    return true;
  });

  // Wired into the channel, a blocked chat is unlinked exactly as before.
  env.telegramConfigured = true;
  setClient(client);
  const { user } = await f.makeReseller();
  await TelegramLink.create({ user: user._id, chatId: 'gone', linkedAt: new Date() });
  assert.deepEqual(await telegram.send({ userId: user._id, title: 'T' }), { sent: 0, unlinked: true });
});

test('telegram: the http client long-polls getUpdates, acknowledges by offset and stops cleanly', async () => {
  const offsets = [];
  let polls = 0;
  const fetchImpl = (url, init) => {
    const body = JSON.parse(init.body);
    offsets.push(body.offset);
    polls += 1;
    if (polls === 1) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: [
            { update_id: 10, message: privateMessage('/start one') },
            { update_id: 11, message: privateMessage('/stop') },
          ],
        }),
      });
    }
    if (polls === 2) {
      return Promise.resolve({ ok: false, status: 409, statusText: 'Conflict', json: async () => ({ ok: false, description: 'Conflict' }) });
    }
    // Held open like a real long poll, until the client cancels it.
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  };
  const client = createHttpClient('123:abc', { fetchImpl, retryDelayMs: 5, pollTimeoutS: 1 });
  const messages = [];
  const errors = [];
  client.on('message', (message) => messages.push(message.text));
  client.on('polling_error', (err) => errors.push(err.response.statusCode));

  await client.startPolling({ restart: true });
  assert.equal(client.isPolling(), true);
  for (let i = 0; i < 100 && polls < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await client.stopPolling({ cancel: true });

  assert.equal(client.isPolling(), false);
  assert.deepEqual(messages, ['/start one', '/stop']);
  assert.deepEqual(errors, [409], 'a conflict is reported and retried, never thrown');
  assert.deepEqual(offsets.slice(0, 3), [0, 12, 12]);
});

/* ----------------------------------------------------------- preferences -- */

test('preferences: the reseller matrix is honoured by resolveChannels', async () => {
  const { user, profile, phone, password } = await f.makeReseller();
  const agent = await signIn({ phone, password });

  const initial = await agent.get('/api/reseller/notification-preferences');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data.inApp, true);
  assert.equal(initial.body.data.smsAvailable, false);
  assert.deepEqual(
    initial.body.data.groups.map((g) => g.key),
    ['orders', 'wallet', 'kyc', 'alerts']
  );

  let channels = await resolveChannels(user, EVENT_TYPE.ORDER_ACCEPTED);
  assert.ok(channels.includes(NOTIFICATION_CHANNEL.WEB_PUSH));
  assert.ok(channels.includes(NOTIFICATION_CHANNEL.TELEGRAM));

  const saved = await agent.put('/api/reseller/notification-preferences').send({
    events: [
      { eventType: EVENT_TYPE.ORDER_ACCEPTED, push: false, telegram: false },
      { eventType: EVENT_TYPE.DEPOSIT_APPROVED, sms: true },
    ],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const row = saved.body.data.groups[0].events.find((e) => e.eventType === EVENT_TYPE.ORDER_ACCEPTED);
  assert.deepEqual([row.push, row.telegram], [false, false]);

  channels = await resolveChannels(user, EVENT_TYPE.ORDER_ACCEPTED);
  assert.deepEqual(channels, [NOTIFICATION_CHANNEL.IN_APP]);

  // SMS needs the master switch, the owner's flag for this reseller and credits.
  assert.ok(!(await resolveChannels(user, EVENT_TYPE.DEPOSIT_APPROVED)).includes('sms'));
  await updateSettings({ 'features.sms': true });
  await ResellerProfile.updateOne(
    { _id: profile._id },
    { $set: { 'channelPrefs.sms': true, smsCredits: 5 } }
  );
  assert.ok((await resolveChannels(user, EVENT_TYPE.DEPOSIT_APPROVED)).includes('sms'));
  await agent
    .put('/api/reseller/notification-preferences')
    .send({ events: [{ eventType: EVENT_TYPE.DEPOSIT_APPROVED, sms: false }] });
  assert.ok(!(await resolveChannels(user, EVENT_TYPE.DEPOSIT_APPROVED)).includes('sms'));

  const refused = await agent
    .put('/api/reseller/notification-preferences')
    .send({ events: [{ eventType: EVENT_TYPE.ALERT_LEDGER_DRIFT, push: false }] });
  assert.equal(refused.status, 400);
});

test('preferences: the owner has their own, and the new-device alert is locked', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);

  const res = await agent.get('/api/owner/notification-preferences');
  assert.equal(res.status, 200);
  const alerts = res.body.data.groups.find((g) => g.key === 'alerts');
  const newDevice = alerts.events.find((e) => e.eventType === EVENT_TYPE.ALERT_NEW_DEVICE);
  assert.deepEqual(newDevice.locked, ['telegram', 'sms']);

  await agent.put('/api/owner/notification-preferences').send({
    events: [
      { eventType: EVENT_TYPE.ORDER_CONFIRMED, push: false },
      { eventType: EVENT_TYPE.ALERT_NEW_DEVICE, telegram: false },
    ],
  });
  const channels = await resolveChannels(owner.user, EVENT_TYPE.ORDER_CONFIRMED);
  assert.ok(!channels.includes(NOTIFICATION_CHANNEL.WEB_PUSH));
  assert.ok(channels.includes(NOTIFICATION_CHANNEL.TELEGRAM));
  assert.ok(
    (await resolveChannels(owner.user, EVENT_TYPE.ALERT_NEW_DEVICE)).includes(
      NOTIFICATION_CHANNEL.TELEGRAM
    ),
    'a locked channel cannot be switched off'
  );
});

/* ------------------------------------------------------------------ push -- */

test('push: the payload and the in-app row carry the event type and a role-aware url', async () => {
  const { user } = await f.makeReseller();
  const owner = await f.makeOwner();
  const pushed = [];
  const realSend = webpush.send;
  webpush.send = async (message) => {
    pushed.push(message);
    return { sent: 1, pruned: 0 };
  };

  try {
    const orderId = '64b7f0c2a1b2c3d4e5f60718';
    await notify({ user, eventType: EVENT_TYPE.ORDER_SHIPPED, data: { orderId, orderCode: 'X1' } });
    await notify({ user, eventType: EVENT_TYPE.DEPOSIT_APPROVED, data: { amountPoisha: 100 } });
    await notify({ user: owner.user, eventType: EVENT_TYPE.ALERT_LEDGER_DRIFT, data: { driftedCount: 1 } });
    await drainOnce();
  } finally {
    webpush.send = realSend;
  }

  const byEvent = Object.fromEntries(pushed.map((p) => [p.data.eventType, p.data]));
  assert.equal(byEvent[EVENT_TYPE.ORDER_SHIPPED].url, '/reseller/orders/64b7f0c2a1b2c3d4e5f60718');
  assert.equal(byEvent[EVENT_TYPE.DEPOSIT_APPROVED].url, '/reseller/wallet');
  assert.equal(byEvent[EVENT_TYPE.ALERT_LEDGER_DRIFT].url, '/owner/reports');

  const row = await Notification.findOne({ eventType: EVENT_TYPE.ORDER_SHIPPED }).lean();
  assert.equal(row.data.url, '/reseller/orders/64b7f0c2a1b2c3d4e5f60718');
  assert.equal(row.data.eventType, EVENT_TYPE.ORDER_SHIPPED);
});

/* ------------------------------------------------------------ sms credits -- */

test('sms credits: hidden behind the switch, priced, and bought from the wallet', async () => {
  const { phone, password, profile } = await f.makeReseller({ creditLimit: 1000 });
  const agent = await signIn({ phone, password });

  let res = await agent.get('/api/reseller/sms');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.featureEnabled, false);
  assert.equal(res.body.data.pricePerCredit, 0.5);
  assert.equal((await agent.post('/api/reseller/sms/purchase').send({ credits: 10 })).status, 403);

  await updateSettings({ 'features.sms': true });
  res = await agent.post('/api/reseller/sms/purchase').send({ credits: 10 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.smsCredits, 10);
  assert.equal(res.body.data.charged, 5);

  res = await agent.get('/api/reseller/sms');
  assert.equal(res.body.data.smsCredits, 10);
  assert.equal(res.body.data.featureEnabled, true);
  assert.equal(res.body.data.available, false, 'the owner has not enabled SMS for this reseller');

  const profileRes = await agent.get('/api/reseller/profile');
  assert.equal(profileRes.body.data.profile.smsPricePerCredit, 0.5);
  assert.equal((await ResellerProfile.findById(profile._id)).balancePoisha, -500);
});
