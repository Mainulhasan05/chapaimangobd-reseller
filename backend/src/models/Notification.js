'use strict';

const mongoose = require('mongoose');
const { EVENT_TYPE, values } = require('../domain/constants');

/** Always written. This is the source of truth; every other channel is best effort. */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: { type: String, enum: values(EVENT_TYPE), required: true },
    title: { type: String, required: true },
    body: { type: String },
    data: { type: mongoose.Schema.Types.Mixed },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
