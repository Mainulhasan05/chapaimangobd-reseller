'use strict';

const { EVENT_TYPE, ROLES } = require('./constants');

/**
 * Where tapping a notification should land, for the person it was sent to.
 *
 * Carried as `data.url` on the in-app row and in the web push payload, so the
 * service worker and the inbox open the same page without each guessing from
 * the event's fields. Mirrors `hrefFor` in frontend/components/notifications-view.tsx,
 * which still falls back to its own mapping for rows written before this.
 */

const WALLET_EVENTS = new Set([
  EVENT_TYPE.DEPOSIT_APPROVED,
  EVENT_TYPE.DEPOSIT_REJECTED,
  EVENT_TYPE.WITHDRAWAL_APPROVED,
  EVENT_TYPE.WITHDRAWAL_REJECTED,
  EVENT_TYPE.BALANCE_NEAR_LIMIT,
]);

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function urlFor(role, eventType, data = {}) {
  const base = role === ROLES.OWNER ? '/owner' : '/reseller';
  const orderId = data && data.orderId ? String(data.orderId) : null;

  if (orderId && OBJECT_ID.test(orderId)) return `${base}/orders/${orderId}`;

  if (role === ROLES.OWNER) {
    if (WALLET_EVENTS.has(eventType)) return '/owner/finance';
    if (eventType === EVENT_TYPE.ALERT_LEDGER_DRIFT) return '/owner/reports';
    if (eventType === EVENT_TYPE.ALERT_DAILY_DIGEST) return '/owner';
    if (eventType === EVENT_TYPE.ALERT_NEW_DEVICE) return '/owner/account';
    return '/owner/notifications';
  }

  if (WALLET_EVENTS.has(eventType)) return '/reseller/wallet';
  if (eventType === EVENT_TYPE.KYC_APPROVED || eventType === EVENT_TYPE.KYC_REJECTED) {
    return '/reseller/kyc';
  }
  if (
    eventType === EVENT_TYPE.RESELLER_DEACTIVATED ||
    eventType === EVENT_TYPE.RESELLER_REACTIVATED
  ) {
    return '/reseller';
  }
  return '/reseller/notifications';
}

module.exports = { urlFor };
