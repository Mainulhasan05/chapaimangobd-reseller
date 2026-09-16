'use strict';

const { z } = require('zod');
const { UNITS } = require('../../utils/quantity');
const {
  DEPOSIT_METHOD,
  values,
  SMS_STATUS,
  SMS_PURPOSE,
  COMPLAINT_KIND,
} = require('../../domain/constants');
const {
  ICONS: LANDING_ICONS,
  LIMITS: LANDING_LIMITS,
  TEXT_LIMITS: LANDING_TEXT,
} = require('../../domain/landing');

const { businessDate, startOfBusinessDay } = require('../../utils/dhakaTime');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier');
// Multipart bodies arrive as strings, so numbers coerce at the boundary.
const money = z.coerce.number().nonnegative().max(10000000);
const qty = z.coerce.number().positive().max(1000000);

/**
 * A checkbox that came through a multipart form.
 *
 * `z.coerce.boolean()` cannot be used here and was: it is `Boolean(value)`, and
 * `Boolean('false')` is true, so every switch in the product form saved as on no
 * matter which way it was set. Turning stock tracking off therefore turned it
 * on, against a quantity of zero, and the product read as out of stock on the
 * reseller's catalog and on every public shop listing it.
 *
 * A real boolean passes through untouched, for JSON callers. A string is read
 * the way a form means it, and anything else is rejected rather than guessed at.
 */
const boolish = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'off', 'no', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

/**
 * A Dhaka business date, `YYYY-MM-DD`.
 *
 * Every report and every export reads a date off the query string and hands it
 * to `startOfBusinessDay`, which builds `new Date(`${value}T00:00:00+06:00`)`.
 * An unvalidated value made that an Invalid Date, which Mongoose then refused to
 * cast: `?from=yesterday` was a 500 rather than a 400. The shape is checked here
 * and the calendar is checked below, because `2026-02-31` parses and is not a day.
 */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  /*
   * Round-tripped, not merely parsed. `new Date('2026-02-31T00:00:00+06:00')`
   * is not an Invalid Date: it rolls forward to the 3rd of March, so a null
   * check here would have accepted the 31st of February and quietly answered
   * with a different day's orders under the heading the caller asked for.
   */
  .refine((value) => {
    const parsed = startOfBusinessDay(value);
    // A month of 13 never parses at all, and formatting an Invalid Date throws.
    if (Number.isNaN(parsed.getTime())) return false;
    return businessDate(parsed) === value;
  }, 'Not a real date');

/**
 * The range every report and export shares. Both ends are optional and both are
 * inclusive Dhaka calendar days; `from` after `to` is refused here rather than
 * quietly answering with nothing, because an empty report reads as "no orders"
 * and that is a different statement from "you asked for a backwards range".
 */
const dateRange = z
  .object({ from: dateString.optional(), to: dateString.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'The start date must not be after the end date',
    path: ['from'],
  });

/* sources */
const createSource = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  address: z.string().trim().max(500).optional(),
  phone: z.string().max(20).optional(),
  note: z.string().max(1000).optional(),
});
const updateSource = createSource.partial().extend({ isArchived: z.boolean().optional() });

/* products */
const createProduct = z.object({
  name: z.string().trim().min(2, 'Name is required').max(160),
  description: z.string().max(2000).optional(),
  unit: z.enum(UNITS),
  step: qty.optional(),
  minOrderQty: qty,
  costPrice: money,
  maxSellPrice: money.nullable().optional(),
  trackStock: boolish.optional(),
  stockQty: z.coerce.number().nonnegative().max(10000000).optional(),
  isAvailable: boolish.optional(),
  sortOrder: z.coerce.number().int().optional(),
});
/*
 * Storage keys of images to drop. A multipart body repeats the field name once
 * per value, which arrives as a bare string when there is exactly one, so it is
 * normalised to an array before validation rather than at every call site.
 */
const storageKeys = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(z.string().trim().min(1).max(512)).max(6).optional()
);

const updateProduct = createProduct.partial().extend({
  isArchived: boolish.optional(),
  removeImages: storageKeys,
});

/* delivery zones */
const createZone = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  districts: z.array(z.string().trim().min(2).max(80)).min(1, 'List at least one district'),
  charge: money,
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
const updateZone = createZone.partial();

/* resellers */
const updateReseller = z.object({
  creditLimit: money.optional(),
  isActive: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
});

const reviewDecision = z.object({
  reason: z.string().trim().max(500).optional(),
});

/* orders */
/**
 * Everything that narrows a list of orders, in one place, because the list, the
 * counts beside it, the printable sheet and the CSV must all mean the same thing
 * by "these orders". Extended rather than duplicated for each of those.
 */
const orderFilters = {
  status: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  reseller: objectId.optional(),
  // Orders carrying a line collected from this orchard. See utils/orderFilter.js.
  source: objectId.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  aging: boolish.optional(),
};

const backwardsRange = {
  message: 'The start date must not be after the end date',
  path: ['from'],
};

const rangeIsForwards = (v) => !v.from || !v.to || v.from <= v.to;

const listOrders = z
  .object({
    ...orderFilters,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(rangeIsForwards, backwardsRange);

/**
 * The customer report. No dates: a customer record is a standing projection of
 * every order that number has placed, not a property of a period. See
 * models/Customer.js.
 */
const customersReport = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** The same filters, for the counts and money shown beside the list. */
const orderSummary = z.object(orderFilters).refine(rangeIsForwards, backwardsRange);

/**
 * The printable sheet: the same filters, but unpaged, because a dispatch sheet
 * with page two missing is worse than no sheet. `max` caps it so a mistyped
 * range cannot ask for the entire order history in one response; the handler
 * says when it had to stop rather than silently truncating.
 */
const orderSheet = z
  .object({ ...orderFilters, max: z.coerce.number().int().min(1).max(1000).default(500) })
  .refine(rangeIsForwards, backwardsRange);

/* complaints */

/**
 * Logging what a customer said was wrong. See models/Complaint.js.
 *
 * `itemIds` names which lines are at fault, and through them which orchard. It
 * may be empty: a complaint about the delivery blames no fruit and therefore no
 * source. The handler reads everything else about those lines off the order, so
 * nothing here can put a name into the record that decides who gets avoided.
 */
const createComplaint = z.object({
  kind: z.enum(values(COMPLAINT_KIND)),
  // Required, and required to say something: a complaint with no words is a
  // number nobody can act on when the question comes up again in six weeks.
  note: z.string().trim().min(3, 'Say what went wrong').max(1000),
  itemIds: z.array(objectId).max(20).optional().default([]),
});

const resolveComplaint = z.object({
  resolution: z.string().trim().max(1000).optional(),
});

const listComplaints = z
  .object({
    kind: z.string().optional(),
    source: objectId.optional(),
    resolved: boolish.optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(rangeIsForwards, backwardsRange);

/*
 * The owner's "send SMS to customer" box, on accept, ship and cancel only.
 * Off unless ticked. See docs/adr/0013.
 */
const sendCustomerSms = z.boolean().optional().default(false);

const shipOrder = z.object({
  courierName: z.string().trim().min(2, 'Courier name is required').max(120),
  trackingNumber: z.string().trim().max(120).optional(),
  sendCustomerSms,
});

const transitionBody = z.object({
  reason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
});

const cancelBody = transitionBody.extend({ sendCustomerSms });

/** The inputs of the SMS preview, named the way the modal holds them. */
const customerSmsPreview = z.object({
  action: z.enum(['accept', 'ship', 'cancel']),
  courier: z.string().trim().max(120).optional(),
  trackingId: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(500).optional(),
});

/*
 * Accepting says where every line is collected from. One entry per line rather
 * than one source for the order, because a single order routinely spans two
 * orchards and flattening that would lose exactly the fact this records.
 * Twenty matches the ceiling on items an order may hold.
 */
const acceptBody = z.object({
  sources: z
    .array(z.object({ itemId: objectId, sourceId: objectId }))
    .min(1, 'Choose a source for every item')
    .max(20),
  sendCustomerSms,
});

/*
 * A return is whole-order. `restock` is the owner's "put back in stock" box,
 * off unless ticked, because mangoes that have travelled are usually gone.
 * See docs/adr/0008.
 */
const returnBody = transitionBody.extend({
  restock: z.boolean().optional().default(false),
});

const overrideDeliveryCharge = z.object({ deliveryCharge: money });

// One shape for both roles, defined beside the reseller's order schemas.
const { editCustomer } = require('../reseller/schema');

/* audit */

const dhakaDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * The owner's audit log viewer. Cursor paginated on (createdAt, _id) descending,
 * because the log only grows and page numbers over a growing log skip and repeat
 * rows. Dates are Dhaka calendar days.
 */
const listAudit = z.object({
  actor: objectId.optional(),
  targetType: z.string().trim().max(60).optional(),
  targetId: objectId.optional(),
  action: z.string().trim().max(80).optional(),
  from: dhakaDate.optional(),
  to: dhakaDate.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/* finance */
const manualEntry = z.object({
  amount: z.coerce.number().max(10000000),
  direction: z.enum(['credit', 'debit']),
  note: z.string().trim().min(3, 'Say why this adjustment exists').max(500),
});

const approveWithdrawal = z.object({
  payoutReference: z.string().trim().max(120).optional(),
});

const listFinance = z.object({
  status: z.string().optional(),
  method: z.enum(values(DEPOSIT_METHOD)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/* settings */
const updateSettings = z.object({
  businessName: z.string().trim().max(120).optional(),
  supportPhone: z.string().max(20).optional(),
  poweredByText: z.string().max(200).optional(),
  defaultCreditLimit: money.optional(),
  orderAgingHours: z.coerce.number().int().min(1).max(720).optional(),
  reverseDeliveryChargeOnReturn: z.boolean().optional(),
  smsPricePerCredit: money.optional(),
  features: z
    .object({
      sms: z.boolean().optional(),
      telegram: z.boolean().optional(),
      webPush: z.boolean().optional(),
    })
    .optional(),
  // Shape only. The GSM-7 and segment rules live in domain/customerSms.js and
  // are applied by the controller, which reports them per field.
  customerSmsTemplates: z
    .object({
      accept: z.string().max(1000).optional(),
      ship: z.string().max(1000).optional(),
      cancel: z.string().max(1000).optional(),
    })
    .strict()
    .optional(),
});

/* landing page */

/**
 * The owner's landing content, text only. Images and reviews arrive on their own
 * multipart routes. Every list is sent whole: the editor holds the full list,
 * so a reorder or a deletion is simply the new list, with no index arithmetic.
 */
const lt = LANDING_TEXT;
const landingText = (max) => z.string().trim().max(max);
const updateLanding = z
  .object({
    headline: landingText(lt.headline).optional(),
    subtitle: landingText(lt.subtitle).optional(),
    videoUrl: z
      .union([z.literal(''), z.string().trim().url('Enter a full link').max(lt.videoUrl)])
      .optional(),
    rating: z.number().min(0).max(5).nullable().optional(),
    customerCount: landingText(lt.customerCount).optional(),
    deliveryNote: landingText(lt.deliveryNote).optional(),
    guaranteeNote: landingText(lt.guaranteeNote).optional(),
    badges: z
      .array(
        z.object({ icon: z.enum(LANDING_ICONS), label: landingText(lt.badgeLabel).min(1) })
      )
      .max(LANDING_LIMITS.badges)
      .optional(),
    whyUs: z.array(landingText(lt.listItem).min(1)).max(LANDING_LIMITS.whyUs).optional(),
    features: z.array(landingText(lt.listItem).min(1)).max(LANDING_LIMITS.features).optional(),
    tips: z
      .array(
        z.object({
          icon: z.enum(LANDING_ICONS),
          title: landingText(lt.tipTitle).min(1),
          text: landingText(lt.tipText).min(1),
        })
      )
      .max(LANDING_LIMITS.tips)
      .optional(),
    faqs: z
      .array(z.object({ q: landingText(lt.faqQuestion).min(1), a: landingText(lt.faqAnswer).min(1) }))
      .max(LANDING_LIMITS.faqs)
      .optional(),
  })
  .strict();

/** A review arrives as multipart, because it may carry a screenshot. */
const addLandingReview = z.object({
  name: z.string().trim().max(lt.reviewName).optional().default(''),
  text: z.string().trim().max(lt.reviewText).optional().default(''),
});

/* sms */

/**
 * The master switch, on its own endpoint rather than inside updateSettings.
 *
 * It is the one control here that starts spending money per use, and a body
 * that can only carry that one boolean cannot turn it on as a side effect of
 * saving the business name.
 */
const toggleSms = z.object({ enabled: z.boolean() });

const listSmsLogs = z.object({
  status: z.enum(values(SMS_STATUS)).optional(),
  purpose: z.enum(values(SMS_PURPOSE)).optional(),
  eventType: z.string().max(60).optional(),
  resellerId: objectId.optional(),
  q: z.string().trim().max(80).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/*
 * Capped at the same length the service truncates to, so the owner is told the
 * message is too long rather than discovering it was cut off after paying for it.
 */
const sendTestSms = z.object({
  phone: z.string().min(1),
  text: z.string().trim().min(1).max(1000),
});

/**
 * A browser push subscription, exactly as the Push API hands it over. The same
 * shape the reseller posts: the owner subscribes their own browser through the
 * same endpoints, so the body cannot be allowed to drift between the two.
 */
const subscribePush = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

module.exports = {
  updateLanding,
  addLandingReview,
  subscribePush,
  objectId,
  createSource,
  updateSource,
  createProduct,
  updateProduct,
  createZone,
  updateZone,
  updateReseller,
  reviewDecision,
  dateString,
  dateRange,
  listOrders,
  orderSummary,
  orderSheet,
  customersReport,
  createComplaint,
  resolveComplaint,
  listComplaints,
  shipOrder,
  transitionBody,
  cancelBody,
  customerSmsPreview,
  acceptBody,
  returnBody,
  overrideDeliveryCharge,
  editCustomer,
  listAudit,
  manualEntry,
  approveWithdrawal,
  listFinance,
  updateSettings,
  toggleSms,
  listSmsLogs,
  sendTestSms,
};
