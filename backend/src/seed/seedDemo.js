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

  const source = await Source.findOneAndUpdate(
    { name: 'কানসাট আম বাজার' },
    {
      $setOnInsert: {
        name: 'কানসাট আম বাজার',
        address: 'Kansat, Shibganj, Chapainawabganj',
        phoneE164: normalizeBdPhone('01711111111'),
      },
    },
    { upsert: true, new: true }
  );

  const products = [
    { name: 'হিমসাগর আম', cost: 55, min: 5, max: 90, stock: 500 },
    { name: 'ল্যাংড়া আম', cost: 62, min: 5, max: 100, stock: 300 },
    { name: 'আম্রপালি আম', cost: 70, min: 5, max: null, stock: null },
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
          qtyStepMilli: toMilli(0.5),
          minOrderQtyMilli: toMilli(p.min),
          costPricePoisha: toPoisha(p.cost),
          maxSellPricePoisha: p.max == null ? null : toPoisha(p.max),
          trackStock: p.stock != null,
          stockQtyMilli: p.stock == null ? 0 : toMilli(p.stock),
          isAvailable: true,
          source: source._id,
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
          sellPricePoisha: product.costPricePoisha + toPoisha(7),
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
