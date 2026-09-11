'use strict';

const { EVENT_TYPE } = require('./constants');
const { toTaka } = require('../utils/money');

/**
 * What a notification says, in Bengali.
 *
 * It was English, written inline at each call site: "Order ABC123 is accepted",
 * "Deposit approved". Every reader of this app is Bengali speaking, and these
 * strings do not only appear in the in-app list where the interface could have
 * translated them. They are the push notification on the lock screen, the
 * Telegram message and the SMS, all of which are rendered by the sender and not
 * by any interface of ours. So the text has to be right here, at the source.
 *
 * Numbers stay in Latin digits deliberately. An order code is read aloud down a
 * phone line and typed into the tracking form, and a taka figure in a text
 * message is checked against a bank statement; both are worse in Bengali digits.
 * The interface converts digits for display, but a notification is not display.
 */

/** One taka figure, as a person would write it. */
const taka = (poisha) => `${toTaka(poisha)} টাকা`;

/**
 * The line for one event.
 *
 * `data` carries whatever the event knows: an order code, an amount, a reason
 * the owner typed. A reason is always preferred over the stock sentence, because
 * "স্টক শেষ" from the owner tells the reseller more than any generic wording.
 */
const TEXT = {
  /* -------------------------------------------------------------- orders -- */

  // A customer submitted the reseller's public form. This is the one that has to
  // land fastest: nothing happens to the order until the reseller confirms it.
  [EVENT_TYPE.ORDER_PENDING]: (d) => ({
    title: 'নতুন অর্ডার এসেছে',
    body: [d.orderCode, d.customerName].filter(Boolean).join(' · ') || undefined,
  }),

  // The reseller confirmed, so the order is now the owner's to fulfil. The only
  // event in this table whose reader is the owner.
  [EVENT_TYPE.ORDER_CONFIRMED]: (d) => ({
    title: 'অর্ডার নিশ্চিত হয়েছে',
    body:
      [d.orderCode, d.shopName].filter(Boolean).join(' · ') ||
      'অর্ডারটি গ্রহণ করার জন্য অপেক্ষা করছে',
  }),

  [EVENT_TYPE.ORDER_ACCEPTED]: (d) => ({
    title: 'অর্ডার গ্রহণ করা হয়েছে',
    body: d.orderCode ? `${d.orderCode} প্রস্তুত করা হচ্ছে` : undefined,
  }),

  [EVENT_TYPE.ORDER_SHIPPED]: (d) => ({
    title: 'অর্ডার পাঠানো হয়েছে',
    body: [d.orderCode, d.courierName].filter(Boolean).join(' · ') || undefined,
  }),

  [EVENT_TYPE.ORDER_DELIVERED]: (d) => ({
    title: 'অর্ডার ডেলিভারি হয়েছে',
    body: d.orderCode ? `${d.orderCode} ক্রেতার কাছে পৌঁছেছে` : undefined,
  }),

  // Cancelling is the owner refusing an order, and the reason is the whole
  // message: without it the reseller has to ring to find out what went wrong.
  [EVENT_TYPE.ORDER_CANCELLED]: (d) => ({
    title: 'অর্ডার বাতিল হয়েছে',
    body: [d.orderCode, d.reason].filter(Boolean).join(' · ') || undefined,
  }),

  [EVENT_TYPE.ORDER_RETURNED]: (d) => ({
    title: 'অর্ডার ফেরত এসেছে',
    body: [d.orderCode, d.reason].filter(Boolean).join(' · ') || undefined,
  }),

  /* ----------------------------------------------------------------- kyc -- */

  [EVENT_TYPE.KYC_APPROVED]: (d) => ({
    title: 'আপনার কেওয়াইসি অনুমোদিত হয়েছে',
    body: d.slug ? `আপনার দোকান চালু হয়েছে: /r/${d.slug}` : 'আপনার দোকান এখন চালু করা যাবে',
  }),

  [EVENT_TYPE.KYC_REJECTED]: (d) => ({
    title: 'কেওয়াইসি আবার জমা দিতে হবে',
    body: d.reason || 'কাগজপত্র আবার পরিষ্কারভাবে তুলে জমা দিন',
  }),

  /* --------------------------------------------------------------- money -- */

  [EVENT_TYPE.DEPOSIT_APPROVED]: (d) => ({
    title: 'জমা অনুমোদিত হয়েছে',
    body: d.amountPoisha != null ? `${taka(d.amountPoisha)} আপনার ব্যালেন্সে যোগ হয়েছে` : undefined,
  }),

  [EVENT_TYPE.DEPOSIT_REJECTED]: (d) => ({
    title: 'জমা গ্রহণ করা হয়নি',
    body: d.reason || 'তথ্য মিলিয়ে আবার জমা দিন',
  }),

  [EVENT_TYPE.WITHDRAWAL_APPROVED]: (d) => ({
    title: 'টাকা পাঠানো হয়েছে',
    body:
      d.amountPoisha != null
        ? `${taka(d.amountPoisha)}${d.destination ? ` · ${d.destination}` : ''}`
        : undefined,
  }),

  [EVENT_TYPE.WITHDRAWAL_REJECTED]: (d) => ({
    title: 'উত্তোলনের আবেদন গ্রহণ করা হয়নি',
    body: d.reason || 'বিস্তারিত জানতে যোগাযোগ করুন',
  }),

  // A reseller who hits the credit limit cannot confirm another order, so this
  // is a warning ahead of the wall rather than a report of hitting it.
  [EVENT_TYPE.BALANCE_NEAR_LIMIT]: (d) => ({
    title: 'ব্যালেন্স সীমার কাছে',
    body:
      d.balancePoisha != null
        ? `বর্তমান ব্যালেন্স ${taka(d.balancePoisha)}। নতুন অর্ডার নিতে টাকা জমা দিন।`
        : 'নতুন অর্ডার নিতে টাকা জমা দিন',
  }),
};

/**
 * The title and body for an event.
 *
 * An unknown event type is not an error worth failing a notification over: the
 * record is still written, still shows up in the list, and still says which
 * event it was. Losing the notification entirely would be worse than losing its
 * wording.
 */
function textFor(eventType, data = {}) {
  const build = TEXT[eventType];
  if (!build) return { title: eventType, body: undefined };

  const { title, body } = build(data);
  return { title, body: body || undefined };
}

module.exports = { textFor };
