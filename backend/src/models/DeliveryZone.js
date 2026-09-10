'use strict';

const mongoose = require('mongoose');
const { isSafeMoney } = require('../utils/money');

const deliveryZoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    districts: [{ type: String, trim: true }],
    chargePoisha: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
    },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeliveryZone', deliveryZoneSchema);
