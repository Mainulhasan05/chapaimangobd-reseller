'use strict';

const mongoose = require('mongoose');

/**
 * The free channel that actually arrives. Linked through a bot deep link carrying
 * a single-use token, so a chat id cannot be claimed by guessing.
 */
const telegramLinkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    chatId: { type: String, index: true },
    linkToken: { type: String, index: true },
    linkTokenExpiresAt: { type: Date },
    linkedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TelegramLink', telegramLinkSchema);
