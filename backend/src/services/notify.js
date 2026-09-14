'use strict';

const { logger } = require('../config/logger');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { enqueue } = require('./outbox');
const ResellerProfile = require('../models/ResellerProfile');
const gateway = require('../channels/sms');
const { getSettings } = require('./settings');
const { preferenceFor } = require('./notificationPrefs');
const { NOTIFICATION_CHANNEL, EVENT_TYPE, ROLES } = require('../domain/constants');
const { textFor } = require('../domain/notificationText');
const { urlFor } = require('../domain/notificationLinks');
const { RESELLER_SMS_DEFAULT } = require('../domain/notificationPrefs');

/**
 * The in-app record is always written and is the source of truth. Every other
 * channel is best effort: web push is dropped by aggressive Android battery savers,
 * Telegram needs a linked chat, SMS needs credits and a feature flag. Nothing in a
 * business flow may depend on an external channel arriving.
 *
 * Never call this inside a transaction. A transaction callback is retried on write
 * conflict, which would send the same message twice.
 */

/** Kept for callers that ask; the defaults themselves live in domain/notificationPrefs.js. */
const SMS_WORTHY = RESELLER_SMS_DEFAULT;

/**
 * The channels an event goes out on, for this user.
 *
 * Three layers, each able only to narrow the one before: the owner's feature
 * switches, then the user's own per-event preferences (services/notificationPrefs.js),
 * then whatever the channel itself needs.
 */
async function resolveChannels(user, eventType) {
  const channels = [NOTIFICATION_CHANNEL.IN_APP];
  const settings = await getSettings();
  const prefs = await preferenceFor(user, eventType);

  if (settings.features.webPush && prefs.push) channels.push(NOTIFICATION_CHANNEL.WEB_PUSH);
  if (settings.features.telegram && prefs.telegram) channels.push(NOTIFICATION_CHANNEL.TELEGRAM);

  if (prefs.sms && (await smsAllowed(user, eventType, settings))) {
    channels.push(NOTIFICATION_CHANNEL.SMS);
  }

  return channels;
}

async function smsAllowed(user, eventType, settings) {
  /*
   * The owner's SMS is owner-paid (docs/adr/0013) and needs only a gateway. A
   * new-device alert is left out: the login flow always sends that one itself,
   * and including it here would send it twice.
   */
  if (user.role === ROLES.OWNER) {
    return gateway.isConfigured() && eventType !== EVENT_TYPE.ALERT_NEW_DEVICE;
  }

  // Reseller-paid: the master switch, the owner's flag for this reseller, and
  // credits in hand.
  if (!settings.features.sms) return false;
  const profile = await ResellerProfile.findOne({ user: user._id });
  return Boolean(profile && profile.channelPrefs.sms && profile.smsCredits > 0);
}

/**
 * Writes the record and queues the fan-out. Never throws into the caller.
 *
 * The wording comes from the event and its data, not from the caller. It used
 * to be written inline at each call site, in English, and those strings are not
 * only the in-app row: they are the push notification on the lock screen, the
 * Telegram message and the SMS, none of which pass through an interface that
 * could translate them. A caller may still pass `title` explicitly, for a
 * one-off with nothing to template from.
 */
async function notify({ user, eventType, title, body, data = {} }) {
  if (!user) return null;

  try {
    const text = textFor(eventType, data);

    // A bare id is not enough to know whose screens a link points into.
    const recipient = user.role ? user : await User.findById(user).select('role');
    if (!recipient) return null;

    /*
     * The event type and the page to open ride along with the data, so the
     * service worker and the inbox open the right screen without each guessing
     * from the fields. See domain/notificationLinks.js.
     */
    const enriched = { ...data, eventType, url: urlFor(recipient.role, eventType, data) };

    const notification = await Notification.create({
      user: recipient._id,
      eventType,
      title: title || text.title,
      body: body || text.body,
      data: enriched,
    });

    const channels = await resolveChannels(recipient, eventType);
    const external = channels.filter((c) => c !== NOTIFICATION_CHANNEL.IN_APP);

    if (external.length > 0) {
      await enqueue({
        user: recipient._id,
        eventType,
        channels: external,
        // The resolved wording, not the caller's arguments: what goes out on
        // Telegram must read the same as what is in the list.
        payload: { title: notification.title, body: notification.body, data: enriched },
      });
    }

    return notification;
  } catch (err) {
    logger.error({ err, eventType }, 'notify: failed');
    return null;
  }
}

module.exports = { notify, resolveChannels, SMS_WORTHY };
