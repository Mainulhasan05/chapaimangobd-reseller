'use strict';

const mongoose = require('mongoose');
const { EVENT_TYPE, SMS_STATUS, SMS_BLOCK_REASON, SMS_PURPOSE, values } = require('../domain/constants');

/**
 * One row per SMS this platform attempted. Written by services/sms.js and by
 * nothing else, which is the whole point: the gateway is unreachable except
 * through a code path that ends here, so "was this message sent" is a question
 * the database can answer rather than one that depends on a log file.
 *
 * A row is written for an attempt that never left the building too. A message
 * suppressed because the owner turned SMS off is a fact worth keeping: it is the
 * difference between the switch working and the gateway being broken, and
 * without the row both look identical from the panel.
 *
 * The provider response is stored raw as well as parsed. Automas has returned
 * HTML error pages, a bare string and a JSON array under the same field over the
 * life of this integration, so the parsed copy is a convenience and the raw text
 * is the evidence.
 */
const smsLogSchema = new mongoose.Schema(
  {
    /* ------------------------------------------------------------ message -- */

    /*
     * Stored E.164, as every phone number in this system is.
     *
     * Neither this nor the text is required, and both were. A message blocked
     * because there was no number to send to, or nothing to say, is exactly the
     * row worth keeping, and requiring the missing field meant the only rows
     * that could not be written were the ones explaining why nothing was sent.
     */
    toPhoneE164: { type: String, default: null, index: true },
    /** Exactly what was handed to the gateway, which wants the local form. */
    toLocal: { type: String },
    senderId: { type: String },
    text: { type: String, default: '' },

    /*
     * Bengali is Unicode, which caps a segment at 70 characters against 160, so
     * the same sentence costs twice as much in Bengali as in Latin script. Both
     * are stored because the cost of a template is the reason to rewrite it.
     */
    encoding: { type: String, enum: ['gsm', 'unicode'], required: true },
    segments: { type: Number, required: true, min: 1 },

    /* ------------------------------------------------------------- origin -- */

    purpose: { type: String, enum: values(SMS_PURPOSE), required: true, index: true },
    /** Absent for a test or a hand-typed message, which belong to no event. */
    eventType: { type: String, enum: values(EVENT_TYPE), default: null },

    /** Who was meant to receive it. Null when the owner typed a raw number. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /** Whose credits paid, and whose action set it off. Null for owner sends. */
    reseller: { type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile', default: null },
    /** Denormalised so a log row still reads after a shop is renamed. */
    resellerName: { type: String, default: null },
    /** The owner, on a test or a manual send. */
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** The queued side effect this came from, for tracing a retry back. */
    outboxMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'OutboxMessage', default: null },

    /* ------------------------------------------------------------ outcome -- */

    status: { type: String, enum: values(SMS_STATUS), required: true, index: true },
    /** Set only on a blocked row: why it never reached the gateway. */
    blockedReason: { type: String, enum: values(SMS_BLOCK_REASON), default: null },

    /** The gateway's own id for the message, which is what support asks for. */
    providerMessageId: { type: String, default: null },
    /** Automas status code. 0 is success; see channels/sms.js. */
    providerStatusCode: { type: Number, default: null },
    providerHttpStatus: { type: Number, default: null },
    /** The parsed body, whatever shape it arrived in. */
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    /** The bytes, truncated. The evidence when the parsed copy is not enough. */
    providerRaw: { type: String, default: null },

    /*
     * The gateway's own words, in English, kept as it said them. The panel puts
     * a Bengali outcome on every row; this is the diagnostic underneath it, read
     * only by the owner and only when something did not arrive, and translating
     * it would put a layer between them and what the gateway actually said.
     */
    error: { type: String, default: null },
    /** False when resending the same text can never work, e.g. a bad API key. */
    retryable: { type: Boolean, default: null },

    /* --------------------------------------------------------------- cost -- */

    creditsCharged: { type: Number, default: 0 },
    creditsRefunded: { type: Number, default: 0 },

    /** Round trip to the gateway. A slow gateway shows up here before anywhere else. */
    durationMs: { type: Number, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/*
 * The panel opens on "everything, newest first" and filters down from there, so
 * the sort key leads every index and the filters are the second column.
 */
smsLogSchema.index({ createdAt: -1 });
smsLogSchema.index({ status: 1, createdAt: -1 });
smsLogSchema.index({ reseller: 1, createdAt: -1 });
smsLogSchema.index({ purpose: 1, createdAt: -1 });

module.exports = mongoose.model('SmsLog', smsLogSchema);
