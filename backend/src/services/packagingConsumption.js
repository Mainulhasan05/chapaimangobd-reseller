'use strict';

const Product = require('../models/Product');
const Supply = require('../models/Supply');
const supplyStock = require('./supplyStock');
const packagingDomain = require('../domain/packaging');
const { findVariant } = require('../domain/variants');

/**
 * Turning an order's variants into supply movements.
 *
 * Sits between `orderService` and `supplyStock` so neither has to know about the
 * other: the order transaction asks "consume this order's packaging", and this
 * module does the loading, the recipe expansion, the snapshot and the movements.
 *
 * Called once per order, at **deliver** or at **return**, and never undone. See
 * docs/adr/0026.
 */

/**
 * Loads the variants an order's lines name, and the supplies their recipes name.
 *
 * Two round trips whatever the order's size, rather than one per line. The
 * products are read by the ids on the lines, not by populating, because a line
 * may name a variant on an archived product and the recipe still has to be found.
 */
async function loadContext(items, session) {
  const productIds = [...new Set(items.map((i) => String(i.product)).filter(Boolean))];
  const query = Product.find({ _id: { $in: productIds } }, { unit: 1, variants: 1, nameBn: 1 });
  const products = await (session ? query.session(session) : query);

  const variantOf = (variantId) => {
    if (!variantId) return null;
    for (const product of products) {
      const variant = findVariant(product, variantId);
      if (variant) return variant;
    }
    return null;
  };

  // Every supply any of those recipes mentions.
  const supplyIds = new Set();
  items.forEach((item) => {
    const variant = variantOf(item.variant);
    (variant && variant.packaging ? variant.packaging : []).forEach((row) => {
      if (row && row.supply) supplyIds.add(String(row.supply));
    });
  });

  const supplyQuery = Supply.find({ _id: { $in: [...supplyIds] } });
  const supplies = await (session ? supplyQuery.session(session) : supplyQuery);
  const byId = new Map(supplies.map((s) => [String(s._id), s]));

  return { variantOf, supplyOf: (id) => byId.get(String(id)) || null };
}

/**
 * What this order is expected to consume, and what it would cost. Reads nothing
 * it does not have to and writes nothing at all.
 *
 * Used by the order screen from accept onwards, long before anything is deducted,
 * so the owner finds out a supply has run out while there is still time to buy
 * more rather than at the packing table.
 */
async function estimate(order, session) {
  const items = order.items || [];
  const { variantOf, supplyOf } = await loadContext(items, session);
  return packagingDomain.estimateForOrder(items, variantOf, supplyOf);
}

/**
 * Consumes the order's packaging and writes the snapshots onto its lines.
 *
 * Mutates `order` in place — the lines' `packagingUsed` and the order's
 * `packagingCostPoisha` — and leaves saving to the caller, which is already
 * saving the order inside the same transaction. Returns the movements posted.
 *
 * Idempotent by construction: the movement key is the order plus the supply, so a
 * retried transaction consumes once. Never blocks: a short count takes the supply
 * negative rather than refusing to record a parcel that has genuinely gone out.
 *
 * @returns {Promise<{ movements: Array, costPoisha: number }>}
 */
async function consumeForOrder(session, order, actorId) {
  const items = order.items || [];
  const { variantOf, supplyOf } = await loadContext(items, session);

  // Per line, for the snapshot and therefore for the cost.
  let costPoisha = 0;
  items.forEach((item) => {
    const rows = packagingDomain.expand(variantOf(item.variant), item.qty);
    if (rows.length === 0) return;
    const snapshot = packagingDomain.snapshot(rows, supplyOf);
    item.packagingUsed = snapshot;
    costPoisha += packagingDomain.totalCostPoisha(snapshot);
  });

  order.packagingCostPoisha = costPoisha;

  /*
   * Per supply, for the movements. Rolled up because stock moves per supply: two
   * box sizes in one order that both take a ক্যারেট are one movement of two.
   */
  const rolled = packagingDomain.forOrder(items, variantOf);
  const movements = [];
  for (const row of rolled) {
    const supply = supplyOf(row.supply);
    // eslint-disable-next-line no-await-in-loop
    const movement = await supplyStock.consume(session, {
      supply: row.supply,
      qtyMilli: row.qtyMilli,
      unitCostPoisha: supply ? supply.avgCostPoisha : 0,
      orderId: order._id,
      note: `Order ${order.orderCode}`,
      createdBy: actorId,
    });
    movements.push(movement);
  }

  return { movements, costPoisha };
}

module.exports = { estimate, consumeForOrder, loadContext };
