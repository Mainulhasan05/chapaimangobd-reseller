'use strict';

const mongoose = require('mongoose');
const { ORDER_STATUS, ORDER_ORIGIN, PAYMENT_MODE, values } = require('../domain/constants');
const { UNITS } = require('../utils/quantity');
const { isSafeMoney } = require('../utils/money');

const money = (opts = {}) => ({
  type: Number,
  validate: { validator: isSafeMoney, message: '{PATH} must be a whole number of poisha' },
  ...opts,
});

/**
 * A line snapshots everything it needs to render and to price itself. A historical
 * order must never be rendered by populating the live product: repricing the catalog
 * would silently rewrite history and disagree with the ledger. See docs/adr/0001.
 */
const lineItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productNameBn: { type: String, required: true },
    unit: { type: String, enum: UNITS, required: true },
    qtyMilli: { type: Number, required: true, min: 1 },

    // Snapshots taken at confirm.
    costPricePoisha: money({ required: true, min: 0 }),
    sellPricePoisha: money({ required: true, min: 0 }),
    minOrderQtyMilli: { type: Number, required: true },

    lineCostPoisha: money({ required: true, min: 0 }),
    lineSellPoisha: money({ required: true, min: 0 }),

    /*
     * Where this line is actually being collected from, decided at accept.
     *
     * A product is a thing the owner sells; the orchard it comes from is chosen
     * per order, when the owner looks at what is ripe and who has it today. That
     * is why this lives on the line and not on Product: the product is fixed and
     * the source is not.
     *
     * `sourceNameBn` is the snapshot and the ref is a convenience. Rendering a
     * historical order must read the name from here, never populate the Source,
     * for the same reason a line already carries its own price: a source that is
     * later renamed or archived must not rewrite what happened. Null until the
     * order is accepted, because before that nobody has decided.
     */
    source: { type: mongoose.Schema.Types.ObjectId, ref: 'Source', default: null },
    sourceNameBn: { type: String, default: null },
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, required: true, unique: true },
    reseller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResellerProfile',
      required: true,
      index: true,
    },
    origin: { type: String, enum: values(ORDER_ORIGIN), required: true },
    // Chosen by the customer, changeable by the reseller at confirm, fixed from
    // confirm onwards. Only the delivered transition branches on it.
    // docs/adr/0003 and docs/adr/0007.
    paymentMode: { type: String, enum: values(PAYMENT_MODE), required: true },

    // Client-generated, so a retry on a flaky connection returns the same order
    // instead of creating a second one.
    submissionId: { type: String, default: null },
    // Dhaka calendar date, denormalised so today's orders is an index scan.
    businessDate: { type: String, required: true, index: true },

    customer: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      phoneE164: { type: String, required: true },
      altPhoneE164: { type: String },
      address: { type: String, required: true, maxlength: 500 },
      district: { type: String, required: true },
      note: { type: String, maxlength: 1000 },
    },

    items: {
      type: [lineItemSchema],
      validate: {
        validator: (v) => v.length > 0 && v.length <= 20,
        message: 'An order must have between 1 and 20 items',
      },
    },

    deliveryZone: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryZone' },
    deliveryZoneName: { type: String },
    deliveryChargePoisha: money({ required: true, min: 0, default: 0 }),
    /*
     * How many DELIVERY_ADJUSTMENT entries this order has posted. Incremented in
     * the same status-guarded update that changes the charge, and used as the
     * suffix of the entry's idempotency key. See docs/adr/0010.
     */
    deliveryAdjustmentCount: { type: Number, default: 0, min: 0 },

    totals: {
      costSubtotalPoisha: money({ default: 0 }),
      sellSubtotalPoisha: money({ default: 0 }),
      // What confirm debits: cost subtotal plus delivery.
      walletDebitPoisha: money({ default: 0 }),
      // What the reseller earns. Informational for prepaid, credited for cod.
      resellerMarginPoisha: money({ default: 0 }),
      // What the customer pays in total.
      customerTotalPoisha: money({ default: 0 }),
    },

    status: {
      type: String,
      enum: values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
      index: true,
    },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: values(ORDER_STATUS), required: true },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, maxlength: 500 },
        // Set only on the confirm entry, and only when the reseller changed the
        // payment mode the customer chose. See docs/adr/0007.
        paymentModeFrom: { type: String, enum: values(PAYMENT_MODE) },
        paymentModeTo: { type: String, enum: values(PAYMENT_MODE) },
      },
    ],

    courier: {
      name: { type: String },
      trackingNumber: { type: String },
    },

    confirmedAt: { type: Date },
    acceptedAt: { type: Date },
    packedAt: { type: Date },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    closedAt: { type: Date },

    cancelReason: { type: String, maxlength: 500 },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // The owner ticked "put back in stock" when marking this order returned.
    restockedOnReturn: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/*
 * A buyer's whole history, which is a lookup by phone and nothing else. The
 * number is the identity here: the same person orders under different names, so
 * a name index would find some of their orders and miss the rest.
 */
orderSchema.index({ 'customer.phoneE164': 1, createdAt: -1 });

orderSchema.index({ reseller: 1, status: 1, createdAt: -1 });
orderSchema.index({ reseller: 1, businessDate: 1 });
// Drives the aging report: confirmed orders going stale while mangoes rot.
orderSchema.index({ status: 1, confirmedAt: 1 });
orderSchema.index({ 'items.product': 1, status: 1 });
orderSchema.index(
  { reseller: 1, submissionId: 1 },
  { unique: true, partialFilterExpression: { submissionId: { $type: 'string' } } }
);

module.exports = mongoose.model('Order', orderSchema);
