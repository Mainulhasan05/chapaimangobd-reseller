'use strict';

const EventEmitter = require('node:events');

/**
 * The one Telegram bot client in this process, when there is one.
 *
 * A registry rather than a module that builds the client, so that the channel
 * (which sends) and the bot (which receives) share a client without requiring
 * each other, and so a test can put a stub here and never touch the network.
 */

let client = null;

const getClient = () => client;

function setClient(next) {
  client = next || null;
  return client;
}

/* ------------------------------------------------------------ http client -- */

/*
 * The client itself: the handful of Bot API calls this app makes, over fetch.
 *
 * It replaced node-telegram-bot-api, which pulled in the deprecated `request`
 * library and with it form-data, tough-cookie, qs and uuid versions carrying
 * critical and moderate advisories that no non-breaking update fixes. Nothing
 * here needed more than JSON over HTTPS: send a message, read the bot's name,
 * set or delete a webhook, and long-poll getUpdates.
 *
 * The surface is the subset of the old library the app used, with the same
 * names, so the bot, the channel and the test stubs did not change: an API
 * refusal still throws `code: 'ETELEGRAM'` with `response.statusCode` and
 * `response.body.description`, and a polled message is still a 'message' event.
 */

const API_BASE = 'https://api.telegram.org';
// A slow Telegram must not outlive the outbox lease that is waiting on it.
const REQUEST_TIMEOUT_MS = 15 * 1000;
// Telegram holds a getUpdates open this long when there is nothing to hand over.
const POLL_TIMEOUT_S = 50;
// After a failed poll (network, or a 409 because another process is polling).
const RETRY_DELAY_MS = 5 * 1000;

function telegramError(statusCode, description) {
  const err = new Error(`ETELEGRAM: ${statusCode} ${description}`);
  err.code = 'ETELEGRAM';
  err.response = { statusCode, body: { ok: false, error_code: statusCode, description } };
  return err;
}

/** Resolves after `ms`, or at once when the signal aborts. */
function pause(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    return undefined;
  });
}

/**
 * @param {string} token the bot token
 * @param {object} [opts] timings and a `fetch` to use, for tests
 */
function createHttpClient(
  token,
  {
    fetchImpl = (...args) => fetch(...args),
    timeoutMs = REQUEST_TIMEOUT_MS,
    pollTimeoutS = POLL_TIMEOUT_S,
    retryDelayMs = RETRY_DELAY_MS,
  } = {}
) {
  const events = new EventEmitter();
  let offset = 0;
  let running = false;
  let controller = null;
  let loop = null;

  async function call(method, params = {}, { signal, timeout = timeoutMs } = {}) {
    const signals = [AbortSignal.timeout(timeout)];
    if (signal) signals.push(signal);

    const response = await fetchImpl(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.any(signals),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Not JSON, e.g. a proxy's error page. Reported with the status below.
    }
    if (!response.ok || !payload || payload.ok !== true) {
      throw telegramError(response.status, (payload && payload.description) || response.statusText || 'error');
    }
    return payload.result;
  }

  async function poll(signal) {
    while (running) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const updates = await call(
          'getUpdates',
          { offset, timeout: pollTimeoutS, allowed_updates: ['message'] },
          { signal, timeout: (pollTimeoutS + 10) * 1000 }
        );
        for (const update of updates || []) {
          // Acknowledged by the next getUpdates, so each update is handed over once.
          offset = update.update_id + 1;
          if (update.message) events.emit('message', update.message);
        }
      } catch (err) {
        if (!running) break;
        events.emit('polling_error', err);
        // eslint-disable-next-line no-await-in-loop
        await pause(retryDelayMs, signal);
      }
    }
  }

  const api = {
    on: (event, listener) => {
      events.on(event, listener);
      return api;
    },

    sendMessage: (chatId, text, options = {}) => call('sendMessage', { chat_id: chatId, text, ...options }),

    getMe: () => call('getMe'),

    setWebHook: (url, options = {}) => call('setWebhook', { url, ...options }),

    deleteWebHook: (options = {}) => call('deleteWebhook', options),

    isPolling: () => running,

    async startPolling({ restart = false } = {}) {
      if (running && !restart) return;
      if (running) await api.stopPolling();
      running = true;
      controller = new AbortController();
      loop = poll(controller.signal);
    },

    /** Stops polling, cancelling a getUpdates in flight, and waits for the loop to end. */
    async stopPolling() {
      if (!running) return;
      running = false;
      controller.abort();
      await loop;
      loop = null;
      controller = null;
    },
  };

  return api;
}

module.exports = { getClient, setClient, createHttpClient };
