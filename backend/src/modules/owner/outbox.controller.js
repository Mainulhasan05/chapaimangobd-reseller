'use strict';

const OutboxMessage = require('../../models/OutboxMessage');
const outbox = require('../../services/outbox');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { notFound, conflict } = require('../../utils/errors');

const { OUTBOX_STATUS, OUTBOX_KIND } = OutboxMessage;

/**
 * Failed deliveries: the outbox messages that gave up.
 *
 * The dashboard has counted these for a long time ("notification failed: 3")
 * and the morning digest repeats the number, but there was nowhere to see which
 * three, so the count was a worry with no action attached. This is the action:
 * who it was for, what it said, why each channel failed, and a retry or a
 * dismiss. The in-app copy of a notification was always written (it is the
 * source of truth), so a failure here is a push, a Telegram message or an SMS
 * that did not arrive, never a notification that does not exist.
 */

/**
 * Who it was for. A customer SMS has no account behind it, only the number it
 * was going to; a notification names the account, or null if that account no
 * longer exists.
 */
function recipientOf(m) {
  if (m.kind === OUTBOX_KIND.CUSTOMER_SMS) {
    return { type: 'customer', id: null, name: null, phone: (m.payload || {}).phoneE164 || null };
  }
  if (!m.user || !m.user._id) return null;
  return {
    type: m.user.role,
    id: m.user._id,
    name: m.user.name || null,
    phone: m.user.phoneE164 || null,
  };
}

const present = (m) => {
  const payload = m.payload || {};
  const isCustomer = m.kind === OUTBOX_KIND.CUSTOMER_SMS;
  return {
    id: m._id,
    kind: m.kind || OUTBOX_KIND.NOTIFICATION,
    eventType: m.eventType,
    status: m.status,
    recipient: recipientOf(m),
    title: isCustomer ? null : payload.title || null,
    body: isCustomer ? payload.text || null : payload.body || null,
    // Where the original message pointed, for the row to link to.
    url: (payload.data && payload.data.url) || null,
    orderId: payload.orderId || (payload.data && payload.data.orderId) || null,
    channels: (m.channels || []).map((c) => ({
      name: c.name,
      status: c.status,
      attempts: c.attempts || 0,
      lastError: c.lastError || null,
    })),
    attempts: m.attempts || 0,
    lastError: m.lastError || null,
    deadAt: m.deadAt || null,
    createdAt: m.createdAt,
  };
};

/** GET /owner/outbox/failed — newest failure first, a page at a time. */
async function listFailed(req, res) {
  const { page, limit } = req.query;
  const filter = { status: OUTBOX_STATUS.DEAD };

  const [rows, total] = await Promise.all([
    OutboxMessage.find(filter)
      .sort({ deadAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name role phoneE164'),
    OutboxMessage.countDocuments(filter),
  ]);

  return ok(res, { messages: rows.map(present), page, limit, total });
}

/** Refuses an id that is not a dead letter, saying which of the two it is. */
async function notDead(id) {
  const exists = await OutboxMessage.exists({ _id: id });
  if (!exists) return notFound('Message not found');
  return conflict('NOT_FAILED', 'This message is no longer waiting as a failed delivery');
}

/**
 * Sends it again. Channels that already went out are not repeated. The worker
 * picks it up on its next tick, so the answer is "queued", not "delivered".
 */
async function retry(req, res) {
  const message = await outbox.retryDead(req.params.id);
  if (!message) throw await notDead(req.params.id);

  await audit.record({
    actor: req.user._id,
    action: 'outbox.retry',
    targetType: 'OutboxMessage',
    targetId: message._id,
    before: { status: OUTBOX_STATUS.DEAD },
    after: { status: message.status, channels: message.channels.map((c) => c.name) },
    ip: req.ip,
  });

  await message.populate('user', 'name role phoneE164');
  return ok(res, { message: present(message) });
}

/** Lets it go. Kept on record, no longer counted as a fault. */
async function dismiss(req, res) {
  const message = await outbox.dismissDead(req.params.id, { by: req.user._id });
  if (!message) throw await notDead(req.params.id);

  await audit.record({
    actor: req.user._id,
    action: 'outbox.dismiss',
    targetType: 'OutboxMessage',
    targetId: message._id,
    before: { status: OUTBOX_STATUS.DEAD },
    after: { status: message.status },
    ip: req.ip,
  });

  await message.populate('user', 'name role phoneE164');
  return ok(res, { message: present(message) });
}

module.exports = { listFailed, retry, dismiss };
