'use strict';

const bcrypt = require('bcryptjs');
const User = require('../../models/User');
const ResellerProfile = require('../../models/ResellerProfile');
const RefreshToken = require('../../models/RefreshToken');
const tokens = require('../../services/tokens');
const { getSettings } = require('../../services/settings');
const { ok } = require('../../middleware/error');
const { badRequest, unauthorized } = require('../../utils/errors');
const { normalizeBdPhone } = require('../../utils/phone');
const { slugify, isReserved } = require('../../utils/slug');
const { ROLES, KYC_STATUS } = require('../../domain/constants');

const BCRYPT_ROUNDS = 12;

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

/** Registration is reseller only. The single owner comes from the seed script. */
async function register(req, res) {
  const { name, password, shopName } = req.body;
  const phoneE164 = normalizeBdPhone(req.body.phone);

  const existing = await User.findOne({ phoneE164 });
  if (existing) {
    throw badRequest('PHONE_TAKEN', 'That phone number is already registered', {
      phone: 'Already registered',
    });
  }

  const settings = await getSettings();
  const user = await User.create({
    name,
    phoneE164,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
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

async function login(req, res) {
  const { password } = req.body;
  const phoneE164 = normalizeBdPhone(req.body.phone);

  const user = await User.findOne({ phoneE164 }).select('+passwordHash');
  // The same message either way, so this endpoint is not a registered-user oracle.
  const invalid = () => unauthorized('Phone number or password is incorrect');
  if (!user) throw invalid();

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw invalid();
  if (!user.isActive) throw unauthorized('This account has been suspended');

  user.lastLoginAt = new Date();
  await user.save();

  await issueSession(res, user, req.get('user-agent'));
  return ok(res, { user: user.toJSON() });
}

/**
 * Rotation with reuse detection. Presenting an already-rotated token means it was
 * stolen, so the whole device family is revoked rather than just refusing this call.
 */
async function refresh(req, res) {
  const raw = req.cookies[tokens.REFRESH_COOKIE];
  if (!raw) throw unauthorized('No session to refresh');

  const result = await tokens.rotateRefreshToken(raw, { userAgent: req.get('user-agent') });
  if (!result.ok) {
    tokens.clearAuthCookies(res);
    const message =
      result.reason === 'reused'
        ? 'This session was used from somewhere else and has been ended'
        : 'Please sign in again';
    throw unauthorized(message);
  }

  const user = await User.findById(result.userId);
  if (!user || !user.isActive) {
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

module.exports = { register, login, refresh, logout, me, allocateSlug };
