'use strict';

const { EVENT_TYPE, ROLES } = require('./constants');

/**
 * Which events each role can tune, grouped the way the preferences screen shows
 * them, and what each defaults to.
 *
 * In-app is not listed: it is always written and is the source of truth, so it
 * is not a preference. Every other channel is best effort and the user's call.
 */

const GROUPS = Object.freeze({
  [ROLES.RESELLER]: [
    {
      key: 'orders',
      events: [
        EVENT_TYPE.ORDER_PENDING,
        EVENT_TYPE.ORDER_ACCEPTED,
        EVENT_TYPE.ORDER_SHIPPED,
        EVENT_TYPE.ORDER_DELIVERED,
        EVENT_TYPE.ORDER_CANCELLED,
        EVENT_TYPE.ORDER_RETURNED,
        EVENT_TYPE.ORDER_CUSTOMER_EDITED,
      ],
    },
    {
      key: 'wallet',
      events: [
        EVENT_TYPE.DEPOSIT_APPROVED,
        EVENT_TYPE.DEPOSIT_REJECTED,
        EVENT_TYPE.WITHDRAWAL_APPROVED,
        EVENT_TYPE.WITHDRAWAL_REJECTED,
      ],
    },
    { key: 'kyc', events: [EVENT_TYPE.KYC_APPROVED, EVENT_TYPE.KYC_REJECTED] },
    {
      key: 'alerts',
      events: [
        EVENT_TYPE.BALANCE_NEAR_LIMIT,
        EVENT_TYPE.RESELLER_DEACTIVATED,
        EVENT_TYPE.RESELLER_REACTIVATED,
      ],
    },
  ],
  [ROLES.OWNER]: [
    { key: 'orders', events: [EVENT_TYPE.ORDER_CONFIRMED, EVENT_TYPE.ORDER_CUSTOMER_EDITED] },
    {
      key: 'alerts',
      events: [
        EVENT_TYPE.ALERT_LEDGER_DRIFT,
        EVENT_TYPE.ALERT_DAILY_DIGEST,
        EVENT_TYPE.ALERT_NEW_DEVICE,
      ],
    },
  ],
});

const CHANNELS = Object.freeze(['push', 'telegram', 'sms']);

/**
 * Money events are worth paying for; everything else stays free unless the
 * reseller turns it on. The owner's SMS is the business's own money and starts
 * off everywhere.
 */
const RESELLER_SMS_DEFAULT = new Set([
  EVENT_TYPE.DEPOSIT_APPROVED,
  EVENT_TYPE.DEPOSIT_REJECTED,
  EVENT_TYPE.WITHDRAWAL_APPROVED,
  EVENT_TYPE.ORDER_CANCELLED,
  EVENT_TYPE.BALANCE_NEAR_LIMIT,
]);

/**
 * Channels that cannot be switched off for an event. A sign-in from a new device
 * is a security alert: the login flow sends it by Telegram and SMS itself,
 * whatever the preferences say (docs/adr/0014), so showing a switch for those
 * would be a switch that does nothing.
 */
const LOCKED = Object.freeze({
  [EVENT_TYPE.ALERT_NEW_DEVICE]: ['telegram', 'sms'],
});

const eventsFor = (role) => (GROUPS[role] || []).flatMap((group) => group.events);

function defaultsFor(role, eventType) {
  return {
    push: true,
    telegram: true,
    sms: role === ROLES.RESELLER ? RESELLER_SMS_DEFAULT.has(eventType) : false,
  };
}

const lockedFor = (eventType) => LOCKED[eventType] || [];

module.exports = { GROUPS, CHANNELS, LOCKED, eventsFor, defaultsFor, lockedFor, RESELLER_SMS_DEFAULT };
