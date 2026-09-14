'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { startDb, stopDb, resetDb, mongoose } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const { MongoRateLimitStore, createLimiter } = require('../src/services/rateLimitStore');
const outbox = require('../src/services/outbox');
const { withTransaction } = require('../src/services/tx');
const webpush = require('../src/channels/webpush');
const telegram = require('../src/channels/telegram');
const smsService = require('../src/services/sms');
const storage = require('../src/config/storage');
const ledger = require('../src/services/ledger');

const OutboxMessage = require('../src/models/OutboxMessage');
const Notification = require('../src/models/Notification');
const KycSubmission = require('../src/models/KycSubmission');
const ResellerProfile = require('../src/models/ResellerProfile');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const JobLock = require('../src/models/JobLock');

const { runExclusive } = require('../src/jobs/lock');
const { nextDhakaRun, slotFor } = require('../src/jobs/scheduler');
const { dailyDigest } = require('../src/jobs/dailyDigest');
const { kycPurge } = require('../src/jobs/kycPurge');
const { nightlyReconcile, summarise } = require('../src/jobs/nightlyReconcile');
const {
  EVENT_TYPE,
  NOTIFICATION_CHANNEL,
  ORDER_STATUS,
  REVIEW_STATUS,
  PAYMENT_MODE,
} = require('../src/domain/constants');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Channel stubs, restored after every test. */
const real = {
  push: webpush.send,
  telegram: telegram.send,
  balance: smsService.balance,
  isConfigured: storage.isConfigured,
  destroy: storage.destroy,
  reconcileAll: ledger.reconcileAll,
};
let sent;

test.before(startDb);
test.after(stopDb);
test.beforeEach(async () => {
  await resetDb();
  sent = { push: [], telegram: [] };
  webpush.send = async ({ userId, title }) => {
    sent.push.push({ userId, title });
    return { sent: 1 };
  };
  telegram.send = async ({ userId, title }) => {
    sent.telegram.push({ userId, title });
    return { sent: 1 };
  };
  smsService.balance = async () => null;
});
test.afterEach(() => {
  webpush.send = real.push;
  telegram.send = real.telegram;
  smsService.balance = real.balance;
  storage.isConfigured = real.isConfigured;
  storage.destroy = real.destroy;
  ledger.reconcileAll = real.reconcileAll;
});

/* ================================================================ rate limit */

test('the Mongo rate-limit store counts atomically and restarts after the window', async () => {
  const store = new MongoRateLimitStore({ prefix: 'rl:test-count', windowMs: 300 });

  const hits = await Promise.all(Array.from({ length: 20 }, () => store.increment('1.2.3.4')));
  const totals = hits.map((h) => h.totalHits).sort((a, b) => a - b);
  assert.deepEqual(totals, Array.from({ length: 20 }, (_, i) => i + 1), 'no hit lost or doubled');
  assert.ok(hits[0].resetTime instanceof Date);

  assert.equal((await store.get('1.2.3.4')).totalHits, 20);
  await store.decrement('1.2.3.4');
  assert.equal((await store.get('1.2.3.4')).totalHits, 19);

  await sleep(350);
  assert.equal(await store.get('1.2.3.4'), undefined, 'an ended window reads as empty');
  const fresh = await store.increment('1.2.3.4');
  assert.equal(fresh.totalHits, 1, 'an ended window starts again at one');

  await store.resetKey('1.2.3.4');
  assert.equal(await store.get('1.2.3.4'), undefined);
});

test('two limiter instances with the same name share one counter, as two API instances would', async () => {
  const build = () => {
    const a = express();
    a.get('/x', createLimiter({ name: 'shared-test', windowMs: 60 * 1000, limit: 2 }), (_req, res) =>
      res.json({ ok: true })
    );
    return a;
  };
  const one = build();
  const two = build();

  assert.equal((await request(one).get('/x')).status, 200);
  assert.equal((await request(two).get('/x')).status, 200);
  const third = await request(one).get('/x');
  assert.equal(third.status, 429, 'the second instance counted the first one\'s hits');
  assert.equal(third.body.error.code, 'RATE_LIMITED');

  // A different limiter name is a different bucket.
  const other = express();
  other.get('/x', createLimiter({ name: 'other-test', windowMs: 60 * 1000, limit: 2 }), (_req, res) =>
    res.json({ ok: true })
  );
  assert.equal((await request(other).get('/x')).status, 200);
});

test('the auth limiter is counted in MongoDB', async () => {
  await request(app).post('/api/auth/login').send({ phone: '01700000001', password: 'nope-nope' });
  const hit = await mongoose.connection.collection('ratelimithits').findOne({ key: /^rl:auth:/ });
  assert.ok(hit, 'a counter document exists');
  assert.equal(hit.count, 1);
});

/* ==================================================================== outbox */

async function queue(user, channels, extra = {}) {
  return OutboxMessage.create({
    user: user._id,
    eventType: EVENT_TYPE.DEPOSIT_APPROVED,
    channels,
    payload: { title: 'জমা অনুমোদিত হয়েছে' },
    ...extra,
  });
}

const makeDue = () => OutboxMessage.updateMany({}, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });

test('two concurrent drains send each message exactly once', async () => {
  const { user } = await f.makeReseller();
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await queue(user, [NOTIFICATION_CHANNEL.WEB_PUSH]);
  }
  // Slow enough that the two drains overlap.
  webpush.send = async ({ userId }) => {
    await sleep(15);
    sent.push.push({ userId });
    return { sent: 1 };
  };

  const [a, b] = await Promise.all([outbox.drainOnce(), outbox.drainOnce()]);

  assert.equal(sent.push.length, 6);
  assert.equal(a + b, 6);
  assert.equal(await OutboxMessage.countDocuments({ status: 'sent' }), 6);
  assert.equal(await OutboxMessage.countDocuments({ leaseOwner: { $ne: null } }), 0, 'leases released');
});

test('a failed Telegram is retried without resending the push that already went out', async () => {
  const { user } = await f.makeReseller();
  const message = await queue(user, [NOTIFICATION_CHANNEL.WEB_PUSH, NOTIFICATION_CHANNEL.TELEGRAM]);

  let telegramUp = false;
  telegram.send = async () => {
    if (!telegramUp) throw new Error('Telegram returned 502');
    sent.telegram.push(1);
    return { sent: 1 };
  };

  await outbox.drainOnce();
  let doc = await OutboxMessage.findById(message._id).lean();
  assert.equal(sent.push.length, 1);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.attempts, 1);
  assert.ok(doc.nextAttemptAt > new Date(), 'backed off');
  assert.deepEqual(
    doc.channels.map((c) => [c.name, c.status]),
    [
      ['web_push', 'sent'],
      ['telegram', 'failed'],
    ]
  );

  // Not due yet: nothing happens.
  await outbox.drainOnce();
  assert.equal(sent.push.length, 1);

  telegramUp = true;
  await makeDue();
  await outbox.drainOnce();

  doc = await OutboxMessage.findById(message._id).lean();
  assert.equal(sent.push.length, 1, 'push not sent a second time');
  assert.equal(sent.telegram.length, 1);
  assert.equal(doc.status, 'sent');
  assert.ok(doc.sentAt);
});

test('a message that keeps failing is dead-lettered after the maximum attempts', async () => {
  const { user } = await f.makeReseller();
  const message = await queue(user, [NOTIFICATION_CHANNEL.TELEGRAM]);
  let calls = 0;
  telegram.send = async () => {
    calls += 1;
    throw new Error('down');
  };

  for (let i = 0; i < outbox.MAX_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await makeDue();
    // eslint-disable-next-line no-await-in-loop
    await outbox.drainOnce();
  }

  const doc = await OutboxMessage.findById(message._id).lean();
  assert.equal(doc.status, 'dead');
  assert.ok(doc.deadAt);
  assert.equal(calls, outbox.MAX_ATTEMPTS);

  await makeDue();
  await outbox.drainOnce();
  assert.equal(calls, outbox.MAX_ATTEMPTS, 'a dead message is not tried again');

  const counts = await outbox.deadLetterCounts({ since: new Date(Date.now() - HOUR) });
  assert.deepEqual(counts, { total: 1, recent: 1 });
});

test('a message stored in the old shape, channels as names, is still delivered', async () => {
  const { user } = await f.makeReseller();
  await OutboxMessage.collection.insertOne({
    user: user._id,
    eventType: EVENT_TYPE.DEPOSIT_APPROVED,
    channels: ['web_push'],
    payload: { title: 'old' },
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1000),
    sentAt: null,
  });

  assert.equal(await outbox.drainOnce(), 1);
  assert.equal(sent.push.length, 1);
  const doc = await OutboxMessage.findOne({}).lean();
  assert.equal(doc.status, 'sent');
  assert.equal(doc.channels[0].name, 'web_push');
  assert.equal(doc.channels[0].status, 'sent');
});

test('enqueue inside a transaction vanishes with an aborted transaction', async () => {
  const { user } = await f.makeReseller();

  await assert.rejects(
    withTransaction(async (session) => {
      await outbox.enqueue(
        { user, eventType: EVENT_TYPE.DEPOSIT_APPROVED, channels: ['telegram'], payload: { title: 't' } },
        { session }
      );
      throw new Error('business rule failed');
    }),
    /business rule failed/
  );
  assert.equal(await OutboxMessage.countDocuments({}), 0);

  await withTransaction((session) =>
    outbox.enqueue(
      { user, eventType: EVENT_TYPE.DEPOSIT_APPROVED, channels: ['telegram'], payload: { title: 't' } },
      { session }
    )
  );
  assert.equal(await OutboxMessage.countDocuments({ status: 'pending' }), 1);
});

test('the in-process tick never overlaps itself', async () => {
  const { user } = await f.makeReseller();
  await queue(user, [NOTIFICATION_CHANNEL.WEB_PUSH]);
  const first = outbox.tick();
  const second = outbox.tick();
  assert.equal(first, second, 'the second tick joins the drain in progress');
  await first;
  assert.equal(sent.push.length, 1);
});

/* ====================================================================== jobs */

test('two concurrent runs of a locked job execute it once', async () => {
  let runs = 0;
  const job = async () => {
    runs += 1;
    await sleep(50);
    return 'done';
  };

  const [a, b] = await Promise.all([runExclusive('test-job', job), runExclusive('test-job', job)]);
  assert.equal(runs, 1);
  assert.equal([a, b].filter((r) => r.ran).length, 1);

  // Released afterwards, so the next run goes ahead.
  assert.equal((await runExclusive('test-job', job)).ran, true);
  assert.equal(runs, 2);
});

test('a finished slot is not run again by a second instance, a failed one is', async () => {
  let runs = 0;
  const ok = async () => {
    runs += 1;
  };
  assert.equal((await runExclusive('slot-job', ok, { slot: '2026-09-14T09:00' })).ran, true);
  assert.equal((await runExclusive('slot-job', ok, { slot: '2026-09-14T09:00' })).ran, false);
  assert.equal((await runExclusive('slot-job', ok, { slot: '2026-09-15T09:00' })).ran, true);
  assert.equal(runs, 2);

  const failing = await runExclusive(
    'slot-fail',
    async () => {
      throw new Error('boom');
    },
    { slot: '2026-09-14T09:00' }
  );
  assert.equal(failing.ran, true);
  assert.match(failing.error.message, /boom/);
  assert.equal((await JobLock.findOne({ name: 'slot-fail' })).lastError, 'boom');
  assert.equal((await runExclusive('slot-fail', ok, { slot: '2026-09-14T09:00' })).ran, true);
});

test('the scheduler finds the next Dhaka wall-clock time', () => {
  const nine = { hour: 9, minute: 0 };
  // 08:59 Dhaka is 02:59 UTC.
  assert.equal(nextDhakaRun(nine, new Date('2026-09-14T02:59:00Z')).toISOString(), '2026-09-14T03:00:00.000Z');
  // Exactly at the time: the next one is tomorrow.
  assert.equal(nextDhakaRun(nine, new Date('2026-09-14T03:00:00Z')).toISOString(), '2026-09-15T03:00:00.000Z');
  // 00:30 Dhaka on the 15th is still the 14th in UTC; 02:00 Dhaka that morning is 20:00 UTC.
  const two = { hour: 2 };
  const at = nextDhakaRun(two, new Date('2026-09-14T18:30:00Z'));
  assert.equal(at.toISOString(), '2026-09-14T20:00:00.000Z');
  assert.equal(slotFor(two, at), '2026-09-15T02:00');
});

/** A confirmed order, written raw: the digest only reads status and confirmedAt. */
async function confirmedOrder(profile, confirmedAt, code) {
  await Order.collection.insertOne({
    orderCode: code,
    reseller: profile._id,
    origin: 'form',
    paymentMode: PAYMENT_MODE.COD,
    businessDate: '2026-09-14',
    status: ORDER_STATUS.CONFIRMED,
    confirmedAt,
    items: [],
    createdAt: confirmedAt,
  });
}

const setWallet = (profile, { balance, limit, seq = 1 }) =>
  ResellerProfile.updateOne(
    { _id: profile._id },
    { $set: { balancePoisha: balance, creditLimitPoisha: limit, ledgerSeq: seq } }
  );

test('the daily digest lists aging orders and near-limit resellers, once per Dhaka day', async () => {
  const owner = await f.makeOwner();
  const near = await f.makeReseller({ slug: 'near-shop' });
  const fine = await f.makeReseller({ slug: 'fine-shop' });
  const fresh = await f.makeReseller({ slug: 'fresh-shop' });
  const over = await f.makeReseller({ slug: 'over-shop' });
  const gone = await f.makeReseller({ slug: 'gone-shop' });

  // Limit 1000 taka. Within a tenth of it: balance -900 taka exactly qualifies.
  await setWallet(near.profile, { balance: -90000, limit: 100000 });
  await setWallet(fine.profile, { balance: -89999, limit: 100000 });
  await setWallet(fresh.profile, { balance: 0, limit: 0, seq: 0 });
  // Past a zero limit, as a reversal can leave a wallet.
  await setWallet(over.profile, { balance: -500, limit: 0 });
  await setWallet(gone.profile, { balance: -500, limit: 0 });
  await User.updateOne({ _id: gone.user._id }, { $set: { isActive: false } });

  // 23:50 Dhaka on the 14th.
  const lateNight = new Date('2026-09-14T17:50:00Z');
  // Default threshold is 24 hours: one just over, one just under.
  await confirmedOrder(near.profile, new Date(lateNight.getTime() - 24 * HOUR - 60 * 1000), 'AGED01');
  await confirmedOrder(near.profile, new Date(lateNight.getTime() - 23 * HOUR), 'YOUNG1');

  await OutboxMessage.collection.insertOne({
    user: owner.user._id,
    eventType: EVENT_TYPE.DEPOSIT_APPROVED,
    channels: [],
    status: 'dead',
    deadAt: new Date(lateNight.getTime() - HOUR),
  });
  smsService.balance = async () => 12;

  const first = await dailyDigest({ now: lateNight });
  assert.equal(first.dayKey, '2026-09-14');
  assert.equal(first.agingCount, 1);
  assert.deepEqual(first.agingCodes, ['AGED01']);
  assert.equal(first.nearLimitCount, 2);
  assert.deepEqual(new Set(first.nearLimitShops), new Set(['Test Shop']));
  assert.equal(first.deadLetters, 1);
  assert.equal(first.smsLow, true);
  assert.equal(first.resellersWarned, 2);
  assert.equal(first.ownersAlerted, 1);

  const warned = await Notification.find({ eventType: EVENT_TYPE.BALANCE_NEAR_LIMIT }).lean();
  assert.deepEqual(
    new Set(warned.map((n) => String(n.user))),
    new Set([String(near.user._id), String(over.user._id)])
  );

  const digest = await Notification.findOne({ user: owner.user._id, eventType: EVENT_TYPE.ALERT_DAILY_DIGEST });
  assert.match(digest.body, /AGED01/);
  assert.match(digest.body, /এসএমএস ব্যালেন্স কম: 12/);

  // Twenty minutes later it is 00:10 Dhaka on the 15th: a new business day.
  const afterMidnight = new Date('2026-09-14T18:10:00Z');
  const second = await dailyDigest({ now: afterMidnight });
  assert.equal(second.dayKey, '2026-09-15');
  assert.equal(second.resellersWarned, 2);
  assert.equal(second.ownersAlerted, 1);

  // A re-run on the same Dhaka day says nothing new.
  const third = await dailyDigest({ now: new Date('2026-09-15T02:00:00Z') });
  assert.equal(third.dayKey, '2026-09-15');
  assert.equal(third.resellersWarned, 0);
  assert.equal(third.ownersAlerted, 0);
  assert.equal(await Notification.countDocuments({ eventType: EVENT_TYPE.BALANCE_NEAR_LIMIT }), 4);
});

test('a morning with nothing to report sends the owner nothing', async () => {
  await f.makeOwner();
  const result = await dailyDigest({ now: new Date() });
  assert.equal(result.ownersAlerted, 0);
  assert.equal(await Notification.countDocuments({}), 0);
});

test('nightly reconciliation alerts the owner only when a wallet drifted', async () => {
  const owner = await f.makeOwner();
  const { profile } = await f.makeReseller({ slug: 'drift-shop' });

  const clean = await nightlyReconcile();
  assert.equal(clean.driftedCount, 0);
  assert.equal(await Notification.countDocuments({}), 0);

  // The denormalised balance no longer matches an empty ledger.
  await ResellerProfile.updateOne({ _id: profile._id }, { $set: { balancePoisha: 123 } });
  const drift = await nightlyReconcile();
  assert.equal(drift.driftedCount, 1);
  assert.equal(drift.alerted, 1);
  const alert = await Notification.findOne({ user: owner.user._id, eventType: EVENT_TYPE.ALERT_LEDGER_DRIFT });
  assert.match(alert.body, /Test Shop/);

  // Read defensively whatever shape a batched reconcileAll returns.
  assert.equal(summarise({ checked: 3, drifted: 2, driftedIds: ['a', 'b'] }).driftedCount, 2);
  assert.deepEqual(summarise([{ ok: true }, { ok: false, reseller: 'x' }]).driftedIds, ['x']);
});

/* ================================================================ kyc purge */

async function submission(profile, status, { reviewedAt = null, createdAt } = {}) {
  const doc = await KycSubmission.create({
    reseller: profile._id,
    status,
    reviewedAt,
    documents: [
      { type: 'nid_front', storageKey: `chapaimango/kyc/${new mongoose.Types.ObjectId()}-f.jpg` },
      { type: 'nid_back', storageKey: `chapaimango/kyc/${new mongoose.Types.ObjectId()}-b.jpg` },
    ],
  });
  if (createdAt) await KycSubmission.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  return doc;
}

test('the KYC purge deletes only scans past their retention', async () => {
  const now = new Date('2026-09-14T21:00:00Z');
  const deleted = [];
  storage.isConfigured = () => true;
  storage.destroy = async (key) => {
    deleted.push(key);
  };

  const active = await f.makeReseller();
  const longGone = await f.makeReseller();
  const recentlyGone = await f.makeReseller();
  await User.updateOne(
    { _id: longGone.user._id },
    { $set: { isActive: false, deactivatedAt: new Date(now.getTime() - 400 * DAY) } }
  );
  await User.updateOne(
    { _id: recentlyGone.user._id },
    { $set: { isActive: false, deactivatedAt: new Date(now.getTime() - 100 * DAY) } }
  );

  const oldRejected = await submission(active.profile, REVIEW_STATUS.REJECTED, {
    reviewedAt: new Date(now.getTime() - 91 * DAY),
  });
  const newRejected = await submission(active.profile, REVIEW_STATUS.REJECTED, {
    reviewedAt: new Date(now.getTime() - 89 * DAY),
  });
  const oldPending = await submission(longGone.profile, REVIEW_STATUS.PENDING, {
    createdAt: new Date(now.getTime() - 500 * DAY),
  });
  const activeApproved = await submission(active.profile, REVIEW_STATUS.APPROVED, {
    reviewedAt: new Date(now.getTime() - 800 * DAY),
  });
  const goneApproved = await submission(longGone.profile, REVIEW_STATUS.APPROVED, {
    reviewedAt: new Date(now.getTime() - 800 * DAY),
  });
  const recentApproved = await submission(recentlyGone.profile, REVIEW_STATUS.APPROVED, {
    reviewedAt: new Date(now.getTime() - 800 * DAY),
  });

  const result = await kycPurge({ now });
  assert.equal(result.purged, 2);
  assert.equal(result.failed, 0);

  const expectedKeys = [...oldRejected.documents, ...goneApproved.documents].map((d) => d.storageKey);
  assert.deepEqual(new Set(deleted), new Set(expectedKeys));

  for (const kept of [newRejected, oldPending, activeApproved, recentApproved]) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await KycSubmission.findById(kept._id);
    assert.equal(doc.purgedAt, null);
    assert.ok(doc.documents.every((d) => d.storageKey));
  }

  const purged = await KycSubmission.findById(goneApproved._id);
  assert.ok(purged.purgedAt);
  assert.equal(purged.status, REVIEW_STATUS.APPROVED, 'the decision history stays');
  assert.equal(purged.documents.length, 2);
  assert.ok(purged.documents.every((d) => !d.storageKey));
  await purged.validate(); // still a valid document without its keys

  // Idempotent: a second run finds nothing.
  deleted.length = 0;
  assert.equal((await kycPurge({ now })).purged, 0);
  assert.equal(deleted.length, 0);
});

test('a failed delete leaves the submission for tomorrow, and no storage means no purge', async () => {
  const now = new Date();
  const { profile } = await f.makeReseller();
  const sub = await submission(profile, REVIEW_STATUS.REJECTED, { reviewedAt: new Date(now.getTime() - 100 * DAY) });

  storage.isConfigured = () => false;
  assert.equal((await kycPurge({ now })).skipped, true);
  assert.equal((await KycSubmission.findById(sub._id)).purgedAt, null);

  storage.isConfigured = () => true;
  storage.destroy = async () => {
    throw new Error('R2 unavailable');
  };
  const result = await kycPurge({ now });
  assert.equal(result.failed, 1);
  assert.equal((await KycSubmission.findById(sub._id)).purgedAt, null);
});

test('deactivating a reseller starts the retention clock, and repeating it does not restart it', async () => {
  const owner = await f.makeOwner();
  const { profile, user } = await f.makeReseller();
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ phone: owner.phone, password: owner.password });
  assert.equal(login.status, 200);

  await agent.patch(`/api/owner/resellers/${profile._id}`).send({ isActive: false });
  const first = (await User.findById(user._id)).deactivatedAt;
  assert.ok(first);

  await sleep(5);
  await agent.patch(`/api/owner/resellers/${profile._id}`).send({ isActive: false });
  assert.equal((await User.findById(user._id)).deactivatedAt.getTime(), first.getTime());

  await agent.patch(`/api/owner/resellers/${profile._id}`).send({ isActive: true });
  const back = await User.findById(user._id);
  assert.equal(back.isActive, true);
  assert.equal(back.deactivatedAt, null);
});
