'use strict';

const mongoose = require('mongoose');
const { EVENT_TYPE, NOTIFICATION_CHANNEL, values } = require('../domain/constants');

const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  // Gave up after the maximum attempts. Reported in the owner's daily digest.
  DEAD: 'dead',
});

const CHANNEL_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
});

/**
 * Delivery state per channel, so a message whose push went out and whose
 * Telegram failed retries only Telegram. Before this the whole message was
 * retried, and the reseller's phone buzzed once per Telegram outage attempt.
 */
const channelStateSchema = new mongoose.Schema(
  {
    name: { type: String, enum: values(NOTIFICATION_CHANNEL), required: true },
    status: { type: String, enum: values(CHANNEL_STATUS), default: CHANNEL_STATUS.PENDING },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * Messages used to carry `channels` as a plain list of names. Accepting that
 * shape on write keeps every caller, and every older document, working.
 */
const toChannelState = (entry) =>
  typeof entry === 'string' ? { name: entry, status: CHANNEL_STATUS.PENDING, attempts: 0 } : entry;

/**
 * Carries side effects out of a database transaction. A transaction callback is
 * retried on write conflict, so sending an SMS or a push from inside one would
 * send it twice. Nothing leaves the process until after commit.
 *
 * Any number of workers may drain the queue: a message is claimed with an
 * atomic lease (`leaseUntil`, `leaseOwner`) and a crashed worker's lease simply
 * expires. See docs/adr/0012.
 */
const OUTBOX_KIND = Object.freeze({
  // A notification to a signed-in user, fanned out over their channels.
  NOTIFICATION: 'notification',
  // An SMS to a customer, who has no account. `payload` holds the phone and the
  // exact text the owner previewed. See docs/adr/0013.
  CUSTOMER_SMS: 'customer_sms',
});

const outboxMessageSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: values(OUTBOX_KIND), default: OUTBOX_KIND.NOTIFICATION },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required() {
        return this.kind !== OUTBOX_KIND.CUSTOMER_SMS;
      },
    },
    eventType: { type: String, enum: values(EVENT_TYPE), required: true },
    channels: {
      type: [channelStateSchema],
      set: (list) => (Array.isArray(list) ? list.map(toChannelState) : list),
    },
    payload: { type: mongoose.Schema.Types.Mixed },

    status: { type: String, enum: values(OUTBOX_STATUS), default: OUTBOX_STATUS.PENDING },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: { type: Date, default: null },
    leaseOwner: { type: String, default: null },
    sentAt: { type: Date, default: null },
    deadAt: { type: Date, default: null },
    lastError: { type: String },
  },
  { timestamps: true }
);

outboxMessageSchema.index({ status: 1, nextAttemptAt: 1 });
outboxMessageSchema.index({ status: 1, deadAt: 1 });

const OutboxMessage = mongoose.model('OutboxMessage', outboxMessageSchema);

module.exports = OutboxMessage;
module.exports.OUTBOX_STATUS = OUTBOX_STATUS;
module.exports.OUTBOX_KIND = OUTBOX_KIND;
module.exports.CHANNEL_STATUS = CHANNEL_STATUS;
module.exports.toChannelState = toChannelState;
