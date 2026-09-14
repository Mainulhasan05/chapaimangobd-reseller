'use strict';

const mongoose = require('mongoose');

/**
 * The free channel that actually arrives. Linked through a bot deep link carrying
 * a single-use token, so a chat id cannot be claimed by guessing.
 *
 * Only the token's SHA-256 is stored. The token is a bearer credential for
 * "attach my Telegram to this account" for fifteen minutes, and a database read
 * must not be enough to use one.
 */
const telegramLinkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    chatId: { type: String, default: null, index: true },
    linkTokenHash: { type: String, default: null, index: true },
    linkTokenExpiresAt: { type: Date, default: null },
    linkedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TelegramLink', telegramLinkSchema);
