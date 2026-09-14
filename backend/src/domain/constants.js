'use strict';

const ROLES = Object.freeze({ OWNER: 'owner', RESELLER: 'reseller' });

const KYC_STATUS = Object.freeze({
  NOT_SUBMITTED: 'not_submitted',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const PAYMENT_MODE = Object.freeze({ PREPAID: 'prepaid', COD: 'cod' });

const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  ACCEPTED: 'accepted',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURNED: 'returned',
});

const ORDER_ORIGIN = Object.freeze({ FORM: 'form', MANUAL: 'manual' });

/**
 * Ledger entry kinds. Adding one is a schema decision, not a convenience:
 * the ledger is append-only, so a kind that turns out to be wrong cannot be
 * edited away. See docs/adr/0002.
 */
const LEDGER_KIND = Object.freeze({
  ORDER_COST_DEBIT: 'ORDER_COST_DEBIT',
  DELIVERY_DEBIT: 'DELIVERY_DEBIT',
  // The owner changed the delivery charge after it was debited. Either sign:
  // negative for a raise, positive for a cut. See docs/adr/0010.
  DELIVERY_ADJUSTMENT: 'DELIVERY_ADJUSTMENT',
  COD_COLLECTION_CREDIT: 'COD_COLLECTION_CREDIT',
  DEPOSIT_CREDIT: 'DEPOSIT_CREDIT',
  WITHDRAWAL_DEBIT: 'WITHDRAWAL_DEBIT',
  SMS_PURCHASE_DEBIT: 'SMS_PURCHASE_DEBIT',
  MANUAL_CREDIT: 'MANUAL_CREDIT',
  MANUAL_DEBIT: 'MANUAL_DEBIT',
  REVERSAL: 'REVERSAL',
});

const REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const DEPOSIT_METHOD = Object.freeze({
  BKASH: 'bkash',
  NAGAD: 'nagad',
  ROCKET: 'rocket',
  BANK: 'bank',
  CASH: 'cash',
});

const KYC_DOC_TYPE = Object.freeze({
  NID_FRONT: 'nid_front',
  NID_BACK: 'nid_back',
  SELFIE: 'selfie',
  TRADE_LICENSE: 'trade_license',
});

const NOTIFICATION_CHANNEL = Object.freeze({
  IN_APP: 'in_app',
  WEB_PUSH: 'web_push',
  TELEGRAM: 'telegram',
  SMS: 'sms',
});

/**
 * What became of one SMS. Every attempt ends on exactly one of these, including
 * the ones that never reached the gateway: a suppressed message is a fact the
 * owner needs, not an absence of one.
 */
const SMS_STATUS = Object.freeze({
  SENT: 'sent',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

/** Why a message was never handed to the gateway. */
const SMS_BLOCK_REASON = Object.freeze({
  FEATURE_OFF: 'feature_off',
  NOT_CONFIGURED: 'not_configured',
  NO_CREDITS: 'no_credits',
  NO_RECIPIENT: 'no_recipient',
  EMPTY_TEXT: 'empty_text',
});

/** What the message was for, which decides who pays for it. */
const SMS_PURPOSE = Object.freeze({
  // A notification fanned out of the outbox. Charged to the reseller receiving it.
  NOTIFICATION: 'notification',
  // The owner proving the gateway works. Charged to nobody.
  TEST: 'test',
  // The owner typing a message by hand. Charged to nobody.
  MANUAL: 'manual',
  // A one-time code for sign-in, registration or a phone change. Owner-paid,
  // not gated by the master switch. See docs/adr/0013.
  OTP: 'otp',
  // A security alert to the owner, such as a sign-in from a new device. Owner-paid.
  OWNER_ALERT: 'owner_alert',
  // The owner's optional message to a customer on accept, ship or cancel.
  // Owner-paid, not gated by the master switch. See docs/adr/0013.
  CUSTOMER: 'customer',
});

const EVENT_TYPE = Object.freeze({
  ORDER_PENDING: 'order.pending',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_ACCEPTED: 'order.accepted',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_RETURNED: 'order.returned',
  KYC_APPROVED: 'kyc.approved',
  KYC_REJECTED: 'kyc.rejected',
  DEPOSIT_APPROVED: 'deposit.approved',
  DEPOSIT_REJECTED: 'deposit.rejected',
  WITHDRAWAL_APPROVED: 'withdrawal.approved',
  WITHDRAWAL_REJECTED: 'withdrawal.rejected',
  BALANCE_NEAR_LIMIT: 'balance.near_limit',
  // Owner alerts from the scheduled jobs (src/jobs). Phase C.
  ALERT_LEDGER_DRIFT: 'alert.ledger_drift',
  ALERT_DAILY_DIGEST: 'alert.daily_digest',
  // The owner signed in from a device not trusted before. Phase D, docs/adr/0014.
  ALERT_NEW_DEVICE: 'alert.new_device',
  // Phase E. The other party changed an order's delivery name, phone or address.
  ORDER_CUSTOMER_EDITED: 'order.customer_edited',
  // Phase E. The owner switched a reseller account off or back on. docs/adr/0011.
  RESELLER_DEACTIVATED: 'reseller.deactivated',
  RESELLER_REACTIVATED: 'reseller.reactivated',
});

/**
 * Who pays for an SMS, which decides which switch governs it (docs/adr/0013).
 * Owner-paid messages ignore `features.sms` and reseller credits; reseller-paid
 * messages need both.
 */
const SMS_PAYER = Object.freeze({ OWNER: 'owner', RESELLER: 'reseller' });

/** What an SMS was, for the log. Coarser than the event type, finer than the payer. */
const SMS_CATEGORY = Object.freeze({
  OTP: 'otp',
  OWNER_ALERT: 'owner_alert',
  NOTIFICATION: 'notification',
  TEST: 'test',
  MANUAL: 'manual',
  CUSTOMER: 'customer',
});

/** What a one-time code proves. A code issued for one purpose never verifies another. */
const OTP_PURPOSE = Object.freeze({
  REGISTER: 'register',
  RESET_PASSWORD: 'reset_password',
  CHANGE_PHONE: 'change_phone',
  OWNER_DEVICE: 'owner_device',
});

/**
 * The actor behind a change nobody clicked, such as the pending orders a
 * deactivation cancels. Deliberately not a member of ROLES: no account can hold
 * it, and the transition table keys on it only for what the system may do.
 */
const SYSTEM_ACTOR = 'system';

/** Why a shop is not taking orders. See docs/adr/0011 and domain/shop.js. */
const SHOP_CLOSED_REASON = Object.freeze({
  // The owner deactivated the reseller.
  INACTIVE: 'inactive',
  // KYC is not approved yet.
  KYC: 'kyc',
  // The reseller switched their form off.
  CLOSED: 'closed',
});

/** Written as the cancel reason on every pending order a deactivation cancels. */
const RESELLER_DEACTIVATED_REASON = 'reseller_deactivated';

const values = (o) => Object.values(o);

module.exports = {
  ROLES,
  KYC_STATUS,
  PAYMENT_MODE,
  ORDER_STATUS,
  ORDER_ORIGIN,
  LEDGER_KIND,
  REVIEW_STATUS,
  DEPOSIT_METHOD,
  KYC_DOC_TYPE,
  NOTIFICATION_CHANNEL,
  EVENT_TYPE,
  SMS_STATUS,
  SMS_BLOCK_REASON,
  SMS_PURPOSE,
  SMS_PAYER,
  SMS_CATEGORY,
  OTP_PURPOSE,
  SYSTEM_ACTOR,
  SHOP_CLOSED_REASON,
  RESELLER_DEACTIVATED_REASON,
  values,
};
