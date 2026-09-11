'use strict';

const { z } = require('zod');
const { UNITS } = require('../../utils/quantity');
const { DEPOSIT_METHOD, values } = require('../../domain/constants');

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
const listOrders = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  reseller: objectId.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  aging: boolish.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const shipOrder = z.object({
  courierName: z.string().trim().min(2, 'Courier name is required').max(120),
  trackingNumber: z.string().trim().max(120).optional(),
});

const transitionBody = z.object({
  reason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
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
});

const overrideDeliveryCharge = z.object({ deliveryCharge: money });

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
  listOrders,
  shipOrder,
  transitionBody,
  acceptBody,
  overrideDeliveryCharge,
  manualEntry,
  approveWithdrawal,
  listFinance,
  updateSettings,
};
