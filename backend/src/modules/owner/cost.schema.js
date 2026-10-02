'use strict';

const { z } = require('zod');
const { UNITS } = require('../../utils/quantity');
const {
  PAYEE_KIND,
  PAYEE_LEDGER_KIND,
  MOVEMENT_KIND,
  PURCHASE_CHARGE_KIND,
  CHARGE_PAID_TO,
  ALLOCATION_BASIS,
  CATEGORY_SCOPE,
  EXPENSE_PAYMENT_STATUS,
  PAID_FROM,
  PURCHASE_STATUS,
  values,
} = require('../../domain/constants');
const { MAX_RECIPE_ROWS } = require('../../domain/packaging');
const { businessDate, startOfBusinessDay } = require('../../utils/dhakaTime');

/**
 * The cost side of the owner API: supplies, payees, purchases and expenses.
 *
 * Kept in its own file rather than growing `schema.js` past five hundred lines.
 * The shared primitives are redeclared here rather than exported from there,
 * because two modules importing each other's zod fragments is how a schema file
 * becomes impossible to read.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier');
const money = z.coerce.number().nonnegative().max(10000000);
const positiveMoney = z.coerce.number().positive().max(10000000);
const qty = z.coerce.number().positive().max(1000000);
// A recount may legitimately be zero: the shelf is empty.
const countedQty = z.coerce.number().nonnegative().max(1000000);
/*
 * Round-tripped rather than merely parsed, as in `schema.js`: the 31st of
 * February parses, rolls forward to March, and would have filed a purchase on a
 * day nobody typed.
 */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  .refine((v) => {
    const d = startOfBusinessDay(v);
    return !Number.isNaN(d.getTime()) && businessDate(d) === v;
  }, 'That is not a real date');

/**
 * The day money was handed over. Today or earlier in Dhaka, never later: a
 * payment dated next week is a typo, and accepting it would put a settled due
 * on a statement for a day that has not happened.
 */
const paidOn = dateString.refine(
  (v) => v <= businessDate(),
  'A payment cannot be dated in the future'
);

/**
 * The day goods came in. A purchase is recorded when the goods are in hand
 * (docs/adr/0024), so a date after today describes crates nobody has yet, and
 * would shelve them and bill the seller for a delivery that has not happened.
 */
const receivedOn = dateString.refine(
  (v) => v <= businessDate(),
  'A purchase is recorded once the goods are in hand, so it cannot be dated in the future'
);

/**
 * Whole poisha. A taka amount with a third decimal has no poisha to land on:
 * 0.001 became zero after rounding and reached the ledger as a zero entry, which
 * the ledger refuses with a server error rather than a field the owner can fix.
 */
const wholePoisha = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

/** An empty select sends `status=`; read that as no filter, not as a bad value. */
const optionalEnum = (list) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.enum(list).optional());

/**
 * How many itemised rows a printed sheet carries. Capped so a mistyped range
 * cannot pull a season into one response, and the handler says when it stopped,
 * exactly as the order sheet does.
 */
const sheetMax = z.coerce.number().int().min(1).max(1000).default(500);

const dateRange = z
  .object({ from: dateString.optional(), to: dateString.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'The start date must not be after the end date',
    path: ['from'],
  });

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/**
 * A client-supplied idempotency key.
 *
 * Required, not optional, on every write that moves money or stock. The server
 * cannot generate it: the whole point is that a form submitted twice from a phone
 * on a bad connection carries the *same* key both times, which only the client
 * can arrange. See services/payeeLedger.js.
 */
const nonce = z.string().trim().min(8, 'A request key is required').max(64);

/* ------------------------------------------------------------------ supplies */

const createSupply = z.object({
  nameBn: z.string().trim().min(2, 'A name is required').max(160),
  unit: z.enum(UNITS),
  note: z.string().trim().max(1000).optional(),
  reorderLevel: z.coerce.number().nonnegative().max(1000000).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const updateSupply = createSupply
  .partial()
  // The unit cannot change once movements exist, and the controller refuses it
  // there where it can see them. Omitted from the shape so a caller sending it
  // gets a field error rather than a silent no-op.
  .omit({ unit: true })
  .extend({ isArchived: z.boolean().optional() });

/**
 * A movement the owner typed. `stockTake` is the other, separate route: it takes
 * a counted total rather than a difference, because "there are 94" is what a
 * person holding a clipboard knows and "six went missing" is arithmetic they
 * should not have to do.
 */
const adjustSupply = z.object({
  kind: z.enum([
    MOVEMENT_KIND.OPENING,
    MOVEMENT_KIND.DAMAGED,
    MOVEMENT_KIND.LOST,
    MOVEMENT_KIND.RETURN_TO_PAYEE,
    MOVEMENT_KIND.ADJUSTMENT,
  ]),
  // Signed for ADJUSTMENT, which may go either way. The controller normalises
  // the one-directional kinds so a typed minus sign cannot invert a loss.
  quantity: z.coerce
    .number()
    .min(-1000000)
    .max(1000000)
    .refine((v) => v !== 0, 'A movement cannot be zero'),
  nonce,
  note: z.string().trim().max(500).optional(),
  date: dateString.optional(),
});

const stockTake = z.object({
  counted: countedQty,
  nonce,
  note: z.string().trim().max(500).optional(),
  date: dateString.optional(),
});

const listSupplies = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
  // The archived ones alone, for the archived filter. Wins over includeArchived.
  archivedOnly: z.enum(['true', 'false']).optional(),
  lowOnly: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(120).optional(),
});

/* -------------------------------------------------------------------- payees */

const createPayee = z.object({
  nameBn: z.string().trim().min(2, 'A name is required').max(160),
  kind: z.enum(values(PAYEE_KIND)).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
});

const updatePayee = createPayee.partial().extend({ isArchived: z.boolean().optional() });

const listPayees = z.object({
  kind: z.enum(values(PAYEE_KIND)).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
  owingOnly: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(120).optional(),
});

const payPayee = z.object({
  amount: positiveMoney,
  nonce,
  paidFrom: z.enum(values(PAID_FROM)).optional(),
  note: z.string().trim().max(500).optional(),
  // The business date of the payment. Today when left out.
  date: paidOn.optional(),
});

/**
 * Taking back a wrong payment or a wrong hand-typed entry. The reason is
 * required: a reversal with no reason is a number that changed and nobody can
 * say why, which is the thing an append-only ledger exists to prevent.
 */
const reversePayeeEntry = z.object({
  reason: z.string().trim().min(3, 'Say why this is being reversed').max(500),
});

/**
 * A due the owner is correcting or carrying in by hand.
 *
 * Only the three kinds a person has any business typing. `PURCHASE`, `EXPENSE`
 * and `PAYMENT` are posted by their own services against their own records, and
 * letting them be typed here would produce a due with nothing behind it.
 */
const manualPayeeEntry = z.object({
  kind: z.enum([
    PAYEE_LEDGER_KIND.OPENING,
    PAYEE_LEDGER_KIND.ADJUSTMENT,
    PAYEE_LEDGER_KIND.DISCOUNT,
  ]),
  // Signed: positive increases what we owe. An opening due and a correction both
  // go either way.
  amount: z.coerce
    .number()
    .min(-10000000, 'That amount is too large')
    .max(10000000, 'That amount is too large')
    .refine(wholePoisha, 'Use at most two decimal places')
    .refine((v) => v !== 0, 'An entry cannot be zero'),
  nonce,
  note: z.string().trim().max(500).optional(),
});

/* ----------------------------------------------------------------- purchases */

const purchaseLine = z.object({
  supplyId: objectId,
  quantity: qty,
  unitCost: money,
});

const purchaseCharge = z.object({
  kind: z.enum(values(PURCHASE_CHARGE_KIND)),
  amount: money,
  paidTo: z.enum(values(CHARGE_PAID_TO)).optional(),
  payeeName: z.string().trim().max(120).optional(),
  allocate: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
});

const createPurchase = z.object({
  payeeId: objectId,
  lines: z.array(purchaseLine).min(1, 'A purchase needs at least one line').max(30),
  charges: z.array(purchaseCharge).max(10).optional(),
  allocationBasis: z.enum(values(ALLOCATION_BASIS)).optional(),
  date: receivedOn.optional(),
  invoiceNo: z.string().trim().max(60).optional(),
  note: z.string().trim().max(1000).optional(),
});

const cancelPurchase = z.object({
  reason: z.string().trim().min(2, 'Say why').max(500),
});

const purchaseFilters = {
  payeeId: objectId.optional(),
  supplyId: objectId.optional(),
  status: optionalEnum(values(PURCHASE_STATUS)),
};

const listPurchases = z.object({ ...purchaseFilters, ...paging }).and(dateRange);

// The printed sheet and the CSV take exactly the list's filters, unpaged.
const purchaseReport = z.object({ ...purchaseFilters, max: sheetMax }).and(dateRange);
const purchaseExport = z.object(purchaseFilters).and(dateRange);

/* ------------------------------------------------------------------ expenses */

const createCategory = z.object({
  nameBn: z.string().trim().min(2, 'A name is required').max(120),
  scope: z.enum(values(CATEGORY_SCOPE)).optional(),
  note: z.string().trim().max(500).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const updateCategory = createCategory.partial().extend({ isArchived: z.boolean().optional() });

const createExpense = z.object({
  categoryId: objectId,
  amount: positiveMoney,
  // Present means order scope, absent means period scope. The category has to
  // allow whichever it turns out to be; expenseService decides and refuses.
  orderId: objectId.optional(),
  payeeId: objectId.optional(),
  paymentStatus: z.enum(values(EXPENSE_PAYMENT_STATUS)).optional(),
  paidFrom: z.enum(values(PAID_FROM)).optional(),
  date: dateString.optional(),
  note: z.string().trim().max(1000).optional(),
});

const voidExpense = z.object({
  reason: z.string().trim().min(2, 'Say why').max(500),
});

/**
 * "দিয়ে দিয়েছি" on an unpaid expense. `paidFrom` is required because the
 * expense row shows it, and an unpaid row carries the default that was never
 * chosen by anyone.
 */
const markExpensePaid = z.object({
  paidFrom: z.enum(values(PAID_FROM)),
  date: paidOn.optional(),
});

const expenseFilters = {
  categoryId: objectId.optional(),
  payeeId: objectId.optional(),
  orderId: objectId.optional(),
  scope: optionalEnum(['order', 'period']),
  paymentStatus: optionalEnum(values(EXPENSE_PAYMENT_STATUS)),
};

const listExpenses = z
  .object({
    ...expenseFilters,
    includeVoided: z.enum(['true', 'false']).optional(),
    ...paging,
  })
  .and(dateRange);

// A report never counts a voided expense, so there is no includeVoided here.
const expenseReport = z.object({ ...expenseFilters, max: sheetMax }).and(dateRange);
const expenseExport = z.object(expenseFilters).and(dateRange);

/* ------------------------------------------------------------------ recipes */

/**
 * A variant's packaging recipe, set from the product form.
 *
 * Sent as its own request rather than folded into the product update, because
 * the product form is multipart (it carries photographs) and a nested array of
 * objects has no honest multipart encoding. See the note on `variants` in
 * `schema.js`.
 */
const setRecipe = z.object({
  packaging: z
    .array(
      z.object({
        supplyId: objectId,
        // Per ONE box. Fractional on purpose: 1.5 sheets of কাগজ is real.
        quantity: qty,
      })
    )
    .max(MAX_RECIPE_ROWS),
});

module.exports = {
  objectId,
  dateRange,
  createSupply,
  updateSupply,
  adjustSupply,
  stockTake,
  listSupplies,
  createPayee,
  updatePayee,
  listPayees,
  payPayee,
  reversePayeeEntry,
  manualPayeeEntry,
  createPurchase,
  cancelPurchase,
  listPurchases,
  purchaseReport,
  purchaseExport,
  createCategory,
  updateCategory,
  createExpense,
  voidExpense,
  markExpensePaid,
  listExpenses,
  expenseReport,
  expenseExport,
  setRecipe,
};
