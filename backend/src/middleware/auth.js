'use strict';

const User = require('../models/User');
const ResellerProfile = require('../models/ResellerProfile');
const { verifyAccessToken, ACCESS_COOKIE } = require('../services/tokens');
const { AppError, unauthorized, forbidden } = require('../utils/errors');
const { ROLES } = require('../domain/constants');
const { kycBlocks } = require('../domain/kyc');
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

/**
 * What a session that must change its password may still reach. Refresh and
 * logout do not pass through `authenticate` today; they are listed so that
 * adding it there later cannot lock someone inside a temporary password.
 */
const PASSWORD_CHANGE_PATHS = new Set([
  '/api/auth/me',
  '/api/auth/password/change',
  '/api/auth/logout',
  '/api/auth/refresh',
]);

/** The mounted path without a query string or a trailing slash. */
function fullPath(req) {
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
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
  /*
   * A deactivated reseller keeps a read-only session: they can still see their
   * orders and balance and ask for their money back (docs/adr/0011). Which
   * writes remain open is decided per router by `readOnlyWhenInactive`. Any
   * other inactive account is refused outright.
   */
  if (!user.isActive && user.role !== ROLES.RESELLER) {
    throw forbidden('This account has been suspended');
  }

  /*
   * A temporary password handed out by the owner is a credential that passed
   * through another person. Until it is replaced, the session can do nothing
   * but read who it is, replace it, or end. The interface redirects to the
   * account page; this is what makes that redirect more than a suggestion.
   */
  if (user.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(fullPath(req))) {
    throw new AppError(
      403,
      'PASSWORD_CHANGE_REQUIRED',
      'Choose a new password before doing anything else'
    );
  }

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
 *
 * It gates nothing at all for a reseller the owner has not asked to verify,
 * which is every reseller by default. See docs/adr/0017.
 */
function requireKyc(req, _res, next) {
  if (!req.reseller) return next(forbidden('Reseller profile is missing'));
  if (kycBlocks(req.reseller)) {
    return next(forbidden('Your KYC verification must be approved before you can do this'));
  }
  return next();
}

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What a deactivated account may still do. Reads always; writes only where the
 * router lists them, as `METHOD /path` relative to the router's mount point.
 * Everything else is a 403 RESELLER_INACTIVE the interface can recognise and
 * explain, rather than a generic refusal. See docs/adr/0011.
 *
 * @param {string[]} allowedWrites e.g. ['POST /withdrawals']
 */
function readOnlyWhenInactive(allowedWrites = []) {
  const allowed = new Set(allowedWrites);
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.isActive) return next();
    if (READ_ONLY_METHODS.has(req.method)) return next();

    const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
    if (allowed.has(`${req.method} ${path}`)) return next();

    return next(
      new AppError(
        403,
        'RESELLER_INACTIVE',
        'Your account has been deactivated. You can view your records and request a withdrawal.'
      )
    );
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  loadReseller,
  requireKyc,
  readOnlyWhenInactive,
};
