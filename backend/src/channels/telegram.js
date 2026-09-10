'use strict';

const crypto = require('node:crypto');
const env = require('../config/env');
const TelegramLink = require('../models/TelegramLink');

/**
 * The free channel that actually arrives. No battery saver kills it, no credits
 * are consumed, and Bengali text costs nothing extra.
 *
 * Linking uses a single-use token carried in a bot deep link, so a chat id cannot
 * be claimed by guessing a user id.
 */

const isConfigured = () => env.telegramConfigured;

const api = (method) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

/** Creates the deep link a reseller taps to connect their Telegram account. */
async function createLinkToken(userId) {
  const linkToken = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await TelegramLink.findOneAndUpdate(
    { user: userId },
    { $set: { linkToken, linkTokenExpiresAt: expiresAt } },
    { upsert: true, new: true }
  );

  const username = env.TELEGRAM_BOT_USERNAME;
  return {
    linkToken,
    expiresAt,
    deepLink: username ? `https://t.me/${username}?start=${linkToken}` : null,
  };
}

/** Completes a link when the bot receives /start with a token. */
async function completeLink({ linkToken, chatId }) {
  const link = await TelegramLink.findOne({ linkToken });
  if (!link) return { ok: false, reason: 'unknown' };
  if (!link.linkTokenExpiresAt || link.linkTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  link.chatId = String(chatId);
  link.linkedAt = new Date();
  link.linkToken = null;
  link.linkTokenExpiresAt = null;
  await link.save();

  return { ok: true, user: link.user };
}

async function send({ userId, title, body }) {
  if (!isConfigured()) return { sent: 0 };

  const link = await TelegramLink.findOne({ user: userId, chatId: { $ne: null } });
  if (!link) return { sent: 0 };

  const text = body ? `*${title}*\n${body}` : `*${title}*`;

  const response = await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: link.chatId, text, parse_mode: 'Markdown' }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const detail = await response.text();
    // The reseller blocked the bot or deleted the chat; stop trying.
    if (response.status === 403) {
      await TelegramLink.updateOne({ _id: link._id }, { $set: { chatId: null, linkedAt: null } });
      return { sent: 0, unlinked: true };
    }
    throw new Error(`Telegram returned ${response.status}: ${detail}`);
  }

  return { sent: 1 };
}

module.exports = { isConfigured, createLinkToken, completeLink, send };
