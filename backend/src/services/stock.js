'use strict';

const Product = require('../models/Product');
const { conflict } = require('../utils/errors');
const { findVariant, variantLabel } = require('../domain/variants');

/**
 * Stock moves only inside the order transaction, and only for products that opt in
 * with trackStock. Unlimited stock is that flag being false, never a null quantity:
 * $inc on null errors, and a null-or-missing filter cannot use an index.
 *
 * Stock is a count of boxes, held per variant, because that is what a godown
 * holds: running out of six-kilo boxes must not stop the eleven-kilo ones going
 * out. The flag stays on the product - whether this product is counted at all is
 * one decision - and the number is on the box. See docs/adr/0021.
 */

/** The positional filter both operations share: this product, this box. */
const at = (line) => ({
  _id: line.product,
  trackStock: true,
  'variants._id': line.variant,
});

/**
 * Takes stock for every tracked line. The conditional filter is the guard against
 * overselling under concurrent confirms; a null result means someone got there first.
 */
async function decrement(session, lines) {
  const taken = [];

  for (const line of lines) {
    // A line from before boxes existed names no variant, so there is no box to
    // take it from. Nothing to do, exactly as an untracked product.
    if (!line.variant) continue;

    // Sequential on purpose: each update must see the previous one, and a failure
    // aborts the transaction so already-taken stock rolls back with it.
    // eslint-disable-next-line no-await-in-loop
    const updated = await Product.findOneAndUpdate(
      {
        ...at(line),
        // Matched on the same array element that is then decremented, so a
        // product whose *other* box has enough cannot satisfy this one.
        variants: { $elemMatch: { _id: line.variant, stockQty: { $gte: line.qty } } },
      },
      { $inc: { 'variants.$[box].stockQty': -line.qty } },
      { new: true, session, arrayFilters: [{ 'box._id': line.variant }] }
    );

    if (updated) {
      taken.push(line);
      continue;
    }

    // Either the product does not track stock, or there are not enough boxes.
    // eslint-disable-next-line no-await-in-loop
    const product = await Product.findById(line.product).session(session);
    if (product && product.trackStock) {
      const variant = findVariant(product, line.variant);
      const left = variant ? variant.stockQty : 0;
      const label = variant ? variantLabel(variant, product.unit) : '';
      throw conflict(
        'OUT_OF_STOCK',
        `Only ${left} box(es) of ${product.nameBn} ${label} is left`.replace('  ', ' ')
      );
    }
  }

  return taken;
}

/**
 * Puts stock back. Used by every cancel of an order that took stock (any status
 * from confirmed), and by a return when the owner ticks "put back in stock".
 * See docs/adr/0008.
 */
async function restore(session, lines) {
  for (const line of lines) {
    if (!line.variant) continue;
    // eslint-disable-next-line no-await-in-loop
    await Product.updateOne(
      at(line),
      { $inc: { 'variants.$[box].stockQty': line.qty } },
      { session, arrayFilters: [{ 'box._id': line.variant }] }
    );
  }
}

module.exports = { decrement, restore };
