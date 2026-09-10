'use strict';

const mongoose = require('mongoose');

/** Where products are collected from. Archived, never deleted, once orders reference it. */
const sourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    address: { type: String, trim: true, maxlength: 500 },
    phoneE164: { type: String },
    note: { type: String, maxlength: 1000 },
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Source', sourceSchema);
