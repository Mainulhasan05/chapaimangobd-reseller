'use strict';

const Notification = require('../models/Notification');
const OutboxMessage = require('../models/OutboxMessage');
const ResellerProfile = require('../models/ResellerProfile');
const { getSettings } = require('./settings');
const { NOTIFICATION_CHANNEL, EVENT_TYPE, ROLES } = require('../domain/constants');

/**
 * The in-app record is always written and is the source of truth. Every other
 * channel is best effort: web push is dropped by aggressive Android battery savers,
 * Telegram needs a linked chat, SMS needs credits and a feature flag. Nothing in a
 * business flow may depend on an external channel arriving.
 *
 * Never call this inside a transaction. A transaction callback is retried on write
 * conflict, which would send the same message twice.
 */

/** Money events are worth paying for. Everything else stays free. */
const SMS_WORTHY = new Set([
  EVENT_TYPE.DEPOSIT_APPROVED,
  EVENT_TYPE.DEPOSIT_REJECTED,
  EVENT_TYPE.WITHDRAWAL_APPROVED,
  EVENT_TYPE.ORDER_CANCELLED,
  EVENT_TYPE.BALANCE_NEAR_LIMIT,
]);

async function resolveChannels(user, eventType) {
  const channels = [NOTIFICATION_CHANNEL.IN_APP];
  const settings = await getSettings();

  const profile =
    user.role === ROLES.RESELLER ? await ResellerProfile.findOne({ user: user._id }) : null;
  const prefs = profile ? profile.channelPrefs : { webPush: true, telegram: true, sms: false };

  if (settings.features.webPush && prefs.webPush) channels.push(NOTIFICATION_CHANNEL.WEB_PUSH);
  if (settings.features.telegram && prefs.telegram) channels.push(NOTIFICATION_CHANNEL.TELEGRAM);

  // SMS costs money per message, so it needs the global flag, the reseller
  // preference, credits in hand, and an event that justifies the spend.
  if (
    settings.features.sms &&
    prefs.sms &&
    profile &&
    profile.smsCredits > 0 &&
    SMS_WORTHY.has(eventType)
  ) {
    channels.push(NOTIFICATION_CHANNEL.SMS);
  }

  return channels;
}

/** Writes the record and queues the fan-out. Never throws into the caller. */
async function notify({ user, eventType, title, body, data = {} }) {
  if (!user) return null;

  try {
    const notification = await Notification.create({
      user: user._id || user,
      eventType,
      title,
      body,
      data,
    });

    const channels = await resolveChannels(user, eventType);
    const external = channels.filter((c) => c !== NOTIFICATION_CHANNEL.IN_APP);

    if (external.length > 0) {
      await OutboxMessage.create({
        user: user._id || user,
        eventType,
        channels: external,
        payload: { title, body, data },
      });
    }

    return notification;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] failed', eventType, err.message);
    return null;
  }
}

module.exports = { notify, resolveChannels, SMS_WORTHY };
