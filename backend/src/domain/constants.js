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
});

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
  values,
};
