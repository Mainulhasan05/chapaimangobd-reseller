'use strict';

const bcrypt = require('bcryptjs');
const { connect, disconnect } = require('../config/db');

const User = require('../models/User');
const ResellerProfile = require('../models/ResellerProfile');
const Source = require('../models/Source');
const Product = require('../models/Product');
const ResellerProduct = require('../models/ResellerProduct');
const DeliveryZone = require('../models/DeliveryZone');

const seedOwner = require('./seedOwner');
const { normalizeBdPhone } = require('../utils/phone');
const { toPoisha } = require('../utils/money');
const { toMilli } = require('../utils/quantity');
const { ROLES, KYC_STATUS } = require('../domain/constants');

/**
 * Enough data to walk the manual verification in docs/PLAN.md end to end.
 * Idempotent, so it can be re-run against an existing development database.
 */
async function seedDemo() {
  await seedOwner();

  const zones = [
    { name: 'চাঁপাইনবাবগঞ্জ', districts: ['Chapainawabganj'], charge: 60 },
    { name: 'ঢাকার ভিতরে', districts: ['Dhaka'], charge: 80 },
    {
      name: 'ঢাকার বাইরে',
      districts: ['Rajshahi', 'Chattogram', 'Khulna', 'Sylhet', 'Rangpur', 'Barishal', 'Mymensingh'],
      charge: 140,
    },
  ];

  for (const zone of zones) {
    // eslint-disable-next-line no-await-in-loop
    await DeliveryZone.findOneAndUpdate(
      { name: zone.name },
      {
        $setOnInsert: {
          name: zone.name,
          districts: zone.districts,
          chargePoisha: toPoisha(zone.charge),
          isActive: true,
        },
      },
      { upsert: true }
    );
  }

  /*
   * Two sources, not one. A source is chosen per order line at accept, so a
   * demo with a single orchard would never exercise the case the field exists
   * for: one order collected from two different places.
   */
  const sourceSeeds = [
    { name: 'কানসাট আম বাজার', address: 'Kansat, Shibganj, Chapainawabganj', phone: '01711111111' },
    { name: 'ভোলাহাট বাগান', address: 'Bholahat, Chapainawabganj', phone: '01711111112' },
  ];

  for (const seed of sourceSeeds) {
    // eslint-disable-next-line no-await-in-loop
    await Source.findOneAndUpdate(
      { name: seed.name },
      {
        $setOnInsert: {
          name: seed.name,
          address: seed.address,
          phoneE164: normalizeBdPhone(seed.phone),
        },
      },
      { upsert: true, new: true }
    );
  }

  /*
   * Two box sizes each, which is how mangoes actually leave: a six-kilo box and
   * an eleven-kilo box, priced per box and counted per box. See docs/adr/0021.
   */
  const products = [
    {
      name: 'হিমসাগর আম',
      boxes: [
        { content: 6, cost: 330, max: 540, stock: 60 },
        { content: 11, cost: 600, max: 990, stock: 25 },
      ],
    },
    {
      name: 'ল্যাংড়া আম',
      boxes: [
        { content: 6, cost: 372, max: 600, stock: 40 },
        { content: 11, cost: 680, max: 1100, stock: 18 },
      ],
    },
    {
      // Untracked stock, to exercise the other branch.
      name: 'আম্রপালি আম',
      boxes: [
        { content: 6, cost: 420, max: null, stock: 0 },
        { content: 11, cost: 770, max: null, stock: 0 },
      ],
      trackStock: false,
    },
  ];

  const created = [];
  for (const p of products) {
    // eslint-disable-next-line no-await-in-loop
    const product = await Product.findOneAndUpdate(
      { nameBn: p.name },
      {
        $setOnInsert: {
          nameBn: p.name,
          unit: 'kg',
          trackStock: p.trackStock !== false,
          variants: p.boxes.map((box, i) => ({
            contentMilli: toMilli(box.content),
            costPricePoisha: toPoisha(box.cost),
            maxSellPricePoisha: box.max == null ? null : toPoisha(box.max),
            stockQty: box.stock,
            isAvailable: true,
            sortOrder: i,
          })),
          isAvailable: true,
        },
      },
      { upsert: true, new: true }
    );
    created.push(product);
  }

  // A reseller who has passed KYC and has an open shop.
  const phoneE164 = normalizeBdPhone('01811111111');
  let reseller = await User.findOne({ phoneE164 });
  if (!reseller) {
    reseller = await User.create({
      name: 'Demo Reseller',
      phoneE164,
      passwordHash: await bcrypt.hash('reseller123', 12),
      role: ROLES.RESELLER,
    });
  }

  const profile = await ResellerProfile.findOneAndUpdate(
    { user: reseller._id },
    {
      $setOnInsert: {
        user: reseller._id,
        shopName: 'Demo Mango Shop',
        slug: 'demo-mango',
        // Verified, and asked to be: the demo shows the module switched on.
        kycRequired: true,
        kycStatus: KYC_STATUS.APPROVED,
        formActive: true,
        creditLimitPoisha: toPoisha(5000),
      },
    },
    { upsert: true, new: true }
  );

  // Priced, and therefore listed on the public form.
  for (const product of created) {
    // eslint-disable-next-line no-await-in-loop
    await ResellerProduct.findOneAndUpdate(
      { reseller: profile._id, product: product._id },
      {
        $setOnInsert: {
          reseller: profile._id,
          product: product._id,
          // A price per box, a little over what the owner charges for it.
          variants: product.variants.map((variant) => ({
            variant: variant._id,
            sellPricePoisha: variant.costPricePoisha + toPoisha(60),
            isListed: true,
          })),
          isListed: true,
        },
      },
      { upsert: true }
    );
  }

  return {
    shopUrl: `/r/${profile.slug}`,
    resellerLogin: { phone: '01811111111', password: 'reseller123' },
    products: created.length,
  };
}

if (require.main === module) {
  connect()
    .then(seedDemo)
    .then(async (result) => {
      // eslint-disable-next-line no-console
      console.log('[seed] demo data ready');
      // eslint-disable-next-line no-console
      console.log(`[seed] shop: ${result.shopUrl}`);
      // eslint-disable-next-line no-console
      console.log(
        `[seed] reseller login: ${result.resellerLogin.phone} / ${result.resellerLogin.password}`
      );
      await disconnect();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('[seed] failed:', err.message);
      await disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = seedDemo;
