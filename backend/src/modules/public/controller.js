'use strict';

const ResellerProfile = require('../../models/ResellerProfile');
const ResellerProduct = require('../../models/ResellerProduct');
const Product = require('../../models/Product');
const DeliveryZone = require('../../models/DeliveryZone');
const Order = require('../../models/Order');

const orderService = require('../../services/orderService');
const { getSettings } = require('../../services/settings');
const { ok } = require('../../middleware/error');
const { notFound, badRequest } = require('../../utils/errors');
const { normalizeBdPhone } = require('../../utils/phone');
const { normalizeOrderCode } = require('../../utils/orderCode');
const { toMilli, fromMilli } = require('../../utils/quantity');
const { toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const { KYC_STATUS } = require('../../domain/constants');

/** The shop a customer sees. Reseller branding, with a small powered-by line. */
async function getShop(req, res) {
  const profile = await ResellerProfile.findOne({ slug: req.params.slug });
  if (!profile) throw notFound('Shop not found');

  if (profile.kycStatus !== KYC_STATUS.APPROVED || !profile.formActive) {
    throw notFound('This shop is not open right now');
  }

  const listings = await ResellerProduct.find({ reseller: profile._id, isListed: true }).sort({
    sortOrder: 1,
  });

  const products = await Product.find({
    _id: { $in: listings.map((l) => l.product) },
    isArchived: false,
    isAvailable: true,
  });
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const settings = await getSettings();

  const items = listings
    .map((listing) => {
      const product = productById.get(String(listing.product));
      if (!product) return null;

      return {
        id: product._id,
        name: product.nameBn,
        description: product.description,
        images: present.images(product.images),
        unit: product.unit,
        step: fromMilli(product.qtyStepMilli),
        minOrderQty: fromMilli(product.minOrderQtyMilli),
        inStock: !product.trackStock || product.stockQtyMilli >= product.minOrderQtyMilli,
        // Hidden prices are omitted from the body, not merely hidden in the UI.
        // A price present in the JSON is public, whatever the front end does.
        priceHidden: listing.hidePrice,
        ...(listing.hidePrice ? {} : { price: toTaka(listing.sellPricePoisha) }),
      };
    })
    .filter(Boolean);

  return ok(res, {
    shop: {
      slug: profile.slug,
      name: profile.shopName,
      logoUrl: profile.logoUrl,
      poweredBy: settings.poweredByText,
    },
    products: items,
  });
}

async function listZones(_req, res) {
  const zones = await DeliveryZone.find({ isActive: true }).sort({ sortOrder: 1 });
  return ok(res, {
    zones: zones.map((z) => ({
      id: z._id,
      name: z.name,
      districts: z.districts,
      charge: toTaka(z.chargePoisha),
    })),
  });
}

/** Customer submission. Lands as pending; no money and no stock move here. */
async function createOrder(req, res) {
  const profile = await ResellerProfile.findOne({ slug: req.params.slug });
  if (!profile) throw notFound('Shop not found');

  const { customer, items, paymentMode, submissionId } = req.body;

  const result = await orderService.createPendingOrder({
    resellerProfile: profile,
    paymentMode,
    submissionId,
    customer: {
      name: customer.name,
      phoneE164: normalizeBdPhone(customer.phone, 'customer.phone'),
      altPhoneE164: customer.altPhone
        ? normalizeBdPhone(customer.altPhone, 'customer.altPhone')
        : undefined,
      address: customer.address,
      district: customer.district,
      note: customer.note,
    },
    items: items.map((i) => ({ product: i.product, qtyMilli: toMilli(i.quantity) })),
  });

  // A duplicate submission returns the original order rather than a second one.
  return ok(
    res,
    { orderCode: result.order.orderCode, duplicate: result.duplicate },
    result.duplicate ? 200 : 201
  );
}

/**
 * Status lookup. The phone number is a second factor: without it a random or
 * enumerated code would expose a stranger name, phone and address.
 */
async function trackOrder(req, res) {
  const orderCode = normalizeOrderCode(req.params.code);
  const phoneE164 = normalizeBdPhone(req.query.phone, 'phone');

  const order = await Order.findOne({ orderCode, 'customer.phoneE164': phoneE164 });
  if (!order) {
    throw badRequest('NOT_FOUND', 'No order matches that code and phone number');
  }

  return ok(res, { order: present.publicOrder(order) });
}

module.exports = { getShop, listZones, createOrder, trackOrder };
