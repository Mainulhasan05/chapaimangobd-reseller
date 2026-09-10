'use strict';

const mongoose = require('mongoose');
const { EVENT_TYPE, NOTIFICATION_CHANNEL, values } = require('../domain/constants');

/**
 * Carries side effects out of a database transaction. A transaction callback is
 * retried on write conflict, so sending an SMS or a push from inside one would
 * send it twice. Nothing leaves the process until after commit.
 */
const outboxMessageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventType: { type: String, enum: values(EVENT_TYPE), required: true },
    channels: [{ type: String, enum: values(NOTIFICATION_CHANNEL) }],
    payload: { type: mongoose.Schema.Types.Mixed },

    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    sentAt: { type: Date, default: null },
    lastError: { type: String },
  },
  { timestamps: true }
);

outboxMessageSchema.index({ sentAt: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('OutboxMessage', outboxMessageSchema);
