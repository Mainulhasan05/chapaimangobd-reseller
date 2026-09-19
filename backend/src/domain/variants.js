'use strict';

const { badRequest } = require('../utils/errors');
const { fromMilli } = require('../utils/quantity');

/**
 * A **variant** is one box a product is sold in.
 *
 * Mangoes are not sold by the kilo off a scale. They leave in a six-kilo box or
 * an eleven-kilo box, and those are two different things with two different
 * prices, which is why they are two rows and not one product with a minimum and
 * a step. A customer orders two of the eleven and three of the six in the same
 * order, and that is three plus two boxes to pack, not thirty-four kilos to
 * weigh out. See docs/adr/0021.
 *
 * Every product is sold this way. There is no loose-quantity path: one way to
 * order, one shape of line, one thing for a report to add up.
 *
 * What a variant carries, and why:
 *
 * - `contentMilli` — how much is in the box, in the product's own unit. It is
 *   not for pricing, which is per box; it is what lets a pick list say "forty
 *   kilos from Chapai" rather than "seven boxes" when the boxes are different
 *   sizes. Two variants of one product may not hold the same amount: that is
 *   the same box named twice.
 * - `costPricePoisha` — what the owner charges the reseller for one box.
 * - `maxSellPricePoisha` — the ceiling, per box. Null means no ceiling.
 * - `stockQty` — whole boxes, and only meaningful while the product tracks
 *   stock. Boxes are counted, not weighed: running out of six-kilo boxes does
 *   not stop the eleven-kilo ones going out.
 */

/** How many box sizes one product may have. Four is already a long shelf. */
const MAX_VARIANTS = 8;

/** The most boxes of one variant a single order line may carry. */
const MAX_BOX_QTY = 999;

/**
 * What a box is called when the owner did not name it.
 *
 * Derived rather than stored, so a product whose unit changes does not keep a
 * label naming the old one. The owner may still type their own.
 */
function defaultLabel(contentMilli, unit) {
  return `${fromMilli(contentMilli)} ${unit}`;
}

/** What to show for a variant: the owner's name for it, or the derived one. */
function variantLabel(variant, unit) {
  const own = (variant.label || '').trim();
  return own || defaultLabel(variant.contentMilli, unit);
}

/**
 * An ordered box count. Whole boxes only: half a box is not a thing that can be
 * packed, which is the whole reason this replaced a milli-unit quantity.
 */
function assertBoxQty(qty, field = 'quantity') {
  if (!Number.isInteger(qty) || qty < 1) {
    throw badRequest('INVALID_QUANTITY', 'Order at least one box', {
      [field]: 'Order at least one box',
    });
  }
  if (qty > MAX_BOX_QTY) {
    throw badRequest('INVALID_QUANTITY', `At most ${MAX_BOX_QTY} boxes per line`, {
      [field]: `At most ${MAX_BOX_QTY} boxes per line`,
    });
  }
}

/**
 * Two boxes of one product may not hold the same amount.
 *
 * Refused rather than merged: a duplicate is the owner having added the same box
 * twice, and quietly dropping one of them would lose whichever price was typed
 * second.
 */
function assertDistinctContents(variants, field = 'variants') {
  const seen = new Set();
  variants.forEach((variant, index) => {
    if (seen.has(variant.contentMilli)) {
      const message = 'Two boxes of this product cannot hold the same amount';
      throw badRequest('DUPLICATE_VARIANT', message, { [`${field}.${index}.content`]: message });
    }
    seen.add(variant.contentMilli);
  });
}

/** The variant with this id, or undefined. Ids are subdocument ids on Product. */
function findVariant(product, variantId) {
  if (!product || !variantId) return undefined;
  return (product.variants || []).find((v) => String(v._id) === String(variantId));
}

/** A product can be sold at all only while it has a box someone can order. */
function sellableVariants(product) {
  return (product.variants || []).filter((v) => v.isAvailable);
}

module.exports = {
  MAX_VARIANTS,
  MAX_BOX_QTY,
  defaultLabel,
  variantLabel,
  assertBoxQty,
  assertDistinctContents,
  findVariant,
  sellableVariants,
};
