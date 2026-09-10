'use strict';

const bcrypt = require('bcryptjs');

const User = require('../../src/models/User');
const ResellerProfile = require('../../src/models/ResellerProfile');
const Source = require('../../src/models/Source');
const Product = require('../../src/models/Product');
const ResellerProduct = require('../../src/models/ResellerProduct');
const DeliveryZone = require('../../src/models/DeliveryZone');

const { toPoisha } = require('../../src/utils/money');
const { toMilli } = require('../../src/utils/quantity');
const { normalizeBdPhone } = require('../../src/utils/phone');
const { ROLES, KYC_STATUS } = require('../../src/domain/constants');

let phoneCounter = 0;
/** A fresh valid Bangladeshi mobile number per call. */
function nextPhone() {
  phoneCounter += 1;
  return `018${String(10000000 + phoneCounter).slice(0, 8)}`;
}

async function makeOwner({ password = 'ownerpass123' } = {}) {
  const phone = nextPhone();
  const user = await User.create({
    name: 'Owner',
    phoneE164: normalizeBdPhone(phone),
    passwordHash: await bcrypt.hash(password, 4),
    role: ROLES.OWNER,
  });
  return { user, phone, password };
}

async function makeReseller({
  password = 'reseller123',
  kycStatus = KYC_STATUS.APPROVED,
  formActive = true,
  creditLimit = 0,
  slug,
} = {}) {
  const phone = nextPhone();
  const user = await User.create({
    name: 'Reseller',
    phoneE164: normalizeBdPhone(phone),
    passwordHash: await bcrypt.hash(password, 4),
    role: ROLES.RESELLER,
  });

  const profile = await ResellerProfile.create({
    user: user._id,
    shopName: 'Test Shop',
    slug: slug || `shop-${user._id.toString().slice(-6)}`,
    kycStatus,
    formActive,
    creditLimitPoisha: toPoisha(creditLimit),
  });

  return { user, profile, phone, password };
}

async function makeProduct({
  name = 'হিমসাগর আম',
  cost = 55,
  minOrderQty = 5,
  step = 0.5,
  maxSellPrice = null,
  trackStock = false,
  stockQty = 0,
  unit = 'kg',
} = {}) {
  const source = await Source.create({ name: 'Test Source' });

  return Product.create({
    nameBn: name,
    unit,
    qtyStepMilli: toMilli(step),
    minOrderQtyMilli: toMilli(minOrderQty),
    costPricePoisha: toPoisha(cost),
    maxSellPricePoisha: maxSellPrice == null ? null : toPoisha(maxSellPrice),
    trackStock,
    stockQtyMilli: trackStock ? toMilli(stockQty) : 0,
    isAvailable: true,
    source: source._id,
  });
}

const listProduct = (profile, product, sellPrice, extra = {}) =>
  ResellerProduct.create({
    reseller: profile._id,
    product: product._id,
    sellPricePoisha: toPoisha(sellPrice),
    isListed: true,
    ...extra,
  });

const makeZone = ({ name = 'Test Zone', districts = ['Dhaka'], charge = 80 } = {}) =>
  DeliveryZone.create({ name, districts, chargePoisha: toPoisha(charge), isActive: true });

/** The customer payload the public form and manual orders both take. */
const customer = (overrides = {}) => ({
  name: 'Test Customer',
  phone: '01912345678',
  address: '12 Test Road, Dhanmondi',
  district: 'Dhaka',
  ...overrides,
});

module.exports = {
  nextPhone,
  makeOwner,
  makeReseller,
  makeProduct,
  listProduct,
  makeZone,
  customer,
};
