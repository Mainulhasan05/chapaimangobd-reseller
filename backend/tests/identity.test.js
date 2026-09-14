'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Otp = require('../src/models/Otp');
const SmsLog = require('../src/models/SmsLog');
const AuditLog = require('../src/models/AuditLog');
const Notification = require('../src/models/Notification');
const OutboxMessage = require('../src/models/OutboxMessage');
const RefreshToken = require('../src/models/RefreshToken');
const TrustedDevice = require('../src/models/TrustedDevice');
const RateLimitHit = require('../src/models/RateLimitHit');
const otp = require('../src/services/otp');
const tokens = require('../src/services/tokens');
const { drainOnce } = require('../src/services/outbox');
const { updateSettings } = require('../src/services/settings');
const { normalizeBdPhone } = require('../src/utils/phone');
const {
  OTP_PURPOSE,
  EVENT_TYPE,
  NOTIFICATION_CHANNEL,
  SMS_PAYER,
  SMS_CATEGORY,
  SMS_STATUS,
  SMS_PURPOSE,
} = require('../src/domain/constants');

/**
 * Phase D: OTP, registration, password and phone changes, lockout, the owner's
 * trusted devices and the owner's reseller password reset. docs/adr/0013, 0014.
 */

test.before(startDb);
test.after(stopDb);

const realFetch = global.fetch;
const saved = {
  smsApiKey: env.smsApiKey,
  smsSenderId: env.smsSenderId,
  smsConfigured: env.smsConfigured,
  ownerDeviceOtp: env.ownerDeviceOtp,
};

test.beforeEach(resetDb);

test.afterEach(() => {
  Object.assign(env, saved);
  global.fetch = realFetch;
});

/** Stands in for Automas and records what it was asked to send. */
function stubGateway() {
  const calls = [];
  env.smsApiKey = 'test-api-key';
  env.smsSenderId = 'TESTSENDER';
  env.smsConfigured = true;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
    const body = JSON.stringify({ response: [{ status: 0, id: 'MSG-1' }] });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  return calls;
}

function cookieFrom(res, name) {
  const header = res.headers['set-cookie'] || [];
  const line = header.find((c) => c.startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(name.length + 1).split(';')[0];
}

const e164 = (phone) => normalizeBdPhone(phone);

async function signIn({ phone, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

/** Lets the one-minute resend cooldown run out, without waiting a minute. */
const endResendCooldown = () =>
  RateLimitHit.updateMany({ key: /^otp-cooldown:/ }, { $set: { resetAt: new Date(Date.now() - 1) } });

const liveTokens = (userId) => RefreshToken.countDocuments({ user: userId, revokedAt: null });

/* ======================================================================= otp */

test('an OTP is stored hashed, and the SMS log never holds the code', async () => {
  const phone = e164(f.nextPhone());
  await otp.send(phone, OTP_PURPOSE.REGISTER);
  const code = otp.__lastCodeFor(phone, OTP_PURPOSE.REGISTER);
  assert.match(code, /^\d{6}$/);

  const doc = await Otp.findOne({ phoneE164: phone }).select('+codeHash').lean();
  assert.ok(doc.codeHash);
  assert.notEqual(doc.codeHash, code);
  assert.ok(!JSON.stringify(doc).includes(code), 'the code appears nowhere in the stored row');
  assert.equal(doc.codeHash, otp.hashCode(phone, OTP_PURPOSE.REGISTER, code));

  const log = await SmsLog.findOne({ toPhoneE164: phone }).lean();
  assert.ok(log, 'every attempt is logged, even without a gateway');
  assert.ok(!log.text.includes(code));
  assert.equal(log.payer, SMS_PAYER.OWNER);
  assert.equal(log.category, SMS_CATEGORY.OTP);
});

test('an expired OTP does not verify', async () => {
  const phone = e164(f.nextPhone());
  await otp.send(phone, OTP_PURPOSE.REGISTER);
  const code = otp.__lastCodeFor(phone, OTP_PURPOSE.REGISTER);

  await Otp.updateMany({ phoneE164: phone }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(otp.verify(phone, OTP_PURPOSE.REGISTER, code), { code: 'OTP_EXPIRED' });
});

test('five wrong attempts void the code, even for the right one after', async () => {
  const phone = e164(f.nextPhone());
  await otp.send(phone, OTP_PURPOSE.REGISTER);
  const code = otp.__lastCodeFor(phone, OTP_PURPOSE.REGISTER);
  const wrong = code === '000000' ? '111111' : '000000';

  for (let i = 1; i < otp.MAX_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(otp.verify(phone, OTP_PURPOSE.REGISTER, wrong), { code: 'OTP_INVALID' });
  }
  await assert.rejects(otp.verify(phone, OTP_PURPOSE.REGISTER, wrong), { code: 'OTP_EXPIRED' });
  await assert.rejects(otp.verify(phone, OTP_PURPOSE.REGISTER, code), { code: 'OTP_EXPIRED' });
});

test('a code verifies once, only for its purpose, and a newer code replaces it', async () => {
  const phone = e164(f.nextPhone());
  await otp.send(phone, OTP_PURPOSE.REGISTER);
  const first = otp.__lastCodeFor(phone, OTP_PURPOSE.REGISTER);
  await endResendCooldown();
  await otp.send(phone, OTP_PURPOSE.REGISTER);
  const second = otp.__lastCodeFor(phone, OTP_PURPOSE.REGISTER);

  if (first !== second) {
    await assert.rejects(otp.verify(phone, OTP_PURPOSE.REGISTER, first));
  }
  await assert.rejects(otp.verify(phone, OTP_PURPOSE.RESET_PASSWORD, second), { code: 'OTP_EXPIRED' });

  const consumed = await otp.verify(phone, OTP_PURPOSE.REGISTER, second);
  assert.ok(consumed.consumedAt);
  await assert.rejects(otp.verify(phone, OTP_PURPOSE.REGISTER, second), { code: 'OTP_EXPIRED' });
});

test('a phone gets three codes an hour and no more', async () => {
  const phone = f.nextPhone();
  for (let i = 0; i < otp.SENDS_PER_HOUR; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).post('/api/auth/register/otp').send({ phone });
    assert.equal(res.status, 200);
    // eslint-disable-next-line no-await-in-loop
    await endResendCooldown();
  }
  const refused = await request(app).post('/api/auth/register/otp').send({ phone });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.code, 'OTP_SEND_LIMIT');
  assert.equal(await Otp.countDocuments({ phoneE164: e164(phone) }), otp.SENDS_PER_HOUR);
});

test('a second code for the same phone and purpose within a minute waits, with the seconds left', async () => {
  const phone = f.nextPhone();
  const first = await request(app).post('/api/auth/register/otp').send({ phone });
  assert.equal(first.status, 200);

  const again = await request(app).post('/api/auth/register/otp').send({ phone });
  assert.equal(again.status, 429);
  assert.equal(again.body.error.code, 'OTP_COOLDOWN');
  assert.ok(Number.isInteger(again.body.error.retryAfter));
  assert.ok(again.body.error.retryAfter > 0 && again.body.error.retryAfter <= 60);
  assert.equal(again.headers['retry-after'], String(again.body.error.retryAfter));
  assert.equal(await Otp.countDocuments({ phoneE164: e164(phone) }), 1, 'no second code was issued');

  // Another purpose for the same phone is not held up.
  await otp.send(e164(phone), OTP_PURPOSE.RESET_PASSWORD);

  // Two of the hour's three codes are spent. Had the refused resend counted
  // too, this third one would be over the limit.
  await endResendCooldown();
  assert.equal((await request(app).post('/api/auth/register/otp').send({ phone })).status, 200);
});

test('forgot password waits out the cooldown whether or not the number has an account', async () => {
  const { phone } = await f.makeReseller();
  const unknown = f.nextPhone();

  for (const number of [phone, unknown]) {
    // eslint-disable-next-line no-await-in-loop
    const first = await request(app).post('/api/auth/password/forgot').send({ phone: number });
    assert.equal(first.status, 200);
    // eslint-disable-next-line no-await-in-loop
    const second = await request(app).post('/api/auth/password/forgot').send({ phone: number });
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, 'OTP_COOLDOWN');
  }
});

test('an OTP goes out and is logged as owner-paid while the SMS switch is off', async () => {
  const calls = stubGateway();
  await updateSettings({ 'features.sms': false });

  const phone = f.nextPhone();
  const res = await request(app).post('/api/auth/register/otp').send({ phone });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const code = otp.__lastCodeFor(e164(phone), OTP_PURPOSE.REGISTER);
  assert.equal(calls.length, 1);
  assert.ok(decodeURIComponent(calls[0].body).includes(code), 'the gateway got the real code');

  const log = await SmsLog.findOne({ toPhoneE164: e164(phone) }).lean();
  assert.equal(log.status, SMS_STATUS.SENT);
  assert.equal(log.payer, SMS_PAYER.OWNER);
  assert.equal(log.category, SMS_CATEGORY.OTP);
  assert.equal(log.purpose, SMS_PURPOSE.OTP);
  assert.ok(!log.text.includes(code));
});

test('registering an already registered phone is refused before any code is sent', async () => {
  const { phone } = await f.makeReseller();
  const res = await request(app).post('/api/auth/register/otp').send({ phone });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'PHONE_TAKEN');
  assert.equal(await Otp.countDocuments({}), 0);
});

/* ============================================================== registration */

test('registration needs a valid code for that phone', async () => {
  const phone = f.nextPhone();
  const body = { name: 'Rifat Mango Ghor', phone, password: 'password123' };

  const missing = await request(app).post('/api/auth/register').send(body);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VALIDATION_FAILED');

  await request(app).post('/api/auth/register/otp').send({ phone });
  const code = otp.__lastCodeFor(e164(phone), OTP_PURPOSE.REGISTER);
  const wrong = code === '000000' ? '111111' : '000000';

  const bad = await request(app).post('/api/auth/register').send({ ...body, otp: wrong });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'OTP_INVALID');
  assert.equal(await User.countDocuments({ phoneE164: e164(phone) }), 0);

  const good = await request(app).post('/api/auth/register').send({ ...body, otp: code });
  assert.equal(good.status, 201);
  assert.equal(good.body.data.user.mustChangePassword, false);
});

/* ================================================================== password */

test('forgot password answers the same for an unknown number and sends nothing', async () => {
  const unknown = await request(app).post('/api/auth/password/forgot').send({ phone: f.nextPhone() });
  const { phone } = await f.makeReseller();
  const known = await request(app).post('/api/auth/password/forgot').send({ phone });

  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(await Otp.countDocuments({}), 1, 'only the real account got a code');
});

test('a reset by code sets the password and ends every session', async () => {
  const { user, phone, password } = await f.makeReseller();
  const agent = await signIn({ phone, password });
  await signIn({ phone, password });
  assert.equal(await liveTokens(user._id), 2);

  await request(app).post('/api/auth/password/forgot').send({ phone });
  const code = otp.__lastCodeFor(user.phoneE164, OTP_PURPOSE.RESET_PASSWORD);

  const res = await request(app)
    .post('/api/auth/password/reset')
    .send({ phone, otp: code, newPassword: 'brand-new-pass' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await liveTokens(user._id), 0);

  const refreshed = await agent.post('/api/auth/refresh');
  assert.equal(refreshed.status, 401);

  const old = await request(app).post('/api/auth/login').send({ phone, password });
  assert.equal(old.status, 401);
  await signIn({ phone, password: 'brand-new-pass' });
});

test('changing the password keeps this session and ends the others', async () => {
  const { user, phone, password } = await f.makeReseller();
  const mine = await signIn({ phone, password });
  const other = await signIn({ phone, password });

  const wrong = await mine
    .post('/api/auth/password/change')
    .send({ currentPassword: 'not-it-at-all', newPassword: 'another-pass-1' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');

  const res = await mine
    .post('/api/auth/password/change')
    .send({ currentPassword: password, newPassword: 'another-pass-1' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await liveTokens(user._id), 1);

  assert.equal((await mine.get('/api/auth/me')).status, 200);
  assert.equal((await mine.post('/api/auth/refresh')).status, 200, 'this browser keeps its session');
  assert.equal((await other.post('/api/auth/refresh')).status, 401, 'the other session is gone');

  await signIn({ phone, password: 'another-pass-1' });
});

/* ===================================================================== phone */

test('changing phone needs a code to the new number and ends every session', async () => {
  const { user, phone, password } = await f.makeReseller();
  const agent = await signIn({ phone, password });
  const { phone: takenPhone } = await f.makeReseller();

  const taken = await agent.post('/api/auth/phone/otp').send({ newPhone: takenPhone });
  assert.equal(taken.status, 400);
  assert.equal(taken.body.error.code, 'PHONE_TAKEN');

  const newPhone = f.nextPhone();
  const sent = await agent.post('/api/auth/phone/otp').send({ newPhone });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const code = otp.__lastCodeFor(e164(newPhone), OTP_PURPOSE.CHANGE_PHONE);

  const badPassword = await agent
    .post('/api/auth/phone/change')
    .send({ newPhone, otp: code, password: 'wrong-password' });
  assert.equal(badPassword.status, 400);
  assert.equal(badPassword.body.error.code, 'WRONG_PASSWORD');

  const res = await agent.post('/api/auth/phone/change').send({ newPhone, otp: code, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const fresh = await User.findById(user._id);
  assert.equal(fresh.phoneE164, e164(newPhone));
  assert.equal(await liveTokens(user._id), 0);
  assert.equal((await agent.post('/api/auth/refresh')).status, 401);

  assert.equal((await request(app).post('/api/auth/login').send({ phone, password })).status, 401);
  await signIn({ phone: newPhone, password });

  const audit = await AuditLog.findOne({ action: 'user.phone_change' }).lean();
  assert.equal(audit.after.phoneE164, e164(newPhone));
});

test('a code sent for another account does not change this one', async () => {
  const a = await f.makeReseller();
  const b = await f.makeReseller();
  const agentA = await signIn(a);
  const agentB = await signIn(b);

  const newPhone = f.nextPhone();
  await agentA.post('/api/auth/phone/otp').send({ newPhone });
  const code = otp.__lastCodeFor(e164(newPhone), OTP_PURPOSE.CHANGE_PHONE);

  const res = await agentB
    .post('/api/auth/phone/change')
    .send({ newPhone, otp: code, password: b.password });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'OTP_EXPIRED');
});

/* =================================================================== lockout */

test('five wrong passwords lock the account, and the lock lifts after the window', async () => {
  const { user, phone, password } = await f.makeReseller();
  const attempt = (pw) => request(app).post('/api/auth/login').send({ phone, password: pw });

  for (let i = 1; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await attempt('wrong-password');
    assert.equal(res.status, 401);
  }
  const fifth = await attempt('wrong-password');
  assert.equal(fifth.status, 423);
  assert.equal(fifth.body.error.code, 'ACCOUNT_LOCKED');

  const whileLocked = await attempt(password);
  assert.equal(whileLocked.status, 423, 'even the right password waits out the lock');

  await User.updateOne({ _id: user._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  await signIn({ phone, password });

  const after = await User.findById(user._id).lean();
  assert.equal(after.failedLoginCount, 0);
  assert.equal(after.lockedUntil, null);
});

test('a success before the fifth failure starts the count again', async () => {
  const { phone, password } = await f.makeReseller();
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await request(app).post('/api/auth/login').send({ phone, password: 'wrong-password' });
  }
  await signIn({ phone, password });
  const res = await request(app).post('/api/auth/login').send({ phone, password: 'wrong-password' });
  assert.equal(res.status, 401);
});

/* ============================================================ owner devices */

async function ownerOtpLogin(owner, agent = request.agent(app)) {
  const first = await agent.post('/api/auth/login').send({ phone: owner.phone, password: owner.password });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  return { agent, first };
}

test('the owner on a new device gets a code, not a session', async () => {
  env.ownerDeviceOtp = true;
  const owner = await f.makeOwner();
  const { agent, first } = await ownerOtpLogin(owner);

  assert.equal(first.body.data.requiresOtp, true);
  assert.ok(first.body.data.challengeId);
  assert.equal(cookieFrom(first, tokens.ACCESS_COOKIE), null, 'no session before the code');
  assert.equal((await agent.get('/api/auth/me')).status, 401);

  const code = otp.__lastCodeFor(owner.user.phoneE164, OTP_PURPOSE.OWNER_DEVICE);
  const wrong = code === '000000' ? '111111' : '000000';
  const bad = await agent
    .post('/api/auth/login/verify')
    .send({ challengeId: first.body.data.challengeId, otp: wrong });
  assert.equal(bad.status, 400);

  const forged = await agent
    .post('/api/auth/login/verify')
    .send({ challengeId: 'x'.repeat(43), otp: code });
  assert.equal(forged.status, 400, 'the code alone, without the challenge, is not enough');

  const ok = await agent
    .post('/api/auth/login/verify')
    .send({ challengeId: first.body.data.challengeId, otp: code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(cookieFrom(ok, tokens.ACCESS_COOKIE));
  assert.ok(cookieFrom(ok, tokens.DEVICE_COOKIE));
  assert.equal((await agent.get('/api/auth/me')).status, 200);
  assert.equal(await TrustedDevice.countDocuments({ user: owner.user._id }), 1);

  // The alert: in-app now, and an owner-paid SMS queued for after the response.
  const alert = await Notification.findOne({ user: owner.user._id, eventType: EVENT_TYPE.ALERT_NEW_DEVICE });
  assert.ok(alert);
  const queued = await OutboxMessage.find({ user: owner.user._id, eventType: EVENT_TYPE.ALERT_NEW_DEVICE }).lean();
  assert.ok(queued.some((m) => m.channels.some((c) => (c.name || c) === NOTIFICATION_CHANNEL.SMS)));
});

test('a trusted device skips the code, and the owner alert SMS ignores the switch', async () => {
  env.ownerDeviceOtp = true;
  const owner = await f.makeOwner();
  const { agent, first } = await ownerOtpLogin(owner);
  const code = otp.__lastCodeFor(owner.user.phoneE164, OTP_PURPOSE.OWNER_DEVICE);
  await agent.post('/api/auth/login/verify').send({ challengeId: first.body.data.challengeId, otp: code });

  await agent.post('/api/auth/logout');
  const again = await agent.post('/api/auth/login').send({ phone: owner.phone, password: owner.password });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.requiresOtp, undefined);
  assert.equal(again.body.data.user.role, 'owner');

  // Drain the alert with a working gateway and the reseller switch off.
  stubGateway();
  await updateSettings({ 'features.sms': false });
  await OutboxMessage.updateMany({}, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
  await drainOnce();

  const log = await SmsLog.findOne({ purpose: SMS_PURPOSE.OWNER_ALERT }).lean();
  assert.ok(log, 'the owner alert SMS was attempted');
  assert.equal(log.status, SMS_STATUS.SENT);
  assert.equal(log.payer, SMS_PAYER.OWNER);
});

test('a device cookie trusted for one account does not trust another', async () => {
  env.ownerDeviceOtp = true;
  const ownerA = await f.makeOwner();
  const ownerB = await f.makeOwner();

  const { agent, first } = await ownerOtpLogin(ownerA);
  const code = otp.__lastCodeFor(ownerA.user.phoneE164, OTP_PURPOSE.OWNER_DEVICE);
  const verified = await agent
    .post('/api/auth/login/verify')
    .send({ challengeId: first.body.data.challengeId, otp: code });
  const deviceCookie = cookieFrom(verified, tokens.DEVICE_COOKIE);
  assert.ok(deviceCookie);

  const res = await request(app)
    .post('/api/auth/login')
    .set('Cookie', `${tokens.DEVICE_COOKIE}=${deviceCookie}`)
    .send({ phone: ownerB.phone, password: ownerB.password });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.requiresOtp, true);
});

test('resellers never see the device code', async () => {
  env.ownerDeviceOtp = true;
  const { phone, password } = await f.makeReseller();
  const res = await request(app).post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.requiresOtp, undefined);
  assert.equal(await Otp.countDocuments({}), 0);
});

/* ============================================================ owner reset */

test('the owner resets a reseller password, which must then be changed', async () => {
  const owner = await f.makeOwner();
  const ownerAgent = await signIn(owner);
  const reseller = await f.makeReseller();
  const resellerAgent = await signIn(reseller);

  const res = await ownerAgent.post(`/api/owner/resellers/${reseller.profile._id}/password-reset`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const temporary = res.body.data.temporaryPassword;
  assert.match(temporary, /^[a-z2-9]{10}$/);

  assert.equal(await liveTokens(reseller.user._id), 0);
  assert.equal((await resellerAgent.post('/api/auth/refresh')).status, 401);

  const audit = await AuditLog.findOne({ action: 'reseller.password_reset' }).lean();
  assert.ok(audit);
  assert.ok(!JSON.stringify(audit).includes(temporary), 'the password is not in the audit log');

  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ phone: reseller.phone, password: temporary });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.mustChangePassword, true);
  assert.equal((await agent.get('/api/auth/me')).body.data.user.mustChangePassword, true);

  const changed = await agent
    .post('/api/auth/password/change')
    .send({ currentPassword: temporary, newPassword: 'my-own-password' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.user.mustChangePassword, false);
});

test('a reseller cannot reset anyone password', async () => {
  const reseller = await f.makeReseller();
  const other = await f.makeReseller();
  const agent = await signIn(reseller);
  const res = await agent.post(`/api/owner/resellers/${other.profile._id}/password-reset`);
  assert.equal(res.status, 403);
});

/* ========================================================== refresh tokens */

test('refresh rotates, a replayed token revokes the family, and logout revokes', async () => {
  const { user, phone, password } = await f.makeReseller();
  const res = await request(app).post('/api/auth/login').send({ phone, password });
  const first = cookieFrom(res, tokens.REFRESH_COOKIE);
  const refreshWith = (raw) =>
    request(app).post('/api/auth/refresh').set('Cookie', `${tokens.REFRESH_COOKIE}=${raw}`);

  const rotated = await refreshWith(first);
  assert.equal(rotated.status, 200);
  const second = cookieFrom(rotated, tokens.REFRESH_COOKIE);
  assert.notEqual(second, first);

  // Replay outside the grace window: theft, so the whole family ends.
  await RefreshToken.updateOne(
    { tokenHash: tokens.hashToken(first) },
    { $set: { usedAt: new Date(Date.now() - tokens.REUSE_GRACE_MS - 1000) } }
  );
  assert.equal((await refreshWith(first)).status, 401);
  assert.equal((await refreshWith(second)).status, 401);
  assert.equal(await liveTokens(user._id), 0);

  const again = await request(app).post('/api/auth/login').send({ phone, password });
  const fresh = cookieFrom(again, tokens.REFRESH_COOKIE);
  await request(app).post('/api/auth/logout').set('Cookie', `${tokens.REFRESH_COOKIE}=${fresh}`);
  assert.equal((await refreshWith(fresh)).status, 401);
});

/* ================================================= must change password */

test('a session that must change its password reaches only me, change, refresh and logout', async () => {
  const owner = await f.makeOwner();
  const ownerAgent = await signIn(owner);
  const reseller = await f.makeReseller();
  const reset = await ownerAgent.post(`/api/owner/resellers/${reseller.profile._id}/password-reset`);
  const temporary = reset.body.data.temporaryPassword;

  const agent = await signIn({ phone: reseller.phone, password: temporary });

  for (const [method, path] of [
    ['get', '/api/reseller/profile'],
    ['get', '/api/reseller/orders'],
    ['post', '/api/reseller/withdrawals'],
    ['post', '/api/auth/phone/otp'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await agent[method](path).send({});
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(res.body.error.code, 'PASSWORD_CHANGE_REQUIRED', `${method} ${path}`);
  }

  assert.equal((await agent.get('/api/auth/me')).status, 200);
  assert.equal((await agent.post('/api/auth/refresh')).status, 200);

  const changed = await agent
    .post('/api/auth/password/change')
    .send({ currentPassword: temporary, newPassword: 'my-own-password' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await agent.get('/api/reseller/profile')).status, 200, 'open again once changed');

  // Logout is always reachable, even with the flag set.
  await User.updateOne({ _id: reseller.user._id }, { $set: { mustChangePassword: true } });
  assert.equal((await agent.post('/api/auth/logout')).status, 200);
});

test('the owner is held to a required password change too', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);
  await User.updateOne({ _id: owner.user._id }, { $set: { mustChangePassword: true } });

  const res = await agent.get('/api/owner/orders');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await agent.get('/api/auth/me')).status, 200);
});

/* ================================================= inactive accounts */

test('a deactivated reseller can still sign in, refresh and reset their password', async () => {
  const reseller = await f.makeReseller();
  await User.updateOne(
    { _id: reseller.user._id },
    { $set: { isActive: false, deactivatedAt: new Date() } }
  );

  const agent = await signIn(reseller);
  assert.equal((await agent.post('/api/auth/refresh')).status, 200);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.isActive, false);

  const forgot = await request(app).post('/api/auth/password/forgot').send({ phone: reseller.phone });
  assert.equal(forgot.status, 200);
  const code = otp.__lastCodeFor(reseller.user.phoneE164, OTP_PURPOSE.RESET_PASSWORD);
  assert.ok(code, 'a code was sent to the deactivated reseller');

  const reset = await request(app)
    .post('/api/auth/password/reset')
    .send({ phone: reseller.phone, otp: code, newPassword: 'fresh-pass-123' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  await signIn({ phone: reseller.phone, password: 'fresh-pass-123' });
});

test('any other inactive account cannot sign in, refresh or reset its password', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);
  await User.updateOne({ _id: owner.user._id }, { $set: { isActive: false } });

  const login = await request(app).post('/api/auth/login').send({ phone: owner.phone, password: owner.password });
  assert.equal(login.status, 401);

  assert.equal((await agent.post('/api/auth/refresh')).status, 401);
  assert.ok([401, 403].includes((await agent.get('/api/owner/orders')).status));

  const forgot = await request(app).post('/api/auth/password/forgot').send({ phone: owner.phone });
  assert.equal(forgot.status, 200, 'the same answer as for any number');
  assert.equal(otp.__lastCodeFor(owner.user.phoneE164, OTP_PURPOSE.RESET_PASSWORD), null, 'but no code');

  const reset = await request(app)
    .post('/api/auth/password/reset')
    .send({ phone: owner.phone, otp: '123456', newPassword: 'fresh-pass-123' });
  assert.equal(reset.status, 400);
  assert.equal(reset.body.error.code, 'OTP_EXPIRED');
});
