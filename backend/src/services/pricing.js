'use strict';

const Product = require('../models/Product');
const ResellerProduct = require('../models/ResellerProduct');
const DeliveryZone = require('../models/DeliveryZone');
const { badRequest, notFound } = require('../utils/errors');
const { lineTotalPoisha, formatTakaPlain } = require('../utils/money');
const { assertOrderable, fromMilli } = require('../utils/quantity');

/**
 * The client never sends a price or a total. It sends product ids and quantities,
 * and everything else is looked up and computed here. Accepting a client-supplied
 * total is the oldest bug in e-commerce.
 */

/**
 * A reseller may price at or above the owner cost, and at or below any owner
 * ceiling. Below cost the reseller loses money on every order and will eventually
 * blame us for it; the ceiling stops one reseller damaging the brand.
 */
function assertSellPrice(sellPricePoisha, product, field = 'sellPrice') {
  if (sellPricePoisha < product.costPricePoisha) {
    const message = `Selling price cannot be below ${formatTakaPlain(product.costPricePoisha)} taka`;
    throw badRequest('BELOW_COST', message, { [field]: message });
  }
  if (product.maxSellPricePoisha != null && sellPricePoisha > product.maxSellPricePoisha) {
    const message = `Selling price cannot be above ${formatTakaPlain(product.maxSellPricePoisha)} taka`;
    throw badRequest('ABOVE_MAX', message, { [field]: message });
  }
}

/**
 * Builds priced, snapshotted order lines from live catalog data.
 *
 * Called both when a customer submits and again at confirm. Re-running it at
 * confirm is deliberate: the owner may have raised the cost price since the
 * customer submitted, and the floor must be checked against the price we are
 * about to charge, not the one that applied yesterday.
 */
async function buildLines({ session, resellerId, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('EMPTY_ORDER', 'An order needs at least one product');
  }

  const productIds = items.map((i) => i.product);
  if (new Set(productIds.map(String)).size !== productIds.length) {
    throw badRequest('DUPLICATE_LINE', 'The same product appears more than once');
  }

  const query = Product.find({ _id: { $in: productIds }, isArchived: false });
  const products = await (session ? query.session(session) : query);
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const rpQuery = ResellerProduct.find({ reseller: resellerId, product: { $in: productIds } });
  const listings = await (session ? rpQuery.session(session) : rpQuery);
  const listingByProduct = new Map(listings.map((l) => [String(l.product), l]));

  return items.map((item, index) => {
    const key = String(item.product);
    const product = productById.get(key);
    if (!product) throw notFound('One of the products is no longer available');
    if (!product.isAvailable) {
      throw badRequest('UNAVAILABLE', `${product.nameBn} is currently unavailable`);
    }

    const listing = listingByProduct.get(key);
    if (!listing || !listing.isListed) {
      throw badRequest('NOT_LISTED', `${product.nameBn} is not on sale in this shop`);
    }

    assertOrderable(item.qtyMilli, product, `items.${index}.quantity`);

    // An explicit price wins, otherwise the reseller preset applies. Either way
    // it is validated against the live product.
    const sellPricePoisha =
      item.sellPricePoisha != null ? item.sellPricePoisha : listing.sellPricePoisha;
    assertSellPrice(sellPricePoisha, product, `items.${index}.sellPrice`);

    return {
      product: product._id,
      productNameBn: product.nameBn,
      unit: product.unit,
      qtyMilli: item.qtyMilli,
      costPricePoisha: product.costPricePoisha,
      sellPricePoisha,
      minOrderQtyMilli: product.minOrderQtyMilli,
      lineCostPoisha: lineTotalPoisha(product.costPricePoisha, item.qtyMilli),
      lineSellPoisha: lineTotalPoisha(sellPricePoisha, item.qtyMilli),
    };
  });
}

/**
 * An order total is the sum of already-rounded line totals, never a rounded sum.
 * See docs/adr/0001.
 */
function computeTotals(lines, deliveryChargePoisha = 0) {
  const costSubtotalPoisha = lines.reduce((sum, l) => sum + l.lineCostPoisha, 0);
  const sellSubtotalPoisha = lines.reduce((sum, l) => sum + l.lineSellPoisha, 0);

  return {
    costSubtotalPoisha,
    sellSubtotalPoisha,
    // What confirm debits from the wallet, in both payment modes.
    walletDebitPoisha: costSubtotalPoisha + deliveryChargePoisha,
    resellerMarginPoisha: sellSubtotalPoisha - costSubtotalPoisha,
    // What the customer hands over, to the reseller or to the courier.
    customerTotalPoisha: sellSubtotalPoisha + deliveryChargePoisha,
  };
}

/** Resolves the delivery charge for a district, falling back to no zone match. */
async function resolveDeliveryZone(district, session) {
  if (!district) return { zone: null, chargePoisha: 0 };

  const query = DeliveryZone.findOne({ isActive: true, districts: district });
  const zone = await (session ? query.session(session) : query);

  if (!zone) {
    throw badRequest('NO_ZONE', 'We do not deliver to that district yet', {
      district: 'We do not deliver to that district yet',
    });
  }
  return { zone, chargePoisha: zone.chargePoisha };
}

/** Human-readable line summary, used in notifications where space is tight. */
const describeLine = (line) =>
  `${line.productNameBn} ${fromMilli(line.qtyMilli)}${line.unit}`;

module.exports = { assertSellPrice, buildLines, computeTotals, resolveDeliveryZone, describeLine };
