'use strict';

const { z } = require('zod');
const { PAYMENT_MODE, DEPOSIT_METHOD, values } = require('../../domain/constants');
const { TEMPLATES: LANDING_TEMPLATES } = require('../../domain/landing');
const { isBankMethod } = require('../../domain/payout');
const { MAX_VARIANTS, MAX_BOX_QTY } = require('../../domain/variants');

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
  /*
   * Any text, not a URL. A reseller types `facebook.com/amarshop`, or the page
   * name, or pastes a link from a chat app with a tracking tail on it, and all
   * of those are what they meant. `lib/url.ts` makes it followable at render.
   * See docs/adr/0020.
   */
  facebookUrl: optionalText(300),
  about: optionalText(600),
  bkashNumber: optionalText(20),
  nagadNumber: optionalText(20),

  // The page design. Content is the owner's; see domain/landing.js.
  landingTemplate: z.enum(Object.values(LANDING_TEMPLATES)).optional(),
});

/**
 * This reseller's prices for one product, a price per box.
 *
 * The whole set every time: the screen shows every box of one product together
 * and saves them together, so a partial update would need per-box endpoints for
 * no gain. A box left out of the list is a box this shop does not sell, which is
 * how a reseller carries the six-kilo and not the eleven. See docs/adr/0021.
 */
const setCatalogPrice = z.object({
  variants: z
    .array(
      z.object({
        variant: objectId,
        sellPrice: money,
        // Null or zero clears it. Checked against the sell price in the controller.
        regularPrice: money.nullable().optional(),
        isListed: z.boolean().optional(),
      })
    )
    .min(1, 'Price at least one box')
    .max(MAX_VARIANTS),
  hidePrice: z.boolean().optional(),
  isListed: z.boolean().optional(),
});

const orderItemOverride = z.object({
  product: objectId,
  // Which box. An order line is a box, not a product. docs/adr/0021.
  variant: objectId,
  // Whole boxes.
  quantity: z.number().int().positive().max(MAX_BOX_QTY).optional(),
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
        // A line is a box. docs/adr/0021.
        variant: objectId,
        // Whole boxes.
        quantity: z.number().int().positive().max(MAX_BOX_QTY),
        sellPrice: money.optional(),
      })
    )
    .min(1)
    .max(20),
});

const cancelOrder = z.object({ reason: z.string().trim().min(3).max(500) });

/**
 * Correcting where an order goes. Every field optional, at least one present.
 * The same bounds a new order takes, so an edit cannot store what a submission
 * would have refused. Shared with the owner route.
 */
const editCustomer = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().min(6).max(20).optional(),
    address: z.string().trim().min(5).max(500).optional(),
    district: z.string().trim().min(2).max(80).optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Change at least one of name, phone, address or district',
  });

const createDeposit = z.object({
  amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(values(DEPOSIT_METHOD)),
  senderNumber: z.string().max(20).optional(),
  transactionId: z.string().trim().max(64).optional(),
  note: z.string().max(500).optional(),
});

/*
 * Where the money is actually sent. A mobile wallet is paid on a number and a
 * bank on an account, so the two are asked for different things and neither
 * accepts the other's answer. See domain/payout.js and docs/adr/0018.
 */
const bankAccount = z.object({
  accountName: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  branchName: z.string().trim().min(2).max(120),
  // Bangladeshi account numbers run to seventeen digits; some banks print them
  // with dashes, which are kept rather than stripped so the reseller's own
  // reading of their passbook is what the owner sees on the payout screen.
  accountNumber: z
    .string()
    .trim()
    .min(6)
    .max(34)
    .regex(/^[0-9][0-9 -]*[0-9]$/, 'Account number must be digits'),
  routingNumber: z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'Routing number is nine digits')
    .optional(),
});

const createWithdrawal = z
  .object({
    amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
    method: z.enum(values(DEPOSIT_METHOD)),
    destinationNumber: z.string().min(6).max(20).optional(),
    bank: bankAccount.optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((body, ctx) => {
    if (isBankMethod(body.method)) {
      if (!body.bank) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bank'],
          message: 'Bank name, branch, account name and account number are required',
        });
      }
      return;
    }
    // Every other method is paid to a number, and a bank block sent with one
    // would be stored against a payout nobody makes by bank transfer.
    if (!body.destinationNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationNumber'],
        message: 'Where should the money be sent?',
      });
    }
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
  editCustomer,
  createDeposit,
  createWithdrawal,
  purchaseSms,
  subscribePush,
  listOrders,
};
