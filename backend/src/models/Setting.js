'use strict';

const mongoose = require('mongoose');
const { isSafeMoney } = require('../utils/money');
const publicImageSchema = require('./publicImage');
const { DEFAULT_TEMPLATES } = require('../domain/customerSms');

/** Singleton. Loaded once at boot and cached; see services/settings.js. */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },

    businessName: { type: String, default: 'ChapaiMango' },
    supportPhoneE164: { type: String },
    poweredByText: { type: String, default: 'Powered by ChapaiMango' },

    /*
     * The brand mark, shown on every public shop and on the tracking page, to
     * visitors who are not logged in. Hosted rather than stored, for the same
     * reason product photographs are. `brandLogoUrl` is what readers render.
     */
    brandLogoUrl: { type: String },
    brandLogo: { type: publicImageSchema, default: null },

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

    /*
     * What a customer is told on the owner's accept, ship and cancel, when the
     * owner ticks the box. GSM-7 only, validated in the settings controller;
     * rendered by domain/customerSms.js. See docs/adr/0013.
     */
    customerSmsTemplates: {
      accept: { type: String, default: DEFAULT_TEMPLATES.accept },
      ship: { type: String, default: DEFAULT_TEMPLATES.ship },
      cancel: { type: String, default: DEFAULT_TEMPLATES.cancel },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Setting', settingSchema);
