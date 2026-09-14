'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const env = require('../src/config/env');
const SmsLog = require('../src/models/SmsLog');
const OutboxMessage = require('../src/models/OutboxMessage');
const ResellerProfile = require('../src/models/ResellerProfile');
const smsService = require('../src/services/sms');
const { drainOnce } = require('../src/services/outbox');
const { updateSettings } = require('../src/services/settings');
const { EVENT_TYPE, NOTIFICATION_CHANNEL, SMS_STATUS } = require('../src/domain/constants');

/**
 * The rules that cost money, and the record that proves they were followed.
 *
 * Every one of these asserts on the log row rather than only on the return
 * value, because the row is the thing the owner reads. A send that worked and
 * left no record is a failure of the feature these tests exist to protect.
 */

test.before(startDb);
test.after(stopDb);

const realFetch = global.fetch;

/** Stands in for Automas. Returns whatever the current test wants it to. */
let gatewayReply = null;
let gatewayCalls = [];

test.beforeEach(async () => {
  await resetDb();

  // Set on the env object rather than in process.env: the schema is parsed once
  // at import, long before this file runs, so the parsed result is what matters.
  env.smsApiKey = 'test-api-key';
  env.smsSenderId = 'TESTSENDER';
  env.smsConfigured = true;

  gatewayCalls = [];
  gatewayReply = { status: 200, body: JSON.stringify({ response: [{ status: 0, id: 'MSG-1' }] }) };

  global.fetch = async (url, init) => {
    gatewayCalls.push({ url: String(url), body: init && init.body });
    if (gatewayReply instanceof Error) throw gatewayReply;
    return {
      ok: gatewayReply.status >= 200 && gatewayReply.status < 300,
      status: gatewayReply.status,
      text: async () => gatewayReply.body,
      json: async () => JSON.parse(gatewayReply.body),
    };
  };

  await updateSettings({ 'features.sms': true });
});

test.after(() => {
  global.fetch = realFetch;
});

const signIn = async ({ phone, password }) => {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
};

/* ------------------------------------------------------------- the record -- */

test('a successful send is logged with what the gateway replied', async () => {
  const { user, profile } = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { smsCredits: 10 } });

  const result = await smsService.send({
    phoneE164: user.phoneE164,
    text: 'Deposit approved',
    eventType: EVENT_TYPE.DEPOSIT_APPROVED,
    user,
    charge: profile,
  });

  assert.equal(result.status, SMS_STATUS.SENT);

  /*
   * The parameter names Automas documents. `senderid` and `msg` were sent
   * instead, the gateway answered 102 "Sender Not Valid" to everything, and the
   * mocked gateway here accepted it all without looking.
   */
  const sent = new URLSearchParams(gatewayCalls[0].body);
  assert.ok(sent.get('sender'), 'the sender id goes in `sender`');
  assert.equal(sent.get('smstext'), 'Deposit approved');
  assert.ok(sent.get('apikey'));
  assert.ok(sent.get('msisdn'));

  const log = await SmsLog.findOne({});
  assert.equal(log.status, SMS_STATUS.SENT);
  assert.equal(log.toPhoneE164, user.phoneE164);
  assert.equal(log.toLocal, `0${user.phoneE164.slice(4)}`);
  assert.equal(log.providerMessageId, 'MSG-1');
  assert.equal(log.providerStatusCode, 0);
  assert.equal(log.providerHttpStatus, 200);
  // The raw reply is the evidence, kept whether or not it parsed.
  assert.match(log.providerRaw, /MSG-1/);
  assert.equal(log.eventType, EVENT_TYPE.DEPOSIT_APPROVED);
  assert.equal(log.creditsCharged, 1);
  assert.equal(log.creditsRefunded, 0);
  assert.ok(log.sentAt);
});

test('a Bengali message is logged as Unicode and costs a segment per 70 characters', async () => {
  const { user } = await f.makeReseller();

  await smsService.send({ phoneE164: user.phoneE164, text: 'আপনার জমা অনুমোদন হয়েছে'.repeat(4) });

  const log = await SmsLog.findOne({});
  assert.equal(log.encoding, 'unicode');
  assert.ok(log.segments > 1, 'a long Bengali message is more than one segment');
  // Without this flag Bengali arrives as question marks.
  assert.match(gatewayCalls[0].body, /smsformat=8/);
});

test('a gateway rejection is logged with its code and refunds the credit', async () => {
  const { user, profile } = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { smsCredits: 5 } });

  // 1000 is the gateway saying its own account is empty.
  gatewayReply = { status: 200, body: JSON.stringify({ response: [{ status: 1000 }] }) };

  // An empty gateway account may be topped up, so this is worth another attempt
  // later and the service says so by throwing. The row is written regardless.
  await assert.rejects(
    smsService.send({
      phoneE164: user.phoneE164,
      text: 'Hello',
      charge: await ResellerProfile.findById(profile._id),
    }),
    /balance/i
  );

  const log = await SmsLog.findOne({});
  assert.equal(log.status, SMS_STATUS.FAILED);
  assert.equal(log.providerStatusCode, 1000);
  assert.match(log.error, /balance/i);
  assert.equal(log.creditsCharged, 1);
  assert.equal(log.creditsRefunded, 1);

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(after.smsCredits, 5, 'a message that never sent must not be charged for');
});

test('a reply that is not JSON is still logged, raw', async () => {
  const { user } = await f.makeReseller();
  gatewayReply = { status: 502, body: '<html><body>Bad Gateway</body></html>' };

  await assert.rejects(smsService.send({ phoneE164: user.phoneE164, text: 'Hello' }), /502/);

  const log = await SmsLog.findOne({});
  assert.equal(log.status, SMS_STATUS.FAILED);
  assert.equal(log.providerHttpStatus, 502);
  // The gateway answered with an HTML page, which is exactly the case the raw
  // copy exists for: there is nothing to parse and everything to read.
  assert.equal(log.providerResponse, null);
  assert.match(log.providerRaw, /Bad Gateway/);
});

/* ------------------------------------------------------------ the switch -- */

test('with SMS switched off nothing reaches the gateway and the attempt is logged', async () => {
  const { user, profile } = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { smsCredits: 10 } });
  await updateSettings({ 'features.sms': false });

  const result = await smsService.send({
    phoneE164: user.phoneE164,
    text: 'Hello',
    charge: await ResellerProfile.findById(profile._id),
  });

  assert.equal(result.status, SMS_STATUS.BLOCKED);
  assert.equal(gatewayCalls.length, 0, 'the gateway must not be called at all');

  const log = await SmsLog.findOne({});
  assert.equal(log.status, SMS_STATUS.BLOCKED);
  assert.equal(log.blockedReason, 'feature_off');
  assert.equal(log.creditsCharged, 0);

  const after = await ResellerProfile.findById(profile._id);
  assert.equal(after.smsCredits, 10, 'a suppressed message costs nothing');
});

test('the switch is read fresh, so a message already queued is stopped', async () => {
  const { user, profile } = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { smsCredits: 10 } });

  // Queued while SMS was on, which is the race the second check exists for.
  await OutboxMessage.create({
    user: user._id,
    eventType: EVENT_TYPE.DEPOSIT_APPROVED,
    channels: [NOTIFICATION_CHANNEL.SMS],
    payload: { title: 'জমা অনুমোদন হয়েছে', body: '500 টাকা' },
  });

  await updateSettings({ 'features.sms': false });
  await drainOnce();

  assert.equal(gatewayCalls.length, 0);
  const log = await SmsLog.findOne({});
  assert.equal(log.blockedReason, 'feature_off');
});

test('a reseller with no credits is blocked, not sent and not charged', async () => {
  const { user, profile } = await f.makeReseller();

  const result = await smsService.send({
    phoneE164: user.phoneE164,
    text: 'Hello',
    charge: await ResellerProfile.findById(profile._id),
  });

  assert.equal(result.status, SMS_STATUS.BLOCKED);
  assert.equal(gatewayCalls.length, 0);
  assert.equal((await SmsLog.findOne({})).blockedReason, 'no_credits');
});

/* -------------------------------------------------------------- the flow -- */

test('an outbox message sends one SMS and logs it against the reseller', async () => {
  const { user, profile } = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { smsCredits: 10 } });

  const message = await OutboxMessage.create({
    user: user._id,
    eventType: EVENT_TYPE.DEPOSIT_APPROVED,
    channels: [NOTIFICATION_CHANNEL.SMS],
    payload: { title: 'Deposit approved', body: '500 taka' },
  });

  await drainOnce();

  assert.equal(gatewayCalls.length, 1);
  const log = await SmsLog.findOne({});
  assert.equal(log.status, SMS_STATUS.SENT);
  assert.equal(String(log.reseller), String(profile._id));
  assert.equal(log.resellerName, 'Test Shop');
  assert.equal(String(log.outboxMessage), String(message._id));
  assert.equal(log.text, 'Deposit approved. 500 taka');
});

test('a permanently rejected message is not retried five times', async () => {
  const { user, profile } = await f.makeReseller();
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { smsCredits: 10 } });

  // 106 is a bad API key: sending the same message again cannot help.
  gatewayReply = { status: 200, body: JSON.stringify({ response: [{ status: 106 }] }) };

  await OutboxMessage.create({
    user: user._id,
    eventType: EVENT_TYPE.DEPOSIT_APPROVED,
    channels: [NOTIFICATION_CHANNEL.SMS],
    payload: { title: 'Deposit approved' },
  });

  await drainOnce();
  await drainOnce();

  assert.equal(gatewayCalls.length, 1, 'a final rejection is attempted once');
  assert.equal(await SmsLog.countDocuments({}), 1);
  assert.equal((await SmsLog.findOne({})).retryable, false);
});

/* ------------------------------------------------------------- the panel -- */

test('the owner toggle switches SMS off for every reseller', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);

  const off = await agent.post('/api/owner/sms/toggle').send({ enabled: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.enabled, false);

  const overview = await agent.get('/api/owner/sms/overview');
  assert.equal(overview.body.data.enabled, false);
  assert.equal(overview.body.data.configured, true);

  const { user } = await f.makeReseller();
  const result = await smsService.send({ phoneE164: user.phoneE164, text: 'Hello' });
  assert.equal(result.status, SMS_STATUS.BLOCKED);
});

test('the owner reads the log and the full gateway reply', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);
  const { user } = await f.makeReseller();

  await smsService.send({ phoneE164: user.phoneE164, text: 'Hello there' });

  const list = await agent.get('/api/owner/sms/logs');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.logs[0].text, 'Hello there');

  const detail = await agent.get(`/api/owner/sms/logs/${list.body.data.logs[0].id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.body.data.log.providerRaw, /MSG-1/);
  assert.equal(detail.body.data.log.providerMessageId, 'MSG-1');
});

test('the log is searchable by the tail of a phone number', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);
  const { user } = await f.makeReseller();

  await smsService.send({ phoneE164: user.phoneE164, text: 'Findable' });

  const tail = user.phoneE164.slice(-6);
  const hit = await agent.get(`/api/owner/sms/logs?q=${tail}`);
  assert.equal(hit.body.data.total, 1);

  const miss = await agent.get('/api/owner/sms/logs?q=999999');
  assert.equal(miss.body.data.total, 0);
});

test('the owner test send works while SMS is off and charges no reseller', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);
  await updateSettings({ 'features.sms': false });

  const res = await agent
    .post('/api/owner/sms/test')
    .send({ phone: '01712345678', text: 'Gateway check' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.result.status, SMS_STATUS.SENT);
  assert.equal(gatewayCalls.length, 1);

  const log = await SmsLog.findOne({});
  assert.equal(log.purpose, 'test');
  assert.equal(log.reseller, null);
  assert.equal(log.creditsCharged, 0);
  assert.equal(String(log.triggeredBy), String(owner.user._id));
});

test('a gateway failure on a test send is reported, not thrown as a server error', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);
  gatewayReply = new Error('socket hang up');

  const res = await agent
    .post('/api/owner/sms/test')
    .send({ phone: '01712345678', text: 'Gateway check' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.result.status, SMS_STATUS.FAILED);
  assert.match(res.body.data.result.error, /unreachable/i);
});

test('a reseller cannot reach the SMS panel', async () => {
  const reseller = await f.makeReseller();
  const agent = await signIn(reseller);

  assert.equal((await agent.get('/api/owner/sms/logs')).status, 403);
  assert.equal((await agent.post('/api/owner/sms/toggle').send({ enabled: true })).status, 403);
});

test('an attempt with nothing to send still leaves a row saying so', async () => {
  // The two cases that cannot describe themselves through a phone number or a
  // message body, and so are the ones most worth having a record of.
  const missing = await smsService.send({ phoneE164: null, text: 'Hello' });
  assert.equal(missing.status, SMS_STATUS.BLOCKED);
  assert.equal((await SmsLog.findOne({ blockedReason: 'no_recipient' })).status, 'blocked');

  const empty = await smsService.send({ phoneE164: '+8801712345678', text: '   ' });
  assert.equal(empty.status, SMS_STATUS.BLOCKED);
  assert.ok(await SmsLog.findOne({ blockedReason: 'empty_text' }), 'the empty attempt is recorded');

  assert.equal(gatewayCalls.length, 0);
});
