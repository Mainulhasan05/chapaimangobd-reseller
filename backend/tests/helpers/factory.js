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
  // Off, as it is in production: the owner asks one reseller at a time, and a
  // test about the KYC gate says so rather than getting it by default.
  // See docs/adr/0017.
  kycRequired = false,
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
    kycRequired,
    kycStatus,
    formActive,
    creditLimitPoisha: toPoisha(creditLimit),
  });

  return { user, profile, phone, password };
}

/**
 * A product and the boxes it is sold in. See docs/adr/0021.
 *
 * `boxes` is the full list where a test is about the boxes themselves:
 * `boxes: [{ content: 6, cost: 330 }, { content: 11, cost: 600 }]`. Prices are
 * per box, in taka, and `stockQty` is a count of boxes.
 *
 * Without it, one box holding a single unit at `cost`. That is deliberately the
 * arithmetic the loose-quantity catalog had: a one-kilo box at 55 taka ordered
 * five times costs what five kilos at 55 used to, so the money tests around it
 * assert the same figures they always did and say what they always said. A test
 * that cares about box sizes passes `boxes` and means it.
 */
async function makeProduct({
  name = 'হিমসাগর আম',
  cost = 55,
  content = 1,
  maxSellPrice = null,
  stockQty = 0,
  boxes = [{ content, cost, maxSellPrice, stockQty }],
  trackStock = false,
  unit = 'kg',
} = {}) {
  return Product.create({
    nameBn: name,
    unit,
    trackStock,
    variants: boxes.map((box, i) => ({
      label: box.label || '',
      contentMilli: toMilli(box.content),
      costPricePoisha: toPoisha(box.cost),
      maxSellPricePoisha: box.maxSellPrice == null ? null : toPoisha(box.maxSellPrice),
      stockQty: trackStock ? (box.stockQty ?? 0) : 0,
      isAvailable: box.isAvailable !== false,
      sortOrder: i,
    })),
    isAvailable: true,
  });
}

/** A collection point. Chosen per order line at accept, never on the product. */
const makeSource = ({ name = 'Test Source', ...rest } = {}) => Source.create({ name, ...rest });

/**
 * The accept payload: one source for every line on the order.
 *
 * Pass the order as it exists *after* confirm. Confirming rebuilds the items
 * array from live catalog data, so the line ids on the pending order are not the
 * ids the accept has to name.
 */
const sourcesFor = (order, source) =>
  order.items.map((item) => ({ itemId: String(item._id), sourceId: String(source._id) }));

/**
 * This reseller's price for every box of a product.
 *
 * `sellPrice` is a number, applied to every box, or a function of the box for a
 * test that needs them to differ. Per box, in taka.
 */
const listProduct = (profile, product, sellPrice, extra = {}) =>
  ResellerProduct.create({
    reseller: profile._id,
    product: product._id,
    variants: product.variants.map((variant) => ({
      variant: variant._id,
      sellPricePoisha: toPoisha(
        typeof sellPrice === 'function' ? sellPrice(variant) : sellPrice
      ),
      isListed: true,
    })),
    isListed: true,
    ...extra,
  });

/** The first box of a product, which is the one a single-box test means. */
const boxOf = (product, index = 0) => product.variants[index];

/** An order line: this box of this product, this many. */
const boxItem = (product, quantity = 1, index = 0) => ({
  product: String(product._id),
  variant: String(product.variants[index]._id),
  quantity,
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
  makeSource,
  sourcesFor,
  listProduct,
  boxOf,
  boxItem,
  makeZone,
  customer,
};
