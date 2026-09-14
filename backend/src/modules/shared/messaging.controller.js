'use strict';

const telegram = require('../../channels/telegram');
const notificationPrefs = require('../../services/notificationPrefs');
const { ok } = require('../../middleware/error');
const { badRequest } = require('../../utils/errors');

/**
 * Telegram linking and notification preferences, for whoever is signed in.
 *
 * Shared for the same reason the inbox is: nothing here depends on the role
 * except which events are listed, and that is decided by the preferences
 * service from `req.user.role`. The reseller routes attach `req.reseller`,
 * which is what tells the SMS column whether reseller-paid SMS is on for them.
 */

/** Whether this account has a chat linked, and the bot to open when it has not. */
async function telegramStatus(req, res) {
  return ok(res, await telegram.status(req.user._id));
}

/** A one-time token (15 minutes) and the `t.me` deep link that carries it. */
async function telegramLinkToken(req, res) {
  if (!telegram.isConfigured()) throw badRequest('NOT_CONFIGURED', 'Telegram is not set up yet');
  return ok(res, await telegram.createLinkToken(req.user._id));
}

async function telegramUnlink(req, res) {
  await telegram.unlinkUser(req.user._id);
  return ok(res, { linked: false });
}

async function getPreferences(req, res) {
  return ok(res, await notificationPrefs.describe(req.user, req.reseller || null));
}

async function updatePreferences(req, res) {
  await notificationPrefs.update(req.user, req.body.events);
  return ok(res, await notificationPrefs.describe(req.user, req.reseller || null));
}

module.exports = {
  telegramStatus,
  telegramLinkToken,
  telegramUnlink,
  getPreferences,
  updatePreferences,
};
