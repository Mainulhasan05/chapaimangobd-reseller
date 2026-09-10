'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const RefreshToken = require('../models/RefreshToken');

const ACCESS_COOKIE = 'cm_at';
const REFRESH_COOKIE = 'cm_rt';
// Scoped so the refresh token is not sent on every single API call.
const REFRESH_PATH = '/api/auth';

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

/**
 * Rotates a refresh token. Presenting a token that was already used means it was
 * stolen, so the entire family is revoked rather than just refusing this request.
 */
async function rotateRefreshToken(raw, { userAgent } = {}) {
  const existing = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (!existing) return { reason: 'unknown' };

  if (existing.revokedAt) return { reason: 'revoked' };

  if (existing.usedAt) {
    await RefreshToken.updateMany(
      { familyId: existing.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return { reason: 'reused', familyId: existing.familyId, user: existing.user };
  }

  if (existing.expiresAt.getTime() < Date.now()) return { reason: 'expired' };

  existing.usedAt = new Date();
  await existing.save();

  return { ok: true, userId: existing.user, familyId: existing.familyId };
}

const revokeFamily = (familyId) =>
  RefreshToken.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });

const revokeAllForUser = (userId) =>
  RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });

function cookieOptions(maxAgeMs, path = '/') {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    // Lax is enough because the browser only ever talks to the Next origin,
    // which rewrites to this API. See docs/adr/0005.
    sameSite: 'lax',
    path,
    maxAge: maxAgeMs,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

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
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_PATH,
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  setAuthCookies,
  clearAuthCookies,
  hashToken,
};
