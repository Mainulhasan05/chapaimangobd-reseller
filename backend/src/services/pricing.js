'use strict';

const Product = require('../models/Product');
const ResellerProduct = require('../models/ResellerProduct');
const DeliveryZone = require('../models/DeliveryZone');
const { badRequest, notFound } = require('../utils/errors');
const { boxTotalPoisha, formatTakaPlain } = require('../utils/money');
const { fromMilli } = require('../utils/quantity');
const { assertBoxQty, findVariant, variantLabel } = require('../domain/variants');

/**
 * The client never sends a price or a total. It sends product ids and quantities,
 * and everything else is looked up and computed here. Accepting a client-supplied
 * total is the oldest bug in e-commerce.
 */

/**
 * A reseller may price at or above the owner cost, and at or below any owner
 * ceiling. Below cost the reseller loses money on every order and will eventually
 * blame us for it; the ceiling stops one reseller damaging the brand.
 *
 * Both bounds belong to the box, not the product: a six-kilo box and an
 * eleven-kilo box have nothing to say about each other's price.
 */
function assertSellPrice(sellPricePoisha, variant, field = 'sellPrice') {
  if (sellPricePoisha < variant.costPricePoisha) {
    const message = `Selling price cannot be below ${formatTakaPlain(variant.costPricePoisha)} taka`;
    throw badRequest('BELOW_COST', message, { [field]: message });
  }
  if (variant.maxSellPricePoisha != null && sellPricePoisha > variant.maxSellPricePoisha) {
    const message = `Selling price cannot be above ${formatTakaPlain(variant.maxSellPricePoisha)} taka`;
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

  /*
   * A line is a box, not a product. Two boxes of one product on one order is the
   * point of the whole thing - two elevens and three sixes - so what may not
   * repeat is the box. See docs/adr/0021.
   */
  const variantIds = items.map((i) => String(i.variant));
  if (new Set(variantIds).size !== variantIds.length) {
    throw badRequest('DUPLICATE_LINE', 'The same box appears more than once');
  }

  const productIds = [...new Set(items.map((i) => String(i.product)))];
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

    const variant = findVariant(product, item.variant);
    if (!variant) throw notFound('One of the boxes is no longer available');
    const label = variantLabel(variant, product.unit);
    if (!variant.isAvailable) {
      throw badRequest('UNAVAILABLE', `${product.nameBn} ${label} is currently unavailable`);
    }

    // A box the reseller never priced is not on sale in this shop, whatever the
    // owner offers, and neither is one they have taken off their own form.
    const priced = (listing.variants || []).find((v) => String(v.variant) === String(variant._id));
    if (!priced || !priced.isListed) {
      throw badRequest('NOT_LISTED', `${product.nameBn} ${label} is not on sale in this shop`);
    }

    assertBoxQty(item.qty, `items.${index}.quantity`);

    // An explicit price wins, otherwise the reseller preset applies. Either way
    // it is validated against the live box.
    const sellPricePoisha =
      item.sellPricePoisha != null ? item.sellPricePoisha : priced.sellPricePoisha;
    assertSellPrice(sellPricePoisha, variant, `items.${index}.sellPrice`);

    return {
      product: product._id,
      productNameBn: product.nameBn,
      unit: product.unit,
      variant: variant._id,
      variantLabelBn: label,
      variantContentMilli: variant.contentMilli,
      qty: item.qty,
      // What is in those boxes together, so a pick list can add up lines whose
      // boxes are different sizes.
      qtyMilli: item.qty * variant.contentMilli,
      costPricePoisha: variant.costPricePoisha,
      sellPricePoisha,
      lineCostPoisha: boxTotalPoisha(variant.costPricePoisha, item.qty),
      lineSellPoisha: boxTotalPoisha(sellPricePoisha, item.qty),
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
