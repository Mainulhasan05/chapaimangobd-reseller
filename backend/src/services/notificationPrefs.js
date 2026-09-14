'use strict';

const NotificationPreference = require('../models/NotificationPreference');
const TelegramLink = require('../models/TelegramLink');
const gateway = require('../channels/sms');
const env = require('../config/env');
const { getSettings } = require('./settings');
const { ROLES } = require('../domain/constants');
const { GROUPS, CHANNELS, eventsFor, defaultsFor, lockedFor } = require('../domain/notificationPrefs');
const { badRequest } = require('../utils/errors');

/**
 * Reads and writes a user's per-event channel choices. `notify.resolveChannels`
 * reads through `preferenceFor`; the two preference endpoints use the rest.
 */

/** The effective choice for one event: defaults, then overrides, then locks. */
function effective(role, eventType, doc) {
  const prefs = defaultsFor(role, eventType);
  const override = doc && doc.events ? doc.events.find((e) => e.eventType === eventType) : null;
  if (override) {
    CHANNELS.forEach((channel) => {
      if (typeof override[channel] === 'boolean') prefs[channel] = override[channel];
    });
  }
  lockedFor(eventType).forEach((channel) => {
    prefs[channel] = true;
  });
  return prefs;
}

async function preferenceFor(user, eventType) {
  const doc = await NotificationPreference.findOne({ user: user._id || user }).lean();
  return effective(user.role, eventType, doc);
}

/**
 * Whether reseller-paid SMS can reach this user at all: the master switch and
 * the owner's per-reseller flag. Credits are not part of it, because a reseller
 * with none can still choose what they would like to receive once they buy some.
 * The owner's own SMS needs only a gateway.
 */
function smsAvailability(user, profile, settings) {
  if (user.role === ROLES.OWNER) return gateway.isConfigured();
  return Boolean(settings.features.sms && profile && profile.channelPrefs && profile.channelPrefs.sms);
}

/** The whole screen: every event this role can receive, grouped, with its switches. */
async function describe(user, profile) {
  const [settings, doc, link] = await Promise.all([
    getSettings(),
    NotificationPreference.findOne({ user: user._id }).lean(),
    TelegramLink.findOne({ user: user._id, chatId: { $ne: null } }).lean(),
  ]);

  const smsAvailable = smsAvailability(user, profile, settings);

  return {
    inApp: true,
    smsAvailable,
    channels: {
      push: { available: Boolean(settings.features.webPush && env.webPushConfigured) },
      telegram: {
        available: Boolean(settings.features.telegram && env.telegramConfigured),
        linked: Boolean(link),
      },
      sms: { available: smsAvailable },
    },
    groups: (GROUPS[user.role] || []).map((group) => ({
      key: group.key,
      events: group.events.map((eventType) => ({
        eventType,
        ...effective(user.role, eventType, doc),
        locked: lockedFor(eventType),
      })),
    })),
  };
}

/**
 * Saves the choices sent. Unknown events for this role are refused; locked
 * channels are ignored rather than refused, so a client that sends the whole
 * matrix back does not fail on the rows it cannot change.
 */
async function update(user, events) {
  const allowed = new Set(eventsFor(user.role));
  const unknown = events.find((e) => !allowed.has(e.eventType));
  if (unknown) {
    throw badRequest('VALIDATION_FAILED', 'Some fields are invalid', {
      events: `Unknown event for this account: ${unknown.eventType}`,
    });
  }

  const doc =
    (await NotificationPreference.findOne({ user: user._id })) ||
    new NotificationPreference({ user: user._id, events: [] });

  events.forEach((incoming) => {
    const locked = lockedFor(incoming.eventType);
    let row = doc.events.find((e) => e.eventType === incoming.eventType);
    if (!row) {
      doc.events.push({ eventType: incoming.eventType });
      row = doc.events[doc.events.length - 1];
    }
    CHANNELS.forEach((channel) => {
      if (typeof incoming[channel] === 'boolean' && !locked.includes(channel)) {
        row[channel] = incoming[channel];
      }
    });
  });

  await doc.save();
}

module.exports = { preferenceFor, describe, update, effective };
