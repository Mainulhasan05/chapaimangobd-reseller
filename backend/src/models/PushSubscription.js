'use strict';

const mongoose = require('mongoose');

/** One row per device or browser. A reseller has a phone and a laptop. */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: { p256dh: String, auth: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
