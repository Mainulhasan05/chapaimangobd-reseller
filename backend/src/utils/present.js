'use strict';

const { toTaka } = require('./money');
const { availableActions } = require('../domain/orderStateMachine');
const { fromMilli } = require('./quantity');
const { variantLabel } = require('../domain/variants');
const storage = require('../config/storage');
const imageService = require('../services/images');

/**
 * Converts internal integer representations to the decimal values the API speaks.
 * Conversion happens only at this boundary; nothing inside the system uses taka.
 */

/**
 * Images are presented, never rendered from a raw row.
 *
 * A public image is either hosted on ImgBB, where the URL is the record, or in
 * the R2 public bucket, where the URL is derived from the key so that moving
 * the bucket does not orphan everything already saved. `services/images.js`
 * knows which is which; nothing above this line should have to.
 *
 * The handle travels alongside the URL because the owner's product form needs
 * to name an individual image in order to drop it. It leaks nothing: these are
 * public images, so the handle is already the tail of a URL anyone can see.
 */
const images = (list) => imageService.presentMany(list);

const line = (l) => ({
  id: l._id,
  product: l.product,
  productName: l.productNameBn,
  unit: l.unit,
  /*
   * Which box and how many. Read from the line's own snapshot, never from the
   * live product, for the same reason the price beside it is a snapshot. A line
   * written before boxes existed carries none of these, so they answer null and
   * `quantity` below is the only thing it ever had. See docs/adr/0021.
   */
  variant: l.variant || null,
  variantLabel: l.variantLabelBn || null,
  variantContent: l.variantContentMilli == null ? null : fromMilli(l.variantContentMilli),
  boxes: l.qty ?? null,
  // What is in those boxes together, in the product's unit.
  quantity: fromMilli(l.qtyMilli),
  costPrice: toTaka(l.costPricePoisha),
  sellPrice: toTaka(l.sellPricePoisha),
  lineCost: toTaka(l.lineCostPoisha),
  lineSell: toTaka(l.lineSellPoisha),
  // Both the snapshot and the reference. The name is what any screen renders;
  // the id is only for linking through to a source that still exists.
  source: l.source || null,
  sourceName: l.sourceNameBn || null,
});

const totals = (t) => ({
  costSubtotal: toTaka(t.costSubtotalPoisha),
  sellSubtotal: toTaka(t.sellSubtotalPoisha),
  walletDebit: toTaka(t.walletDebitPoisha),
  resellerMargin: toTaka(t.resellerMarginPoisha),
  customerTotal: toTaka(t.customerTotalPoisha),
});

/** Full order, for the reseller and the owner. Includes cost prices. */
const order = (o) => ({
  id: o._id,
  orderCode: o.orderCode,
  reseller: o.reseller,
  origin: o.origin,
  paymentMode: o.paymentMode,
  businessDate: o.businessDate,
  customer: o.customer,
  items: (o.items || []).map(line),
  deliveryZoneName: o.deliveryZoneName,
  deliveryCharge: toTaka(o.deliveryChargePoisha),
  totals: totals(o.totals || {}),
  status: o.status,
  statusHistory: o.statusHistory,
  courier: o.courier,
  confirmedAt: o.confirmedAt,
  acceptedAt: o.acceptedAt,
  packedAt: o.packedAt,
  shippedAt: o.shippedAt,
  deliveredAt: o.deliveredAt,
  cancelReason: o.cancelReason,
  restockedOnReturn: Boolean(o.restockedOnReturn),
  createdAt: o.createdAt,
});

/**
 * The full order plus what this role may do with it now. Every endpoint that
 * hands an order to an order screen answers in this shape, so a screen can
 * replace its copy with any of those responses and lose nothing.
 */
const orderFor = (o, role) => ({ ...order(o), actions: availableActions(o, role) });

/**
 * What a customer may see. No cost price, no margin, no reseller identifiers:
 * the tracking page must not teach a buyer what the reseller paid.
 */
const publicOrder = (o) => ({
  orderCode: o.orderCode,
  status: o.status,
  placedAt: o.createdAt,
  paymentMode: o.paymentMode,
  items: (o.items || []).map((l) => ({
    productName: l.productNameBn,
    unit: l.unit,
    // What the customer chose: this box, this many. `unitPrice` is per box.
    variantLabel: l.variantLabelBn || null,
    boxes: l.qty ?? null,
    quantity: fromMilli(l.qtyMilli),
    unitPrice: toTaka(l.sellPricePoisha),
    lineTotal: toTaka(l.lineSellPoisha),
  })),
  deliveryCharge: toTaka(o.deliveryChargePoisha),
  total: toTaka(o.totals.customerTotalPoisha),
  courier: o.courier && o.courier.name ? o.courier : null,
  deliveredAt: o.deliveredAt,
});

const ledgerEntry = (e) => ({
  id: e._id,
  seq: e.seq,
  kind: e.kind,
  amount: toTaka(e.amountPoisha),
  balanceAfter: toTaka(e.balanceAfterPoisha),
  refType: e.refType,
  refId: e.refId,
  reversalOf: e.reversalOf,
  note: e.note,
  createdAt: e.createdAt,
});

/**
 * One box a product is sold in. `label` is resolved here, so no screen has to
 * know that a blank one means "the content and the unit". Stock is a count of
 * boxes and is null when the product is not counted at all, the same way a
 * product's stock used to be. See domain/variants.js.
 */
const variant = (v, { unit, trackStock }) => ({
  id: v._id,
  label: variantLabel(v, unit),
  content: fromMilli(v.contentMilli),
  costPrice: toTaka(v.costPricePoisha),
  maxSellPrice: v.maxSellPricePoisha == null ? null : toTaka(v.maxSellPricePoisha),
  stockQty: trackStock ? v.stockQty : null,
  isAvailable: v.isAvailable,
  sortOrder: v.sortOrder,
});

const product = (p) => ({
  id: p._id,
  name: p.nameBn,
  description: p.description,
  images: images(p.images),
  unit: p.unit,
  // A product has no price and no quantity rules: a box has both. docs/adr/0021.
  variants: (p.variants || [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.contentMilli - b.contentMilli)
    .map((v) => variant(v, p)),
  trackStock: p.trackStock,
  isAvailable: p.isAvailable,
  sortOrder: p.sortOrder,
});

/**
 * One complaint. Every name on it is read from the complaint's own snapshots,
 * never from a populated Source or Product: a renamed orchard must not rewrite
 * the record being used to judge it. See models/Complaint.js.
 */
const complaint = (c) => ({
  id: c._id,
  order: c.order,
  orderCode: c.orderCode,
  reseller: c.reseller,
  customerPhone: c.customerPhoneE164,
  businessDate: c.businessDate,
  kind: c.kind,
  note: c.note,
  items: (c.items || []).map((i) => ({
    itemId: i.itemId,
    product: i.product,
    productName: i.productNameBn,
    // Null when the order had not been accepted yet: no orchard was chosen.
    source: i.source || null,
    sourceName: i.sourceNameBn || null,
  })),
  resolved: Boolean(c.resolved),
  resolvedAt: c.resolvedAt || null,
  resolution: c.resolution || null,
  createdAt: c.createdAt,
});

const wallet = (profile) => ({
  balance: toTaka(profile.balancePoisha),
  creditLimit: toTaka(profile.creditLimitPoisha),
  available: toTaka(profile.balancePoisha + profile.creditLimitPoisha),
  smsCredits: profile.smsCredits,
});

module.exports = {
  line,
  totals,
  order,
  orderFor,
  publicOrder,
  ledgerEntry,
  product,
  complaint,
  wallet,
  images,
};
