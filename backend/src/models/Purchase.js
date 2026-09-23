'use strict';

const mongoose = require('mongoose');
const {
  PURCHASE_STATUS,
  PURCHASE_CHARGE_KIND,
  CHARGE_PAID_TO,
  ALLOCATION_BASIS,
  values,
} = require('../domain/constants');
const { UNITS } = require('../utils/quantity');
const { isSafeMoney } = require('../utils/money');

const money = (opts = {}) => ({
  type: Number,
  validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
  ...opts,
});

/**
 * One supply bought, at a rate, with its share of what else the trip cost.
 *
 * Snapshots the supply's name and unit for the same reason an order line
 * snapshots a product's: renaming a supply must not rewrite a purchase from
 * three months ago.
 */
const purchaseLineSchema = new mongoose.Schema(
  {
    supply: { type: mongoose.Schema.Types.ObjectId, ref: 'Supply', required: true },
    supplyNameBn: { type: String, required: true },
    unit: { type: String, enum: UNITS, required: true },

    qtyMilli: { type: Number, required: true, min: 1 },

    // The rate agreed, per whole unit, before any charge is spread onto it.
    unitCostPoisha: money({ required: true, min: 0 }),
    lineCostPoisha: money({ required: true, min: 0 }),

    // This line's share of the purchase's allocatable charges, worked out by
    // domain/landedCost.js with largest-remainder rounding so the shares sum to
    // the charge exactly.
    allocatedChargePoisha: money({ required: true, min: 0, default: 0 }),

    /*
     * What it actually cost: "koto kore porlo". The rate alone is not it — a
     * hundred crates at 80 taka with 800 taka of van hire and loading cost 88
     * taka each, and 88 is the number the owner means when they ask the price of
     * a crate. This is what feeds the moving average on the supply.
     */
    landedLineCostPoisha: money({ required: true, min: 0 }),
    landedUnitCostPoisha: money({ required: true, min: 0 }),
  },
  { _id: true }
);

/**
 * An extra cost on a purchase beyond the goods: the van, the men who loaded it,
 * the broker's cut.
 *
 * `paidTo` and `allocate` are two independent axes and it matters that they are.
 * `allocate` decides whether this raises what the goods cost; `paidTo` decides
 * whether anyone is owed for it. Paying the van driver in cash at the gate makes
 * the crates cost more without making the crate seller owed a paisa more.
 */
const purchaseChargeSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: values(PURCHASE_CHARGE_KIND), required: true },
    amountPoisha: money({ required: true, min: 0 }),
    paidTo: { type: String, enum: values(CHARGE_PAID_TO), default: CHARGE_PAID_TO.PAYEE },
    // Who it went to, when it was not the payee. Free text: a van driver at a
    // ghat is not somebody the owner wants to create a record for.
    payeeName: { type: String, trim: true, maxlength: 120 },
    allocate: { type: Boolean, default: true },
    note: { type: String, maxlength: 300 },
  },
  { _id: true }
);

/**
 * One buying event from one payee on one day.
 *
 * Recorded when the goods are in hand, so there is no draft and no separate
 * receive step: recording it moves the stock and posts the due together, in one
 * transaction. A purchase is **cancelled and re-entered**, never edited —
 * editing one would have to rewrite a stock movement, a landed cost and a due,
 * all of which are append-only on purpose. See docs/adr/0024.
 */
const purchaseSchema = new mongoose.Schema(
  {
    // Human-quotable, so the owner and the crate seller can name the same piece
    // of paper. Random rather than sequential, like an order code.
    purchaseCode: { type: String, required: true, unique: true },

    payee: { type: mongoose.Schema.Types.ObjectId, ref: 'Payee', required: true, index: true },
    payeeNameBn: { type: String, required: true },

    // Dhaka calendar date, denormalised so a ranged purchase report is an index
    // scan, exactly as on Order.
    businessDate: { type: String, required: true, index: true },
    // The seller's own memo number, when there is one. Not unique: a handwritten
    // slip from a village market repeats numbers and refusing the second one
    // would block a real purchase.
    invoiceNo: { type: String, trim: true, maxlength: 60 },

    status: {
      type: String,
      enum: values(PURCHASE_STATUS),
      default: PURCHASE_STATUS.RECEIVED,
      index: true,
    },

    lines: {
      type: [purchaseLineSchema],
      validate: {
        validator: (v) => v.length > 0 && v.length <= 30,
        message: 'A purchase must have between 1 and 30 lines',
      },
    },
    charges: {
      type: [purchaseChargeSchema],
      validate: {
        validator: (v) => v.length <= 10,
        message: 'A purchase can have at most 10 charges',
      },
    },

    allocationBasis: {
      type: String,
      enum: values(ALLOCATION_BASIS),
      default: ALLOCATION_BASIS.VALUE,
    },

    goodsCostPoisha: money({ required: true, min: 0 }),
    chargeTotalPoisha: money({ required: true, min: 0, default: 0 }),
    /*
     * What reaches the payee's ledger, and deliberately not `totalPoisha`. Goods
     * plus only those charges the payee themselves billed. See docs/adr/0023.
     */
    payeeTotalPoisha: money({ required: true, min: 0 }),
    // Charges settled with somebody else on the spot. Real money, owed to nobody.
    otherChargePoisha: money({ required: true, min: 0, default: 0 }),
    // What the purchase cost in all: goods plus every charge.
    totalPoisha: money({ required: true, min: 0 }),

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, maxlength: 500 },

    note: { type: String, maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

purchaseSchema.index({ businessDate: -1, createdAt: -1 });
purchaseSchema.index({ payee: 1, businessDate: -1 });
// "Where did this supply come from, and at what rate" reads this.
purchaseSchema.index({ 'lines.supply': 1, businessDate: -1 });

module.exports = mongoose.model('Purchase', purchaseSchema);
