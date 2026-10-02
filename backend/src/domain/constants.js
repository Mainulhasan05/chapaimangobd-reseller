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
  /*
   * PLAN-4. Something is waiting on the owner: a reseller asked for money to be
   * credited or paid out, sent KYC documents, or a complaint was written down.
   * Each used to be discoverable only by opening the screen it sits on.
   */
  DEPOSIT_REQUESTED: 'deposit.requested',
  WITHDRAWAL_REQUESTED: 'withdrawal.requested',
  KYC_SUBMITTED: 'kyc.submitted',
  COMPLAINT_CREATED: 'complaint.created',
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

/**
 * What a customer said was wrong with an order. See models/Complaint.js.
 *
 * Deliberately short. A list this is picked from on a phone, in the middle of a
 * phone call, is a list somebody scrolls past if it runs to fifteen options, and
 * the note beside it is where the detail actually belongs. `LATE` and `OTHER`
 * are the two that usually name no orchard: nothing about them is the fruit.
 */
const COMPLAINT_KIND = Object.freeze({
  // The fruit was poor: unripe, overripe, tasteless.
  QUALITY: 'quality',
  // Rotten or crushed on arrival.
  DAMAGED: 'damaged',
  // Less than was paid for.
  SHORT_WEIGHT: 'short_weight',
  WRONG_ITEM: 'wrong_item',
  LATE: 'late',
  OTHER: 'other',
});

/** The kinds that are about the fruit, and so are worth counting per source. */
const SOURCE_COMPLAINT_KINDS = Object.freeze([
  COMPLAINT_KIND.QUALITY,
  COMPLAINT_KIND.DAMAGED,
  COMPLAINT_KIND.SHORT_WEIGHT,
  COMPLAINT_KIND.WRONG_ITEM,
]);

/** Written as the cancel reason on every pending order a deactivation cancels. */
const RESELLER_DEACTIVATED_REASON = 'reseller_deactivated';

/* --------------------------------------------------------------- cost side */

/**
 * What a **Supply** is, as opposed to a Product: something the business buys and
 * uses up and never sells. A crate, a roll of tape, polythene. See PLAN-3 and
 * docs/adr/0022.
 *
 * Why a supply's stock is its own kind of record rather than a number somebody
 * edits: the owner's question is never only "how many are there" but "where did
 * they go", and a field that is overwritten cannot answer the second one.
 */
const MOVEMENT_KIND = Object.freeze({
  // What was on the shelf before the system knew about it.
  OPENING: 'OPENING',
  PURCHASE: 'PURCHASE',
  // Packed into an order. The only kind nothing human types.
  CONSUMED: 'CONSUMED',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  RETURN_TO_PAYEE: 'RETURN_TO_PAYEE',
  // A recount. Either sign: the shelf is the truth and the book follows it.
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
});

/** The kinds that add to the shelf. Everything else takes from it or may do either. */
const MOVEMENT_INCREASES = Object.freeze([MOVEMENT_KIND.OPENING, MOVEMENT_KIND.PURCHASE]);

/**
 * What a **Payee** is to the business. Changes the label a reader sees and
 * nothing else: a due is a due, and the ledger underneath is identical for all
 * of them. See docs/adr/0025.
 */
const PAYEE_KIND = Object.freeze({
  SUPPLIER: 'supplier',
  LABOUR: 'labour',
  COURIER: 'courier',
  TRANSPORT: 'transport',
  LANDLORD: 'landlord',
  OTHER: 'other',
});

/**
 * Movements of what the owner owes a payee. The kind says what happened; the
 * sign on amountPoisha says which way it moved, and positive always means the
 * owner owes more. Adding one is a schema decision, not a convenience: the
 * ledger is append-only, so a kind that turns out wrong cannot be edited away.
 */
const PAYEE_LEDGER_KIND = Object.freeze({
  // Goods received. Increases the due.
  PURCHASE: 'PURCHASE',
  // An unpaid expense billed by this payee, such as a month of courier bills.
  EXPENSE: 'EXPENSE',
  // The owner paid them. Reduces the due, and past zero becomes an advance.
  PAYMENT: 'PAYMENT',
  // Goods sent back.
  RETURN: 'RETURN',
  // They waived part of it.
  DISCOUNT: 'DISCOUNT',
  // What was owed before the system knew about them. Either sign.
  OPENING: 'OPENING',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
});

/**
 * A purchase is recorded when the goods are in hand, so there is no draft and no
 * separate receive. A mistake is cancelled and re-entered, never edited: editing
 * one would have to rewrite a stock movement, a landed cost and a due, all of
 * which are append-only on purpose. See docs/adr/0024.
 */
const PURCHASE_STATUS = Object.freeze({ RECEIVED: 'received', CANCELLED: 'cancelled' });

/** An extra cost on a purchase, beyond the rate paid for the goods. */
const PURCHASE_CHARGE_KIND = Object.freeze({
  TRANSPORT: 'transport',
  LABOUR: 'labour',
  LOADING: 'loading',
  COMMISSION: 'commission',
  OTHER: 'other',
});

/**
 * Who a purchase charge is settled with. Both kinds count toward landed cost;
 * only `PAYEE` reaches a ledger. Paying the van driver in cash at the gate does
 * not make the crate seller owed more.
 */
const CHARGE_PAID_TO = Object.freeze({ PAYEE: 'payee', OTHER: 'other' });

/**
 * How a purchase's charges are spread over its lines. By value when the charge
 * scales with what the goods are worth, by quantity when it scales with how much
 * there is to carry.
 */
const ALLOCATION_BASIS = Object.freeze({ VALUE: 'value', QUANTITY: 'quantity' });

/**
 * Whether an expense belongs to one order or to a day. Every expense is exactly
 * one, and a period expense is never divided across orders: nobody measured it
 * per order, and a share invented to complete the per-order number is a number
 * that is not true. See docs/adr/0027.
 */
const EXPENSE_SCOPE = Object.freeze({ ORDER: 'order', PERIOD: 'period' });

/** What a category may be used for. `BOTH` lets one category serve either. */
const CATEGORY_SCOPE = Object.freeze({ ORDER: 'order', PERIOD: 'period', BOTH: 'both' });

/** Whether the money has actually left. Unpaid plus a payee is a due. */
const EXPENSE_PAYMENT_STATUS = Object.freeze({ PAID: 'paid', UNPAID: 'unpaid' });

/**
 * How something was paid, as a label only. This is not an account and there is
 * no cash book: the system tracks what is owed and what was spent, not where the
 * money sat. See PLAN-3 decision 20.
 */
const PAID_FROM = Object.freeze({
  CASH: 'cash',
  BKASH: 'bkash',
  NAGAD: 'nagad',
  ROCKET: 'rocket',
  BANK: 'bank',
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
  SMS_PAYER,
  SMS_CATEGORY,
  OTP_PURPOSE,
  SYSTEM_ACTOR,
  SHOP_CLOSED_REASON,
  COMPLAINT_KIND,
  SOURCE_COMPLAINT_KINDS,
  RESELLER_DEACTIVATED_REASON,
  MOVEMENT_KIND,
  MOVEMENT_INCREASES,
  PAYEE_KIND,
  PAYEE_LEDGER_KIND,
  PURCHASE_STATUS,
  PURCHASE_CHARGE_KIND,
  CHARGE_PAID_TO,
  ALLOCATION_BASIS,
  EXPENSE_SCOPE,
  CATEGORY_SCOPE,
  EXPENSE_PAYMENT_STATUS,
  PAID_FROM,
  values,
};
