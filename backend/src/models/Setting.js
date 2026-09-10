'use strict';

const mongoose = require('mongoose');
const { isSafeMoney } = require('../utils/money');

/** Singleton. Loaded once at boot and cached; see services/settings.js. */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },

    businessName: { type: String, default: 'ChapaiMango' },
    supportPhoneE164: { type: String },
    poweredByText: { type: String, default: 'Powered by ChapaiMango' },

    defaultCreditLimitPoisha: {
      type: Number,
      default: 0,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },
    // Confirmed orders older than this are surfaced as stale. Mangoes do not wait.
    orderAgingHours: { type: Number, default: 24, min: 1 },
    // A refused delivery still cost a courier fee, so by default it is not reversed.
    reverseDeliveryChargeOnReturn: { type: Boolean, default: false },

    features: {
      sms: { type: Boolean, default: false },
      telegram: { type: Boolean, default: true },
      webPush: { type: Boolean, default: true },
    },

    smsPricePerCreditPoisha: {
      type: Number,
      default: 50,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Setting', settingSchema);
