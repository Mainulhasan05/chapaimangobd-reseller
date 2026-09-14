'use strict';

const Product = require('../models/Product');
const { conflict } = require('../utils/errors');
const { fromMilli } = require('../utils/quantity');

/**
 * Stock moves only inside the order transaction, and only for products that opt in
 * with trackStock. Unlimited stock is that flag being false, never a null quantity:
 * $inc on null errors, and a null-or-missing filter cannot use an index.
 */

/**
 * Takes stock for every tracked line. The conditional filter is the guard against
 * overselling under concurrent confirms; a null result means someone got there first.
 */
async function decrement(session, lines) {
  const taken = [];

  for (const line of lines) {
    // Sequential on purpose: each update must see the previous one, and a failure
    // aborts the transaction so already-taken stock rolls back with it.
    // eslint-disable-next-line no-await-in-loop
    const updated = await Product.findOneAndUpdate(
      { _id: line.product, trackStock: true, stockQtyMilli: { $gte: line.qtyMilli } },
      { $inc: { stockQtyMilli: -line.qtyMilli } },
      { new: true, session }
    );

    if (updated) {
      taken.push(line);
      continue;
    }

    // Either the product does not track stock, or there is not enough of it.
    // eslint-disable-next-line no-await-in-loop
    const product = await Product.findById(line.product).session(session);
    if (product && product.trackStock) {
      throw conflict(
        'OUT_OF_STOCK',
        `Only ${fromMilli(product.stockQtyMilli)} ${product.unit} of ${product.nameBn} is left`
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
    // eslint-disable-next-line no-await-in-loop
    await Product.updateOne(
      { _id: line.product, trackStock: true },
      { $inc: { stockQtyMilli: line.qtyMilli } },
      { session }
    );
  }
}

module.exports = { decrement, restore };
