'use strict';

const ResellerProfile = require('../models/ResellerProfile');
const User = require('../models/User');
const Order = require('../models/Order');

const orderService = require('./orderService');
const customers = require('./customers');
const audit = require('./audit');
const { notify } = require('./notify');
const { withTransaction } = require('./tx');
const { notFound } = require('../utils/errors');
const { EVENT_TYPE } = require('../domain/constants');

/**
 * Switching a reseller account off and back on. See docs/adr/0011.
 *
 * Deactivating closes the shop and cancels every pending order in the same
 * transaction as the account flag, so there is no moment where the account is
 * off and a pending order is still waiting for a confirm nobody can give.
 * Confirmed-onward orders are left alone: the reseller's wallet has already
 * paid for them and the customer is expecting them. The balance is untouched.
 *
 * Reactivating restores the shop form to what it was before, and does not
 * un-cancel anything: those customers have been told their order is off.
 *
 * Both flips are guarded on the current flag, so repeating one is a no-op that
 * neither restarts the KYC retention clock (docs/adr/0016) nor writes a second
 * audit entry. Notifications and customer counters happen after commit.
 */

async function deactivate({ profileId, actorUser, ip }) {
  const now = new Date();

  const result = await withTransaction(async (session) => {
    const profile = await ResellerProfile.findById(profileId).session(session);
    if (!profile) throw notFound('Reseller not found');

    const flip = await User.updateOne(
      { _id: profile.user, isActive: true },
      { $set: { isActive: false, deactivatedAt: now } },
      { session }
    );
    const flipped = flip.modifiedCount === 1;

    if (flipped) {
      await ResellerProfile.updateOne(
        { _id: profile._id },
        { $set: { formActiveBeforeDeactivation: profile.formActive, formActive: false } },
        { session }
      );
    }

    // Swept on a repeat as well: an order that raced in just as the account
    // closed is cancelled by the second click rather than left stranded.
    const cancelled = await orderService.cancelPendingForReseller(session, profile._id, { now });

    return { profile, flipped, formActiveBefore: profile.formActive, cancelled };
  });

  const { profile, flipped, formActiveBefore, cancelled } = result;

  if (cancelled.length > 0) {
    const orders = await Order.find({ _id: { $in: cancelled.map((o) => o._id) } });
    for (const order of orders) {
      // eslint-disable-next-line no-await-in-loop
      await customers.recordOutcome(order);
    }
  }

  if (flipped || cancelled.length > 0) {
    await audit.record({
      actor: actorUser._id,
      action: 'reseller.deactivate',
      targetType: 'ResellerProfile',
      targetId: profile._id,
      before: flipped ? { isActive: true, formActive: formActiveBefore } : { isActive: false },
      after: {
        isActive: false,
        formActive: false,
        cancelledOrders: cancelled.map((o) => o.orderCode),
      },
      ip,
    });
  }

  if (flipped) {
    const user = await User.findById(profile.user);
    await notify({
      user,
      eventType: EVENT_TYPE.RESELLER_DEACTIVATED,
      data: { cancelledCount: cancelled.length },
    });
  }

  return { changed: flipped, cancelledOrders: cancelled.map((o) => o.orderCode) };
}

async function reactivate({ profileId, actorUser, ip }) {
  const result = await withTransaction(async (session) => {
    const profile = await ResellerProfile.findById(profileId).session(session);
    if (!profile) throw notFound('Reseller not found');

    const flip = await User.updateOne(
      { _id: profile.user, isActive: false },
      { $set: { isActive: true, deactivatedAt: null } },
      { session }
    );
    const flipped = flip.modifiedCount === 1;

    // An account switched off before the previous value was recorded keeps
    // whatever the form flag says now.
    const restored = profile.formActiveBeforeDeactivation ?? profile.formActive;
    if (flipped) {
      await ResellerProfile.updateOne(
        { _id: profile._id },
        { $set: { formActive: restored, formActiveBeforeDeactivation: null } },
        { session }
      );
    }

    return { profile, flipped, formActiveBefore: profile.formActive, restored };
  });

  const { profile, flipped, formActiveBefore, restored } = result;
  if (!flipped) return { changed: false };

  await audit.record({
    actor: actorUser._id,
    action: 'reseller.reactivate',
    targetType: 'ResellerProfile',
    targetId: profile._id,
    before: { isActive: false, formActive: formActiveBefore },
    after: { isActive: true, formActive: restored },
    ip,
  });

  const user = await User.findById(profile.user);
  await notify({ user, eventType: EVENT_TYPE.RESELLER_REACTIVATED, data: {} });

  return { changed: true };
}

/** One entry point for the owner's toggle. */
function setActive({ profileId, isActive, actorUser, ip }) {
  return isActive
    ? reactivate({ profileId, actorUser, ip })
    : deactivate({ profileId, actorUser, ip });
}

module.exports = { setActive, deactivate, reactivate };
