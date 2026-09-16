'use strict';

const bcrypt = require('bcryptjs');
const User = require('../../models/User');
const ResellerProfile = require('../../models/ResellerProfile');
const RefreshToken = require('../../models/RefreshToken');
const tokens = require('../../services/tokens');
const otp = require('../../services/otp');
const audit = require('../../services/audit');
const { enqueue } = require('../../services/outbox');
const { notify, resolveChannels } = require('../../services/notify');
const { getSettings } = require('../../services/settings');
const env = require('../../config/env');
const { logger } = require('../../config/logger');
const { ok } = require('../../middleware/error');
const { AppError, badRequest, unauthorized } = require('../../utils/errors');
const { normalizeBdPhone, toLocalBd } = require('../../utils/phone');
const { formatDhakaDateTime } = require('../../utils/dhakaTime');
const { slugify, isReserved } = require('../../utils/slug');
const {
  ROLES,
  KYC_STATUS,
  OTP_PURPOSE,
  EVENT_TYPE,
  NOTIFICATION_CHANNEL,
} = require('../../domain/constants');

const BCRYPT_ROUNDS = 12;

/*
 * Per-account lockout (docs/adr/0014). Five wrong passwords within the window
 * lock the account for fifteen minutes. The per-IP limiter still applies; this
 * is what stops a slow guess spread across many addresses.
 */
const MAX_FAILED_LOGINS = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

/*
 * A deactivated reseller keeps a read-only session so money is never trapped
 * (docs/adr/0011); middleware/auth.js refuses their writes. Any other inactive
 * account is suspended outright.
 */
const maySignIn = (user) => user.isActive || user.role === ROLES.RESELLER;

/** Finds a free slug near the one the name suggests. */
async function allocateSlug(name) {
  const base = slugify(name);
  const candidates = [base];
  for (let i = 2; i <= 40; i += 1) candidates.push(`${base}-${i}`);

  for (const candidate of candidates) {
    if (isReserved(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    const taken = await ResellerProfile.exists({ slug: candidate });
    if (!taken) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

async function issueSession(res, user, userAgent) {
  const accessToken = tokens.signAccessToken(user);
  const { raw, expiresAt } = await tokens.issueRefreshToken(user, { userAgent });
  tokens.setAuthCookies(res, { accessToken, refreshToken: raw, refreshExpiresAt: expiresAt });
}

const phoneTaken = (field = 'phone') =>
  badRequest('PHONE_TAKEN', 'That phone number is already registered', {
    [field]: 'Already registered',
  });

const wrongPassword = (field) =>
  badRequest('WRONG_PASSWORD', 'The password is not correct', { [field]: 'Wrong password' });

/** 017*****678, so the owner can tell which phone the code went to. */
const maskPhone = (phoneE164) => {
  const local = toLocalBd(phoneE164);
  return `${local.slice(0, 3)}${'*'.repeat(local.length - 6)}${local.slice(-3)}`;
};

/* ------------------------------------------------------------ register -- */

/**
 * Step one of registration: prove the phone. Registration reveals whether a
 * number is registered by its nature, so saying so here costs nothing.
 */
async function registerOtp(req, res) {
  const phoneE164 = normalizeBdPhone(req.body.phone);
  if (await User.exists({ phoneE164 })) throw phoneTaken();

  const { expiresAt } = await otp.send(phoneE164, OTP_PURPOSE.REGISTER);
  return ok(res, { sent: true, expiresAt });
}

/** Registration is reseller only. The single owner comes from the seed script. */
async function register(req, res) {
  const { name, password, shopName } = req.body;
  const phoneE164 = normalizeBdPhone(req.body.phone);

  // Checked before the code is spent, so a taken number does not burn it.
  if (await User.exists({ phoneE164 })) throw phoneTaken();

  await otp.verify(phoneE164, OTP_PURPOSE.REGISTER, req.body.otp);

  const settings = await getSettings();
  const user = await User.create({
    name,
    phoneE164,
    passwordHash: await hashPassword(password),
    role: ROLES.RESELLER,
  });

  const profile = await ResellerProfile.create({
    user: user._id,
    shopName: shopName || name,
    slug: await allocateSlug(shopName || name),
    kycStatus: KYC_STATUS.NOT_SUBMITTED,
    creditLimitPoisha: settings.defaultCreditLimitPoisha,
  });

  await issueSession(res, user, req.get('user-agent'));
  return ok(res, { user: user.toJSON(), profile }, 201);
}

/* --------------------------------------------------------------- login -- */

const accountLocked = () =>
  new AppError(423, 'ACCOUNT_LOCKED', 'Too many wrong passwords. Try again in 15 minutes');

/**
 * Counts one wrong password, atomically, and locks the account on the fifth
 * inside the window. A failure older than the window starts the count again.
 * Returns the updated user.
 */
function recordFailedLogin(userId, now = new Date()) {
  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);
  const lockUntil = new Date(now.getTime() + LOCK_MS);
  const reached = { $gte: ['$failedLoginCount', MAX_FAILED_LOGINS] };

  return User.findOneAndUpdate(
    { _id: userId },
    [
      {
        $set: {
          failedLoginCount: {
            $cond: [
              { $lt: [{ $ifNull: ['$lastFailedLoginAt', new Date(0)] }, windowStart] },
              1,
              { $add: [{ $ifNull: ['$failedLoginCount', 0] }, 1] },
            ],
          },
          lastFailedLoginAt: now,
        },
      },
      { $set: { lockedUntil: { $cond: [reached, lockUntil, { $ifNull: ['$lockedUntil', null] }] } } },
      // The count restarts once locked, so the next window gets five fresh tries.
      { $set: { failedLoginCount: { $cond: [reached, 0, '$failedLoginCount'] } } },
    ],
    { new: true }
  );
}

const clearFailedLogins = (userId, extra = {}) =>
  User.updateOne(
    { _id: userId },
    { $set: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, ...extra } }
  );

async function completeLogin(req, res, user) {
  const now = new Date();
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: now } });
  user.lastLoginAt = now; // eslint-disable-line no-param-reassign
  await issueSession(res, user, req.get('user-agent'));
  return ok(res, { user: user.toJSON() });
}

async function login(req, res) {
  const { password } = req.body;
  const phoneE164 = normalizeBdPhone(req.body.phone);

  const user = await User.findOne({ phoneE164 }).select('+passwordHash');
  // The same message either way, so this endpoint is not a registered-user oracle.
  const invalid = () => unauthorized('Phone number or password is incorrect');
  if (!user) throw invalid();

  // Refused before the password is even compared, so a locked account cannot be
  // guessed at while it waits. This reveals that a locked number exists, which
  // is accepted: see docs/adr/0014.
  if (user.lockedUntil && user.lockedUntil > new Date()) throw accountLocked();

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    const updated = await recordFailedLogin(user._id);
    if (updated && updated.lockedUntil && updated.lockedUntil > new Date()) throw accountLocked();
    throw invalid();
  }
  if (!maySignIn(user)) throw unauthorized('This account has been suspended');

  await clearFailedLogins(user._id);

  /*
   * The owner's new-device check, which is off unless `OWNER_DEVICE_OTP` turns
   * it on. With it on, a password alone is not enough from a browser that has
   * not proved itself in the last thirty days, and no session is issued here:
   * the code, bound to this password check by the challenge id, has to come
   * back first. See docs/adr/0014 for why the default changed.
   */
  if (user.role === ROLES.OWNER && env.ownerDeviceOtp) {
    const device = await tokens.findTrustedDevice(req, user);
    if (!device) {
      const { challengeId, expiresAt } = await otp.send(user.phoneE164, OTP_PURPOSE.OWNER_DEVICE, {
        user,
        withChallenge: true,
      });
      return ok(res, {
        requiresOtp: true,
        challengeId,
        phoneHint: maskPhone(user.phoneE164),
        expiresAt,
      });
    }
  }

  return completeLogin(req, res, user);
}

/** A short, readable device description for an alert. */
const describeDevice = (userAgent) => (userAgent ? String(userAgent).slice(0, 120) : null);

/**
 * Tells the owner their account was just opened on a new device: in-app,
 * Telegram, and an owner-paid SMS. Never throws into the login.
 */
async function alertNewDevice(user, req) {
  try {
    const at = formatDhakaDateTime(new Date()).slice(0, 16);
    const data = { at, device: describeDevice(req.get('user-agent')), ip: req.ip || null };
    const eventType = EVENT_TYPE.ALERT_NEW_DEVICE;

    const notification = await notify({ user, eventType, data });
    const resolved = await resolveChannels(user, eventType);

    // Telegram even when the owner has switched it off for resellers: this is
    // a security alert to the owner, not a notification a reseller pays for.
    if (!resolved.includes(NOTIFICATION_CHANNEL.TELEGRAM) && notification) {
      await enqueue({
        user,
        eventType,
        channels: [NOTIFICATION_CHANNEL.TELEGRAM],
        payload: { title: notification.title, body: notification.body, data },
      });
    }

    // English, so it fits one GSM-7 segment. Owner-paid; see outbox sendSms.
    await enqueue({
      user,
      eventType,
      channels: [NOTIFICATION_CHANNEL.SMS],
      payload: {
        title: `ChapaiMango: owner login from a new device at ${at} Dhaka. Not you? Reset your password now`,
        data,
      },
    });
  } catch (err) {
    logger.error({ err }, 'auth: new device alert failed');
  }
}

/** Step two of the owner's new-device sign-in. */
async function verifyLogin(req, res) {
  const record = await otp.verifyChallenge(req.body.challengeId, OTP_PURPOSE.OWNER_DEVICE, req.body.otp);

  const user = await User.findById(record.userId);
  if (!user || !user.isActive || user.role !== ROLES.OWNER) {
    throw unauthorized('Please sign in again');
  }

  await tokens.trustDevice(res, user, { userAgent: req.get('user-agent'), ip: req.ip });
  const response = await completeLogin(req, res, user);
  await alertNewDevice(user, req);
  return response;
}

/**
 * Rotation with reuse detection. Presenting an already-rotated token means it was
 * stolen, so the whole device family is revoked rather than just refusing this call.
 */
async function refresh(req, res) {
  const raw = req.cookies[tokens.REFRESH_COOKIE];
  if (!raw) throw unauthorized('No session to refresh');

  const result = await tokens.rotateRefreshToken(raw);
  if (result.reason === 'raced') {
    // Another tab won the same rotation a moment ago and its response carries
    // the new cookies. Clearing them here would sign that tab out too.
    // A code of its own, so the browser retries its request instead of
    // treating this as a signed-out answer.
    throw new AppError(401, 'SESSION_REFRESHING', 'Session is being refreshed, please retry');
  }
  if (!result.ok) {
    tokens.clearAuthCookies(res);
    const message =
      result.reason === 'reused'
        ? 'This session was used from somewhere else and has been ended'
        : 'Please sign in again';
    throw unauthorized(message);
  }

  const user = await User.findById(result.userId);
  if (!user || !maySignIn(user)) {
    tokens.clearAuthCookies(res);
    throw unauthorized('Please sign in again');
  }

  const accessToken = tokens.signAccessToken(user);
  const { raw: nextRaw, expiresAt } = await tokens.issueRefreshToken(user, {
    familyId: result.familyId,
    userAgent: req.get('user-agent'),
  });
  tokens.setAuthCookies(res, { accessToken, refreshToken: nextRaw, refreshExpiresAt: expiresAt });

  return ok(res, { user: user.toJSON() });
}

/** Revokes server side, not merely clears the cookie. */
async function logout(req, res) {
  const raw = req.cookies[tokens.REFRESH_COOKIE];
  if (raw) {
    const record = await RefreshToken.findOne({ tokenHash: tokens.hashToken(raw) });
    if (record) await tokens.revokeFamily(record.familyId);
  }
  tokens.clearAuthCookies(res);
  return ok(res, { loggedOut: true });
}

async function me(req, res) {
  const payload = { user: req.user.toJSON() };
  if (req.user.role === ROLES.RESELLER) {
    payload.profile = await ResellerProfile.findOne({ user: req.user._id });
  }
  const settings = await getSettings();
  payload.features = settings.features;
  return ok(res, payload);
}

/* ------------------------------------------------------------ password -- */

/**
 * Always the same answer, whether or not the number has an account. The send
 * allowance is taken either way, so hitting the limit does not tell the two
 * apart either.
 */
async function forgotPassword(req, res) {
  const phoneE164 = normalizeBdPhone(req.body.phone);
  otp.assertCanSend();

  const user = await User.findOne({ phoneE164 });
  await otp.takeSendAllowance(phoneE164, OTP_PURPOSE.RESET_PASSWORD);

  if (user && maySignIn(user)) {
    await otp.send(phoneE164, OTP_PURPOSE.RESET_PASSWORD, { user, allowanceTaken: true });
  }

  return ok(res, { sent: true });
}

/** Sets a new password from a code, and ends every session the account has. */
async function resetPassword(req, res) {
  const phoneE164 = normalizeBdPhone(req.body.phone);

  const user = await User.findOne({ phoneE164 });
  // No account means no code was ever sent, which is what the code check says.
  if (!user || !maySignIn(user)) {
    throw badRequest('OTP_EXPIRED', 'That code has expired or was replaced, request a new one', {
      otp: 'Code expired',
    });
  }

  await otp.verify(phoneE164, OTP_PURPOSE.RESET_PASSWORD, req.body.otp, { user });

  await clearFailedLogins(user._id, {
    passwordHash: await hashPassword(req.body.newPassword),
    mustChangePassword: false,
    passwordChangedAt: new Date(),
  });
  await tokens.revokeAllForUser(user._id);
  // A reset is what someone does after losing a phone or a laptop: remembered
  // devices are forgotten too, so the owner's next sign-in asks for a code.
  await tokens.forgetDevicesForUser(user._id);
  tokens.clearAuthCookies(res);

  await audit.record({
    actor: user._id,
    action: 'user.password_reset_otp',
    targetType: 'User',
    targetId: user._id,
    ip: req.ip,
  });

  return ok(res, { reset: true });
}

/** Changes the password, ends every other session, and keeps this one. */
async function changePassword(req, res) {
  const user = await User.findById(req.user._id).select('+passwordHash');
  const matches = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
  if (!matches) throw wrongPassword('currentPassword');

  if (await bcrypt.compare(req.body.newPassword, user.passwordHash)) {
    throw badRequest('SAME_PASSWORD', 'Choose a password different from the current one', {
      newPassword: 'Same as current password',
    });
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(req.body.newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    }
  );

  // Every family, this one included, then a fresh session for this browser.
  await tokens.revokeAllForUser(user._id);
  const fresh = await User.findById(user._id);
  await issueSession(res, fresh, req.get('user-agent'));

  await audit.record({
    actor: user._id,
    action: 'user.password_change',
    targetType: 'User',
    targetId: user._id,
    ip: req.ip,
  });

  return ok(res, { user: fresh.toJSON() });
}

/* --------------------------------------------------------------- phone -- */

async function newPhoneFrom(req, user) {
  const phoneE164 = normalizeBdPhone(req.body.newPhone, 'newPhone');
  if (phoneE164 === user.phoneE164) {
    throw badRequest('SAME_PHONE', 'That is already your phone number', { newPhone: 'Same as current' });
  }
  if (await User.exists({ phoneE164 })) throw phoneTaken('newPhone');
  return phoneE164;
}

/** Sends a code to the new number, which is the number that has to prove itself. */
async function phoneOtp(req, res) {
  const phoneE164 = await newPhoneFrom(req, req.user);
  const { expiresAt } = await otp.send(phoneE164, OTP_PURPOSE.CHANGE_PHONE, { user: req.user });
  return ok(res, { sent: true, expiresAt });
}

/**
 * Moves the account to a new phone. The phone is the login identity, so every
 * session ends and the person signs in again with the new number.
 */
async function changePhone(req, res) {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(req.body.password, user.passwordHash))) throw wrongPassword('password');

  const phoneE164 = await newPhoneFrom(req, user);
  await otp.verify(phoneE164, OTP_PURPOSE.CHANGE_PHONE, req.body.otp, { user });

  const before = user.phoneE164;
  try {
    await User.updateOne({ _id: user._id }, { $set: { phoneE164 } });
  } catch (err) {
    // Somebody registered the number between the check and the write.
    if (err && err.code === 11000) throw phoneTaken('newPhone');
    throw err;
  }

  await tokens.revokeAllForUser(user._id);
  tokens.clearAuthCookies(res);

  await audit.record({
    actor: user._id,
    action: 'user.phone_change',
    targetType: 'User',
    targetId: user._id,
    before: { phoneE164: before },
    after: { phoneE164 },
    ip: req.ip,
  });

  return ok(res, { changed: true, loggedOut: true });
}

module.exports = {
  register,
  registerOtp,
  login,
  verifyLogin,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
  changePassword,
  phoneOtp,
  changePhone,
  allocateSlug,
  hashPassword,
  MAX_FAILED_LOGINS,
  LOCK_MS,
};
