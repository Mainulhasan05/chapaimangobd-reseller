'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const RefreshToken = require('../models/RefreshToken');
const TrustedDevice = require('../models/TrustedDevice');

const ACCESS_COOKIE = 'cm_at';
const REFRESH_COOKIE = 'cm_rt';
// Scoped so the refresh token is not sent on every single API call.
const REFRESH_PATH = '/api/auth';
// The owner's remembered device. Only ever read by the login endpoints, so it
// shares the refresh token's path. See docs/adr/0014.
const DEVICE_COOKIE = 'cm_dv';
const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const signAccessToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
  });

const verifyAccessToken = (token) => jwt.verify(token, env.JWT_ACCESS_SECRET);

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Issues a refresh token into a family. A family is one device. Rotation replaces
 * the token within its family, so a phone and a laptop do not evict each other.
 */
async function issueRefreshToken(user, { familyId, userAgent } = {}) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    user: user._id,
    familyId: familyId || crypto.randomUUID(),
    tokenHash: hashToken(raw),
    expiresAt,
    userAgent,
  });

  return { raw, expiresAt };
}

const revokeFamily = (familyId) =>
  RefreshToken.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });

/*
 * Two tabs of the same browser refreshing at the same moment present the same
 * token twice within milliseconds. That is not theft, and revoking the family
 * for it would sign a reseller out every time they open a second tab. A replay
 * inside this window is refused without revoking anything; outside it, it is
 * treated as stolen.
 */
const REUSE_GRACE_MS = 10 * 1000;

/**
 * Rotates a refresh token. Presenting a token that was already used means it was
 * stolen, so the entire family is revoked rather than just refusing this request.
 *
 * The token is consumed by one status-guarded update, so two concurrent calls
 * cannot both pass: exactly one gets the document back and the other sees it
 * already used. A read followed by a save let both through.
 */
async function rotateRefreshToken(raw, { now = new Date() } = {}) {
  const tokenHash = hashToken(raw);

  const consumed = await RefreshToken.findOneAndUpdate(
    { tokenHash, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true }
  );
  if (consumed) return { ok: true, userId: consumed.user, familyId: consumed.familyId };

  // The guard failed. Work out why, from the document as it is now.
  const existing = await RefreshToken.findOne({ tokenHash });
  if (!existing) return { reason: 'unknown' };
  if (existing.revokedAt) return { reason: 'revoked' };

  if (existing.usedAt) {
    if (now.getTime() - existing.usedAt.getTime() < REUSE_GRACE_MS) {
      return { reason: 'raced' };
    }
    await revokeFamily(existing.familyId);
    return { reason: 'reused', familyId: existing.familyId, user: existing.user };
  }

  return { reason: 'expired' };
}

const revokeAllForUser = (userId) =>
  RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });

/**
 * The attributes that identify a cookie to the browser. Clearing has to repeat
 * them exactly: a clear with a different domain or path is a different cookie,
 * and the session silently survives the logout.
 */
function cookieScope(path = '/') {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    // Lax is enough because the browser only ever talks to the Next origin,
    // which rewrites to this API. See docs/adr/0005.
    sameSite: 'lax',
    path,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

const cookieOptions = (maxAgeMs, path = '/') => ({ ...cookieScope(path), maxAge: maxAgeMs });

function setAuthCookies(res, { accessToken, refreshToken, refreshExpiresAt }) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(15 * 60 * 1000));
  if (refreshToken) {
    res.cookie(
      REFRESH_COOKIE,
      refreshToken,
      cookieOptions(refreshExpiresAt.getTime() - Date.now(), REFRESH_PATH)
    );
  }
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, cookieScope('/'));
  res.clearCookie(REFRESH_COOKIE, cookieScope(REFRESH_PATH));
}

/* ------------------------------------------------------ trusted devices -- */

/**
 * Remembers this browser for the user for thirty days. The cookie carries a
 * random token; the database keeps its hash, bound to the user.
 */
async function trustDevice(res, user, { userAgent, ip } = {}) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_TTL_MS);

  await TrustedDevice.create({
    user: user._id,
    tokenHash: hashToken(raw),
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    ip: ip || null,
    lastUsedAt: now,
    expiresAt,
  });

  res.cookie(DEVICE_COOKIE, raw, cookieOptions(DEVICE_TTL_MS, REFRESH_PATH));
  return expiresAt;
}

/**
 * The live trusted device this request's cookie names for this user, or null.
 * A cookie issued to another account matches nothing, because the lookup is by
 * user as well as by hash.
 */
async function findTrustedDevice(req, user, { now = new Date() } = {}) {
  const raw = req.cookies && req.cookies[DEVICE_COOKIE];
  if (!raw || typeof raw !== 'string') return null;

  return TrustedDevice.findOneAndUpdate(
    { tokenHash: hashToken(raw), user: user._id, expiresAt: { $gt: now } },
    { $set: { lastUsedAt: now } },
    { new: true }
  );
}

const forgetDevicesForUser = (userId) => TrustedDevice.deleteMany({ user: userId });

module.exports = {
  ACCESS_COOKIE,
  DEVICE_COOKIE,
  DEVICE_TTL_MS,
  trustDevice,
  findTrustedDevice,
  forgetDevicesForUser,
  REFRESH_COOKIE,
  REFRESH_PATH,
  REUSE_GRACE_MS,
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  setAuthCookies,
  clearAuthCookies,
  cookieScope,
  hashToken,
};
