'use strict';

const User = require('../models/User');
const Notification = require('../models/Notification');
const { notify } = require('../services/notify');
const { ROLES } = require('../domain/constants');

/**
 * Sends one alert to every active owner account, at most once per `dayKey`.
 *
 * The in-app row is the record and doubles as the idempotency check: a job
 * re-run on the same Dhaka day, by hand or after a crash, finds it and stays
 * quiet. notify() fans the same text out to push and Telegram.
 */
async function notifyOwnersOnce({ eventType, dayKey, data }) {
  const owners = await User.find({ role: ROLES.OWNER, isActive: { $ne: false } });
  let sent = 0;

  for (const owner of owners) {
    // eslint-disable-next-line no-await-in-loop
    const already = dayKey
      ? await Notification.exists({ user: owner._id, eventType, 'data.dayKey': dayKey })
      : null;
    if (already) continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    const created = await notify({ user: owner, eventType, data: { ...data, dayKey } });
    if (created) sent += 1;
  }

  return sent;
}

module.exports = { notifyOwnersOnce };
