'use strict';

const User = require('../models/User');
const ResellerProfile = require('../models/ResellerProfile');
const { verifyAccessToken, ACCESS_COOKIE } = require('../services/tokens');
const { unauthorized, forbidden } = require('../utils/errors');
const { ROLES, KYC_STATUS } = require('../domain/constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * The real authorization boundary. The Next proxy also redirects unauthenticated
 * traffic, but that is a user-experience nicety and is never trusted. Nothing
 * here reads a header the proxy could have injected. See docs/adr/0004.
 */
function readToken(req) {
  if (req.cookies && req.cookies[ACCESS_COOKIE]) return req.cookies[ACCESS_COOKIE];
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

const authenticate = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid session');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('Account no longer exists');
  if (!user.isActive) throw forbidden('This account has been suspended');

  req.user = user;
  next();
});

/** Attaches req.user when a valid session exists, but never rejects. */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive) req.user = user;
  } catch {
    // An expired token on a public page is not an error.
  }
  return next();
});

const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };

/** Loads the caller reseller profile onto req.reseller. */
const loadReseller = asyncHandler(async (req, _res, next) => {
  if (!req.user || req.user.role !== ROLES.RESELLER) throw forbidden();
  const profile = await ResellerProfile.findOne({ user: req.user._id });
  if (!profile) throw forbidden('Reseller profile is missing');
  req.reseller = profile;
  next();
});

/**
 * Gates the two actions that create real obligations: activating a public form
 * and confirming an order. Everything else stays open while KYC is pending, so
 * a reseller can do their setup work during the wait.
 */
function requireKyc(req, _res, next) {
  if (!req.reseller) return next(forbidden('Reseller profile is missing'));
  if (req.reseller.kycStatus !== KYC_STATUS.APPROVED) {
    return next(forbidden('Your KYC verification must be approved before you can do this'));
  }
  return next();
}

module.exports = { authenticate, optionalAuth, requireRole, loadReseller, requireKyc };
