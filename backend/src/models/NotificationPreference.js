'use strict';

const mongoose = require('mongoose');
const { EVENT_TYPE, values } = require('../domain/constants');

/**
 * One user's channel choices, per event type. Only what differs from the
 * defaults in domain/notificationPrefs.js needs to be here, so a user who never
 * opens the screen has no document and gets the defaults.
 *
 * A list rather than a map keyed by event type, because event types contain
 * dots and MongoDB map keys may not.
 */
const overrideSchema = new mongoose.Schema(
  {
    eventType: { type: String, enum: values(EVENT_TYPE), required: true },
    push: { type: Boolean },
    telegram: { type: Boolean },
    sms: { type: Boolean },
  },
  { _id: false }
);

const notificationPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    events: { type: [overrideSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationPreference', notificationPreferenceSchema);
