'use strict';

const Notification = require('../../models/Notification');
const PushSubscription = require('../../models/PushSubscription');
const webpush = require('../../channels/webpush');
const { ok } = require('../../middleware/error');
const { readPaging, findPage } = require('../../utils/cursor');

const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * The notification inbox, for whoever is signed in.
 *
 * Shared rather than duplicated, because none of it was ever reseller specific:
 * every handler here is scoped to `req.user` and knows nothing about roles. It
 * lived under the reseller module only because the reseller was the first to
 * get an inbox.
 *
 * The owner did not have one at all, which is the bug this splits out to fix.
 * Notifications were written for the owner on every confirmed order and every
 * manual order, queued, delivered to Telegram and web push, and then had
 * nowhere to be read: there was no endpoint that would return them. The owner's
 * only way to learn that a reseller had confirmed an order was to go and look
 * at the orders page.
 */

/**
 * The inbox, newest first, a page at a time, with the unread count alongside.
 *
 * Paged by cursor rather than by number: notifications arrive while someone is
 * reading, and a page number over a growing list repeats rows. Thirty by
 * default, at most a hundred; `nextCursor` is null on the last page.
 *
 * The count is a separate query rather than a filter over what was fetched,
 * because the badge has to be right even when the unread ones run past the end
 * of the page.
 */
async function list(req, res) {
  const paging = readPaging(
    { limit: req.query.limit || String(PAGE_SIZE), cursor: req.query.cursor },
    { defaultLimit: PAGE_SIZE, maxLimit: MAX_PAGE_SIZE }
  );
  const [{ rows, nextCursor }, unread] = await Promise.all([
    findPage(Notification, { user: req.user._id }, { paging }),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);
  return ok(res, { notifications: rows, unread, nextCursor });
}

async function markRead(req, res) {
  await Notification.updateMany(
    { user: req.user._id, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return ok(res, { read: true });
}

/**
 * One browser's push subscription, keyed by its endpoint.
 *
 * Upserted rather than inserted: the same person on the same browser re-grants
 * permission after clearing site data and the endpoint comes back the same, so
 * inserting would accumulate duplicates and send the same message twice.
 */
async function subscribePush(req, res) {
  const { endpoint, keys } = req.body;
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { $set: { user: req.user._id, endpoint, keys, userAgent: req.get('user-agent') } },
    { upsert: true }
  );
  return ok(res, { subscribed: true });
}

async function unsubscribePush(req, res) {
  await PushSubscription.deleteOne({ endpoint: req.body.endpoint, user: req.user._id });
  return ok(res, { subscribed: false });
}

const pushKey = (_req, res) => ok(res, { publicKey: webpush.publicKey() });

module.exports = { list, markRead, subscribePush, unsubscribePush, pushKey };
