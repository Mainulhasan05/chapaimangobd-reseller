'use strict';

const webpush = require('web-push');
const env = require('../config/env');
const PushSubscription = require('../models/PushSubscription');

/**
 * Best effort by design. Xiaomi, Realme, Oppo and Vivo dominate the Bangladeshi
 * market and their battery savers kill the Chrome background process, so a push
 * may arrive hours late or never. On iOS this works only from a home screen
 * install. Nothing in a business flow may depend on delivery.
 */

let configured = false;

function configure() {
  if (configured || !env.webPushConfigured) return configured;
  // Regenerating VAPID keys silently invalidates every existing subscription,
  // which is why they are persisted in env rather than generated at boot.
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
  return configured;
}

const isConfigured = () => env.webPushConfigured;

/** Sends to every device the user has registered. Prunes dead endpoints. */
async function send({ userId, title, body, data }) {
  if (!configure()) return { sent: 0, pruned: 0 };

  const subscriptions = await PushSubscription.find({ user: userId });
  if (subscriptions.length === 0) return { sent: 0, pruned: 0 };

  const payload = JSON.stringify({ title, body, data });
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
          // The outbox holds a lease per message; a push service that never
          // answers must not outlive it.
          { timeout: 10000 }
        );
        sent += 1;
      } catch (err) {
        // 404 and 410 mean the subscription is gone for good. Leaving dead
        // endpoints in place degrades send latency for everyone else.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
          pruned += 1;
        } else {
          throw err;
        }
      }
    })
  );

  return { sent, pruned };
}

const publicKey = () => env.VAPID_PUBLIC_KEY || null;

module.exports = { isConfigured, send, publicKey };
