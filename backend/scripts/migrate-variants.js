'use strict';

/**
 * Moves an existing database from loose quantities to boxes. See docs/adr/0021.
 *
 * Run once, after deploying the code that understands boxes and before anyone
 * touches the catalog:
 *
 *     node scripts/migrate-variants.js          # report what it would do
 *     node scripts/migrate-variants.js --write  # do it
 *
 * What it does, and the reasoning behind each choice:
 *
 * - **Every product gets one box**, holding what its minimum order used to be,
 *   priced at the old per-unit price times that minimum. A product that sold at
 *   55 taka a kilo with a five-kilo minimum becomes a five-kilo box at 275. The
 *   economics are identical on the day of the migration, which is the only
 *   property worth preserving: the owner then splits it into the sizes they
 *   actually pack.
 * - **Stock converts the same way**, rounded *down* to whole boxes, because a
 *   partial box is not sellable and rounding up would oversell.
 * - **Every reseller price row** gets the matching per-box price, scaled by the
 *   same factor, so nobody's margin moves.
 * - **Orders are not touched at all.** A line is a snapshot and always was; the
 *   readers fall back for a line that names no box.
 *
 * Idempotent: a product that already has boxes is skipped, so a half-finished
 * run is simply repeated.
 */

const mongoose = require('mongoose');
const env = require('../src/config/env');
const Product = require('../src/models/Product');
const ResellerProduct = require('../src/models/ResellerProduct');

const WRITE = process.argv.includes('--write');

/** The old per-unit fields, read raw: the schema no longer declares them. */
async function loadLegacyProducts() {
  return mongoose.connection
    .collection('products')
    .find({ $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }] })
    .toArray();
}

async function run() {
  await mongoose.connect(env.MONGODB_URI);
  const legacy = await loadLegacyProducts();

  if (legacy.length === 0) {
    process.stdout.write('Nothing to migrate: every product already has boxes.\n');
    await mongoose.disconnect();
    return;
  }

  let products = 0;
  let listings = 0;

  for (const doc of legacy) {
    // The old minimum is the smallest thing anyone could buy, so it is the box.
    const contentMilli = doc.minOrderQtyMilli || 1000;
    const factor = contentMilli / 1000;
    const costPricePoisha = Math.round((doc.costPricePoisha || 0) * factor);
    const maxSellPricePoisha =
      doc.maxSellPricePoisha == null ? null : Math.round(doc.maxSellPricePoisha * factor);
    // Down, never up: half a box cannot be sent.
    const stockQty = Math.floor((doc.stockQtyMilli || 0) / contentMilli);

    const variantId = new mongoose.Types.ObjectId();
    const variant = {
      _id: variantId,
      label: '',
      contentMilli,
      costPricePoisha,
      maxSellPricePoisha,
      stockQty,
      isAvailable: true,
      sortOrder: 0,
    };

    process.stdout.write(
      `${doc.nameBn}: one ${contentMilli / 1000} ${doc.unit} box at ` +
        `${(costPricePoisha / 100).toFixed(2)} taka, ${stockQty} in stock\n`
    );

    if (WRITE) {
      await mongoose.connection.collection('products').updateOne(
        { _id: doc._id },
        {
          $set: { variants: [variant] },
          $unset: {
            qtyStepMilli: '',
            minOrderQtyMilli: '',
            costPricePoisha: '',
            maxSellPricePoisha: '',
            stockQtyMilli: '',
          },
        }
      );
    }
    products += 1;

    // The resellers' own prices, scaled by the same factor so no margin moves.
    const rows = await mongoose.connection
      .collection('resellerproducts')
      .find({ product: doc._id, $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }] })
      .toArray();

    for (const row of rows) {
      const priced = {
        variant: variantId,
        sellPricePoisha: Math.round((row.sellPricePoisha || 0) * factor),
        regularPricePoisha:
          row.regularPricePoisha == null ? null : Math.round(row.regularPricePoisha * factor),
        isListed: row.isListed !== false,
      };
      if (WRITE) {
        await mongoose.connection
          .collection('resellerproducts')
          .updateOne(
            { _id: row._id },
            { $set: { variants: [priced] }, $unset: { sellPricePoisha: '', regularPricePoisha: '' } }
          );
      }
      listings += 1;
    }
  }

  process.stdout.write(
    `\n${WRITE ? 'Migrated' : 'Would migrate'} ${products} product(s) and ${listings} price row(s).\n`
  );
  if (!WRITE) process.stdout.write('Re-run with --write to apply.\n');

  await mongoose.disconnect();
}

run().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
