'use strict';

const mongoose = require('mongoose');
const TrustedDevice = require('../../models/TrustedDevice');
const tokens = require('../../services/tokens');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { notFound } = require('../../utils/errors');

/**
 * The owner's trusted devices: the browsers that may sign in with a password
 * alone for thirty days. See docs/adr/0014.
 *
 * They could be created and could expire, but nobody could see them, so a lost
 * phone stayed trusted until its thirty days ran out unless the owner reset the
 * password and forgot every device at once. This lists them and forgets one.
 */

/**
 * A name a person recognises: "Chrome · Android". Read from the user agent the
 * device presented when it was trusted, so it is a description and not a proof
 * of anything. Falls back to the raw string, cut short, for one nobody planned.
 */
function deviceLabel(userAgent) {
  if (!userAgent) return null;
  const ua = String(userAgent);

  const browsers = [
    [/Edg\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser\//, 'Samsung Internet'],
    [/UCBrowser\//, 'UC Browser'],
    [/Firefox\//, 'Firefox'],
    [/Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari'],
  ];
  const systems = [
    [/Android/, 'Android'],
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
  ];
  const pick = (list) => (list.find(([pattern]) => pattern.test(ua)) || [])[1];

  const parts = [pick(browsers), pick(systems)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : ua.slice(0, 60);
}

/** The device this request came from, by its cookie, or null. */
function currentHash(req) {
  const raw = req.cookies && req.cookies[tokens.DEVICE_COOKIE];
  return raw && typeof raw === 'string' ? tokens.hashToken(raw) : null;
}

/** GET /auth/devices — the live ones, most recently used first. */
async function listDevices(req, res) {
  const devices = await TrustedDevice.find({ user: req.user._id, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .lean();
  const mine = currentHash(req);

  return ok(res, {
    devices: devices.map((d) => ({
      id: d._id,
      label: deviceLabel(d.userAgent),
      lastUsedAt: d.lastUsedAt || null,
      createdAt: d.createdAt,
      expiresAt: d.expiresAt,
      // The browser asking. Revoking it means the next sign-in here takes a code.
      current: Boolean(mine && d.tokenHash === mine),
    })),
  });
}

/**
 * DELETE /auth/devices/:id — forgets one device. Its next sign-in asks for a
 * code again, while the device-OTP rule is on. Sessions already open on it are
 * not ended: that is "sign out everywhere", which a password change does.
 */
async function revokeDevice(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Device not found');

  const device = await TrustedDevice.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!device) throw notFound('Device not found');

  const wasCurrent = currentHash(req) === device.tokenHash;
  if (wasCurrent) res.clearCookie(tokens.DEVICE_COOKIE, tokens.cookieScope(tokens.REFRESH_PATH));

  await audit.record({
    actor: req.user._id,
    action: 'device.revoke',
    targetType: 'TrustedDevice',
    targetId: device._id,
    before: { label: deviceLabel(device.userAgent), lastUsedAt: device.lastUsedAt || null },
    after: null,
    ip: req.ip,
  });

  return ok(res, { revoked: true, current: wasCurrent });
}

module.exports = { listDevices, revokeDevice, deviceLabel };
