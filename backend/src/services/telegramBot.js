'use strict';

const crypto = require('node:crypto');

const env = require('../config/env');
const { logger } = require('../config/logger');
const telegram = require('../channels/telegram');
const { setClient, getClient, createHttpClient } = require('./telegramClient');
const lock = require('../jobs/lock');

/**
 * The Telegram bot: redeems link tokens and lets a chat unlink itself.
 *
 * Off unless TELEGRAM_BOT_TOKEN is set. Two ways to receive updates
 * (PLAN-2 decision 17):
 *
 * - Polling, the default. Telegram hands each update to exactly one poller and
 *   answers a second concurrent poller with a 409, so only one process may poll.
 *   That process is one started with RUN_JOBS=true that also holds a MongoDB
 *   lease (jobs/lock.js), renewed while it polls; if it dies the lease lapses
 *   and another RUN_JOBS instance takes over within a minute.
 * - Webhook, when TELEGRAM_WEBHOOK_URL is set. Every instance can serve
 *   POST /api/telegram/webhook/:secret, so no lease is needed.
 *
 * Every process that has a token gets a client for sending, whichever mode.
 */

const LEASE_NAME = 'telegramPolling';
const LEASE_TTL_MS = 60 * 1000;
const LEASE_CHECK_MS = 20 * 1000;

/** Replies, in Bengali, because every person talking to this bot reads Bengali. */
const REPLY = Object.freeze({
  linked:
    'টেলিগ্রাম যুক্ত হয়েছে। এখন থেকে চাঁপাই ম্যাঙ্গোর নোটিফিকেশন এখানে পাবেন। বন্ধ করতে /stop লিখুন।',
  expired:
    'লিংকটির মেয়াদ শেষ হয়ে গেছে। অ্যাপের নোটিফিকেশন পাতা থেকে নতুন লিংক তৈরি করে আবার চেষ্টা করুন।',
  invalid:
    'লিংকটি সঠিক নয় বা আগেই ব্যবহার করা হয়েছে। অ্যাপের নোটিফিকেশন পাতা থেকে নতুন লিংক তৈরি করুন।',
  stopped: 'টেলিগ্রাম সংযোগ বন্ধ করা হয়েছে। এখানে আর কোনো নোটিফিকেশন আসবে না।',
  notLinked: 'এই চ্যাটের সাথে কোনো অ্যাকাউন্ট যুক্ত নেই।',
  help:
    'চাঁপাই ম্যাঙ্গো নোটিফিকেশন বট।\nযুক্ত করতে অ্যাপের "নোটিফিকেশন" পাতায় "টেলিগ্রাম যুক্ত করুন" চাপুন।\nবন্ধ করতে /stop লিখুন।',
});

const START_RE = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/;
const STOP_RE = /^\/stop(?:@\w+)?\s*$/;

/**
 * Handles one incoming message and replies. Returns what it did, for tests.
 * `client` is anything with `sendMessage(chatId, text)`.
 */
async function handleMessage(message, client = getClient()) {
  if (!message || !message.chat) return { action: 'ignored' };
  const chatId = message.chat.id;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const reply = async (body) => {
    if (client) await client.sendMessage(chatId, body);
  };

  const start = text.match(START_RE);
  if (start) {
    const token = start[1];
    // A link is to a person, so it is redeemed only from a private chat: a
    // token pasted into a group would send one account's alerts to everyone.
    if (!token || message.chat.type !== 'private') {
      await reply(REPLY.help);
      return { action: 'help' };
    }
    const result = await telegram.completeLink({ linkToken: token, chatId });
    if (result.ok) {
      await reply(REPLY.linked);
      return { action: 'linked', user: result.user };
    }
    await reply(result.reason === 'expired' ? REPLY.expired : REPLY.invalid);
    return { action: 'rejected', reason: result.reason };
  }

  if (STOP_RE.test(text)) {
    const removed = await telegram.unlinkChat(chatId);
    await reply(removed > 0 ? REPLY.stopped : REPLY.notLinked);
    return { action: removed > 0 ? 'unlinked' : 'not_linked' };
  }

  await reply(REPLY.help);
  return { action: 'help' };
}

/** One update from Telegram, as the webhook receives it. */
function handleUpdate(update, client = getClient()) {
  const message = update && (update.message || update.edited_message);
  return handleMessage(message, client);
}

/* --------------------------------------------------------------- webhook -- */

const digest = (value) => crypto.createHash('sha256').update(String(value || '')).digest();
const sameSecret = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

/**
 * POST /api/telegram/webhook/:secret. The secret is checked twice, in the path
 * and in Telegram's X-Telegram-Bot-Api-Secret-Token header, both in constant
 * time. A forged update could otherwise redeem a token someone else issued.
 */
async function webhookHandler(req, res) {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!env.telegramWebhook || !expected) return res.status(404).json({ ok: false });

  const pathOk = sameSecret(req.params.secret, expected);
  const headerOk = sameSecret(req.get('x-telegram-bot-api-secret-token'), expected);
  if (!pathOk || !headerOk) return res.status(401).json({ ok: false });

  try {
    await handleUpdate(req.body);
  } catch (err) {
    // Answered 200 anyway: a non-200 makes Telegram redeliver the same update
    // for hours, and a failed reply is not fixed by trying it again.
    logger.error({ err }, 'telegram: webhook update failed');
  }
  return res.status(200).json({ ok: true });
}

/* -------------------------------------------------------------- lifecycle -- */

let leaseTimer = null;
let leaseOwner = null;
let polling = false;
let mode = 'off';

/** The fetch-based Bot API client; see services/telegramClient.js. */
const createClient = () => createHttpClient(env.TELEGRAM_BOT_TOKEN);

async function stopPolling(client) {
  if (!polling) return;
  polling = false;
  try {
    await client.stopPolling({ cancel: true });
  } catch (err) {
    logger.warn({ err }, 'telegram: stopping the poller failed');
  }
}

/** Takes the lease if free, renews it if held, and starts or stops polling to match. */
async function checkLease(client) {
  try {
    if (leaseOwner) {
      const kept = await lock.renew(LEASE_NAME, leaseOwner, { ttlMs: LEASE_TTL_MS });
      if (kept) return;
      logger.warn('telegram: polling lease lost, stopping the poller');
      leaseOwner = null;
      await stopPolling(client);
      return;
    }

    leaseOwner = await lock.acquire(LEASE_NAME, { ttlMs: LEASE_TTL_MS });
    if (!leaseOwner) return;

    // Polling is refused while a webhook is registered, e.g. left from an
    // earlier deployment that used one.
    await client.deleteWebHook().catch(() => {});
    await client.startPolling({ restart: true });
    polling = true;
    logger.info('telegram: polling started');
  } catch (err) {
    logger.error({ err }, 'telegram: lease check failed');
  }
}

/**
 * Starts the bot for this process. Safe to call when unconfigured (does
 * nothing) and on every instance (only one polls). Pass `client` to use a stub.
 */
async function startTelegramBot({ client: injected } = {}) {
  if (!env.telegramConfigured) {
    mode = 'off';
    return mode;
  }

  const client = setClient(injected || getClient() || createClient());

  if (typeof client.on === 'function') {
    client.on('message', (message) => {
      handleMessage(message, client).catch((err) =>
        logger.error({ err }, 'telegram: message handling failed')
      );
    });
    client.on('polling_error', (err) => logger.warn({ err }, 'telegram: polling error'));
  }

  if (env.telegramWebhook) {
    const url = `${env.TELEGRAM_WEBHOOK_URL.replace(/\/+$/, '')}/api/telegram/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`;
    try {
      await client.setWebHook(url, { secret_token: env.TELEGRAM_WEBHOOK_SECRET });
      logger.info('telegram: webhook registered');
    } catch (err) {
      logger.error({ err }, 'telegram: webhook registration failed');
    }
    mode = 'webhook';
    return mode;
  }

  if (!env.runJobs) {
    logger.info('telegram: RUN_JOBS is not set, this process sends but does not poll');
    mode = 'send-only';
    return mode;
  }

  mode = 'polling';
  await checkLease(client);
  leaseTimer = setInterval(() => checkLease(client), LEASE_CHECK_MS);
  leaseTimer.unref();
  return mode;
}

async function stopTelegramBot() {
  if (leaseTimer) clearInterval(leaseTimer);
  leaseTimer = null;

  const client = getClient();
  if (client) await stopPolling(client);
  if (leaseOwner) {
    await lock.release(LEASE_NAME, leaseOwner).catch(() => {});
    leaseOwner = null;
  }
  setClient(null);
  mode = 'off';
}

const botMode = () => mode;

module.exports = {
  REPLY,
  LEASE_NAME,
  handleMessage,
  handleUpdate,
  webhookHandler,
  startTelegramBot,
  stopTelegramBot,
  checkLease,
  botMode,
};
