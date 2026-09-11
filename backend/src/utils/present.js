'use strict';

const { toTaka } = require('./money');
const { fromMilli } = require('./quantity');
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
  createdAt: o.createdAt,
});

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

const product = (p) => ({
  id: p._id,
  name: p.nameBn,
  description: p.description,
  images: images(p.images),
  unit: p.unit,
  step: fromMilli(p.qtyStepMilli),
  minOrderQty: fromMilli(p.minOrderQtyMilli),
  costPrice: toTaka(p.costPricePoisha),
  maxSellPrice: p.maxSellPricePoisha == null ? null : toTaka(p.maxSellPricePoisha),
  trackStock: p.trackStock,
  stockQty: p.trackStock ? fromMilli(p.stockQtyMilli) : null,
  isAvailable: p.isAvailable,
  sortOrder: p.sortOrder,
});

const wallet = (profile) => ({
  balance: toTaka(profile.balancePoisha),
  creditLimit: toTaka(profile.creditLimitPoisha),
  available: toTaka(profile.balancePoisha + profile.creditLimitPoisha),
  smsCredits: profile.smsCredits,
});

module.exports = { line, totals, order, publicOrder, ledgerEntry, product, wallet, images };
