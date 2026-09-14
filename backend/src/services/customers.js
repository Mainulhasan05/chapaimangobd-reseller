'use strict';

const { logger } = require('../config/logger');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { ORDER_STATUS } = require('../domain/constants');

/**
 * Keeping the customer record in step with the orders.
 *
 * Every function here writes a projection of the orders collection. Orders are
 * the source of truth and this is derived, which drives two decisions:
 *
 *   - Nothing in here runs inside the order transaction, and nothing in here is
 *     allowed to throw into its caller. An order that was placed must be saved
 *     even if the aggregate cannot be updated. The alternative is refusing a
 *     customer's order because a counter would not increment, which is absurd.
 *   - Every number can be recomputed from the orders alone. `rebuild` does
 *     exactly that, and it is how the records are created for orders that
 *     predate this file existing.
 */

/**
 * How many name and address variants to keep per customer.
 *
 * A number that has ordered two hundred times to two hundred addresses is
 * either a shop or a courier desk, and the long tail of that list tells nobody
 * anything. The cap keeps the document a sensible size; the most used variants
 * are the ones worth keeping, so the list is trimmed by count.
 */
const MAX_VARIANTS = 20;

/**
 * Records one variant, incrementing it if this value has been seen before.
 *
 * Two writes rather than one, because there is no single update that says
 * "increment the matching element or append it if there is none". The first
 * matches the element and bumps it; only when nothing matched does the second
 * push a new one.
 */
async function recordVariant(phoneE164, field, value, at) {
  const trimmed = (value || '').trim();
  if (!trimmed) return;

  const bumped = await Customer.updateOne(
    { phoneE164, [`${field}.value`]: trimmed },
    { $inc: { [`${field}.$.count`]: 1 }, $max: { [`${field}.$.lastUsedAt`]: at } }
  );

  if (bumped.matchedCount > 0) return;

  await Customer.updateOne(
    { phoneE164 },
    {
      $push: {
        [field]: {
          // Most used first, so the name someone actually goes by leads the
          // list rather than whichever one happened to be typed first.
          $each: [{ value: trimmed, count: 1, firstUsedAt: at, lastUsedAt: at }],
          $sort: { count: -1 },
          $slice: MAX_VARIANTS,
        },
      },
    }
  );
}

/**
 * Notes that this order happened.
 *
 * Called after the order transaction has committed, never inside it. Failures
 * are swallowed: `rebuild` can always reconstruct what was missed, and a
 * customer standing in a shop should not have their order refused because a
 * counter would not increment.
 */
async function recordOrder(order) {
  try {
    const phoneE164 = order.customer?.phoneE164;
    if (!phoneE164) return;

    const at = order.createdAt || new Date();

    await Customer.updateOne(
      { phoneE164 },
      {
        $setOnInsert: { phoneE164, firstOrderAt: at },
        $inc: { orderCount: 1 },
        // `$max` rather than `$set`, so replaying an older order out of order
        // cannot drag the last-seen date backwards.
        $max: { lastOrderAt: at },
        $addToSet: { resellers: order.reseller },
      },
      { upsert: true }
    );

    await recordVariant(phoneE164, 'names', order.customer.name, at);
    await recordVariant(phoneE164, 'addresses', order.customer.address, at);

    if (order.customer.altPhoneE164) {
      await Customer.updateOne(
        { phoneE164 },
        { $addToSet: { altPhones: order.customer.altPhoneE164 } }
      );
    }
  } catch (err) {
    logger.error({ err, orderCode: order?.orderCode }, 'customers: recordOrder failed');
  }
}

/** Which counter a terminal status belongs to. Nothing else is counted. */
const COUNTER_FOR_STATUS = {
  [ORDER_STATUS.DELIVERED]: 'deliveredCount',
  [ORDER_STATUS.CANCELLED]: 'cancelledCount',
  [ORDER_STATUS.RETURNED]: 'returnedCount',
};

/**
 * Notes how an order ended.
 *
 * Only the three outcomes that say something about the buyer. Packed and
 * shipped are the owner's progress, not the customer's behaviour, and counting
 * them would say nothing that the order count does not already.
 */
async function recordOutcome(order) {
  try {
    const phoneE164 = order.customer?.phoneE164;
    const counter = COUNTER_FOR_STATUS[order.status];
    if (!phoneE164 || !counter) return;

    const update = { $inc: { [counter]: 1 } };

    // Spend is money actually collected, so only a delivered order adds to it.
    if (order.status === ORDER_STATUS.DELIVERED) {
      update.$inc.totalSpendPoisha = order.totals?.customerTotalPoisha || 0;
    }

    await Customer.updateOne({ phoneE164 }, update);
  } catch (err) {
    logger.error({ err, orderCode: order?.orderCode }, 'customers: recordOutcome failed');
  }
}

/**
 * What this buyer has done with this one reseller.
 *
 * Computed from the reseller's own orders rather than read off the customer
 * record, and that is the whole point: the shared record knows every shop this
 * number has bought from, and one reseller has no business learning what a
 * customer spends with another. The owner sees the record; a reseller sees
 * only their own half of it.
 */
async function summaryForReseller(resellerId, phoneE164) {
  const [summary] = await Order.aggregate([
    { $match: { reseller: resellerId, 'customer.phoneE164': phoneE164 } },
    {
      $group: {
        _id: null,
        orderCount: { $sum: 1 },
        deliveredCount: {
          $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.DELIVERED] }, 1, 0] },
        },
        cancelledCount: {
          $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.CANCELLED] }, 1, 0] },
        },
        returnedCount: {
          $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.RETURNED] }, 1, 0] },
        },
        totalSpendPoisha: {
          $sum: {
            $cond: [
              { $eq: ['$status', ORDER_STATUS.DELIVERED] },
              '$totals.customerTotalPoisha',
              0,
            ],
          },
        },
        firstOrderAt: { $min: '$createdAt' },
        lastOrderAt: { $max: '$createdAt' },
        names: { $addToSet: '$customer.name' },
        addresses: { $addToSet: '$customer.address' },
      },
    },
  ]);

  return summary || null;
}

/**
 * Rebuilds every customer record from the orders collection.
 *
 * This is not a migration that runs once. It is the definition of what these
 * records mean: if the aggregates and the orders ever disagree, the orders are
 * right and this makes it so. It is also how records appear for orders placed
 * before any of this existed.
 *
 * Orders are replayed oldest first so that first and last order dates land the
 * right way round.
 */
async function rebuild({ onProgress } = {}) {
  await Customer.deleteMany({});

  const cursor = Order.find({}).sort({ createdAt: 1 }).cursor();
  let processed = 0;

  for await (const order of cursor) {
    // eslint-disable-next-line no-await-in-loop
    await recordOrder(order);
    if (COUNTER_FOR_STATUS[order.status]) {
      // eslint-disable-next-line no-await-in-loop
      await recordOutcome(order);
    }

    processed += 1;
    if (onProgress && processed % 100 === 0) onProgress(processed);
  }

  return { orders: processed, customers: await Customer.countDocuments() };
}

module.exports = { recordOrder, recordOutcome, summaryForReseller, rebuild, MAX_VARIANTS };
