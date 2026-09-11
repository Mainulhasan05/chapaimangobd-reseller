'use strict';

const { z } = require('zod');
const { PAYMENT_MODE, DEPOSIT_METHOD, values } = require('../../domain/constants');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier');
const money = z.coerce.number().nonnegative().max(10000000);

/**
 * A field the reseller may clear.
 *
 * Every shopfront detail is optional, so an empty string has to mean "remove
 * this", not "reject this". Without the union a reseller could add a Facebook
 * page and never take it off again, because the empty value would fail `url()`
 * and the whole save with it.
 */
const optionalText = (max) => z.union([z.literal(''), z.string().trim().max(max)]).optional();

const updateProfile = z.object({
  shopName: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().min(3).max(32).optional(),
  address: optionalText(500),
  formActive: z.boolean().optional(),

  /* The shopfront. All optional, all shown to logged-out customers. */
  publicPhone: optionalText(20),
  whatsappNumber: optionalText(20),
  // Validated as a URL only when there is one, so clearing it stays possible.
  facebookUrl: z.union([z.literal(''), z.string().trim().url().max(300)]).optional(),
  about: optionalText(600),
  bkashNumber: optionalText(20),
  nagadNumber: optionalText(20),
});

const setCatalogPrice = z.object({
  sellPrice: money,
  hidePrice: z.boolean().optional(),
  isListed: z.boolean().optional(),
});

const orderItemOverride = z.object({
  product: objectId,
  quantity: z.number().positive().max(100000).optional(),
  sellPrice: money.optional(),
});

const confirmOrder = z.object({
  items: z.array(orderItemOverride).max(20).optional(),
  paymentMode: z.enum(values(PAYMENT_MODE)).optional(),
});

const manualOrder = z.object({
  paymentMode: z.enum(values(PAYMENT_MODE)),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().min(6).max(20),
    altPhone: z.string().max(20).optional(),
    address: z.string().trim().min(5).max(500),
    district: z.string().trim().min(2).max(80),
    note: z.string().max(1000).optional(),
  }),
  items: z
    .array(
      z.object({
        product: objectId,
        quantity: z.number().positive().max(100000),
        sellPrice: money.optional(),
      })
    )
    .min(1)
    .max(20),
});

const cancelOrder = z.object({ reason: z.string().trim().min(3).max(500) });

const createDeposit = z.object({
  amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(values(DEPOSIT_METHOD)),
  senderNumber: z.string().max(20).optional(),
  transactionId: z.string().trim().max(64).optional(),
  note: z.string().max(500).optional(),
});

const createWithdrawal = z.object({
  amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(values(DEPOSIT_METHOD)),
  destinationNumber: z.string().min(6).max(20),
  note: z.string().max(500).optional(),
});

const purchaseSms = z.object({ credits: z.number().int().positive().max(10000) });

const subscribePush = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

const listOrders = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  objectId,
  updateProfile,
  setCatalogPrice,
  confirmOrder,
  manualOrder,
  cancelOrder,
  createDeposit,
  createWithdrawal,
  purchaseSms,
  subscribePush,
  listOrders,
};
