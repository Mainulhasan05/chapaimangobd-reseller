'use strict';

const crypto = require('node:crypto');
const env = require('../config/env');
const { logger } = require('../config/logger');
const TelegramLink = require('../models/TelegramLink');
const { getClient } = require('../services/telegramClient');

/**
 * The free channel that actually arrives. No battery saver kills it, no credits
 * are consumed, and Bengali text costs nothing extra.
 *
 * Linking uses a single-use token carried in a bot deep link, so a chat id cannot
 * be claimed by guessing a user id. The bot that redeems it is services/telegramBot.js.
 */

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 15000;

const isConfigured = () => env.telegramConfigured;

const api = (method) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/* ---------------------------------------------------------- bot username -- */

let cachedUsername = null;

/**
 * The bot's @name, for the deep link. From env when set, otherwise asked of
 * Telegram once and remembered for the life of the process.
 */
async function botUsername() {
  if (env.TELEGRAM_BOT_USERNAME) return env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
  if (cachedUsername || !isConfigured()) return cachedUsername;

  try {
    const client = getClient();
    let me;
    if (client) {
      me = await client.getMe();
    } else {
      const response = await fetch(api('getMe'), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const payload = await response.json();
      me = payload && payload.ok ? payload.result : null;
    }
    cachedUsername = me && me.username ? me.username : null;
  } catch (err) {
    logger.warn({ err }, 'telegram: could not read the bot username');
  }
  return cachedUsername;
}

const clearUsernameCache = () => {
  cachedUsername = null;
};

/* ----------------------------------------------------------------- links -- */

/**
 * Issues a fresh one-time token for this user and returns the deep link that
 * carries it. Any earlier unredeemed token for the user stops working.
 */
async function createLinkToken(userId) {
  const linkToken = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

  await TelegramLink.findOneAndUpdate(
    { user: userId },
    { $set: { linkTokenHash: hashToken(linkToken), linkTokenExpiresAt: expiresAt } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const username = await botUsername();
  return {
    linkToken,
    expiresAt,
    botUsername: username,
    deepLink: username ? `https://t.me/${username}?start=${linkToken}` : null,
  };
}

/**
 * Redeems a token for a chat, when the bot receives `/start <token>`.
 *
 * The claim is one atomic update that also clears the token, so a token cannot
 * be redeemed twice even by two messages racing.
 */
async function completeLink({ linkToken, chatId }) {
  if (!linkToken) return { ok: false, reason: 'unknown' };
  const linkTokenHash = hashToken(linkToken);
  const now = new Date();

  const claimed = await TelegramLink.findOneAndUpdate(
    { linkTokenHash, linkTokenExpiresAt: { $gt: now } },
    {
      $set: {
        chatId: String(chatId),
        linkedAt: now,
        linkTokenHash: null,
        linkTokenExpiresAt: null,
      },
    },
    { new: true }
  );
  if (claimed) return { ok: true, user: claimed.user };

  // Told apart only for the reply: an expired link deserves "make a new one".
  const stale = await TelegramLink.exists({ linkTokenHash });
  return { ok: false, reason: stale ? 'expired' : 'unknown' };
}

/** Detaches every account linked to this chat, for `/stop`. */
async function unlinkChat(chatId) {
  const result = await TelegramLink.updateMany(
    { chatId: String(chatId) },
    { $set: { chatId: null, linkedAt: null } }
  );
  return result.modifiedCount || 0;
}

/** Detaches this user's chat, from the notifications screen. */
async function unlinkUser(userId) {
  const result = await TelegramLink.updateOne(
    { user: userId },
    { $set: { chatId: null, linkedAt: null, linkTokenHash: null, linkTokenExpiresAt: null } }
  );
  return result.modifiedCount > 0;
}

async function status(userId) {
  const link = await TelegramLink.findOne({ user: userId }).lean();
  const linked = Boolean(link && link.chatId);
  return {
    configured: isConfigured(),
    linked,
    linkedAt: linked ? link.linkedAt : null,
    botUsername: isConfigured() ? await botUsername() : null,
  };
}

/* ------------------------------------------------------------------ send -- */

const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * HTML rather than Markdown: an underscore or asterisk in a shop name or a
 * reason broke Markdown parsing, and Telegram answers a parse error with a 400
 * that the outbox then retried five times.
 */
const formatMessage = (title, body) =>
  body ? `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}` : `<b>${escapeHtml(title)}</b>`;

/** True for Telegram's "the user blocked the bot" or "deleted the chat". */
const isGone = (statusCode, description = '') =>
  statusCode === 403 || (statusCode === 400 && /chat not found/i.test(description));

async function sendViaHttp(chatId, text) {
  const response = await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.ok) return { ok: true };
  const detail = await response.text();
  return { ok: false, statusCode: response.status, description: detail };
}

async function sendViaClient(client, chatId, text) {
  try {
    await client.sendMessage(chatId, text, { parse_mode: 'HTML' });
    return { ok: true };
  } catch (err) {
    // The client reports an API refusal as ETELEGRAM with the reply attached.
    const response = err && err.response;
    if (response && response.statusCode) {
      const description = (response.body && response.body.description) || err.message;
      return { ok: false, statusCode: response.statusCode, description };
    }
    throw err;
  }
}

async function send({ userId, title, body }) {
  if (!isConfigured()) return { sent: 0 };

  const link = await TelegramLink.findOne({ user: userId, chatId: { $ne: null } });
  if (!link) return { sent: 0 };

  const text = formatMessage(title, body);
  const client = getClient();
  const result = client
    ? await sendViaClient(client, link.chatId, text)
    : await sendViaHttp(link.chatId, text);

  if (result.ok) return { sent: 1 };

  // The person blocked the bot or deleted the chat. The link is dead for good;
  // keeping it would fail every message they are ever sent.
  if (isGone(result.statusCode, result.description)) {
    await TelegramLink.deleteOne({ _id: link._id });
    return { sent: 0, unlinked: true };
  }

  throw new Error(`Telegram returned ${result.statusCode}: ${String(result.description).slice(0, 300)}`);
}

module.exports = {
  LINK_TOKEN_TTL_MS,
  isConfigured,
  hashToken,
  botUsername,
  clearUsernameCache,
  createLinkToken,
  completeLink,
  unlinkChat,
  unlinkUser,
  status,
  send,
  formatMessage,
};
