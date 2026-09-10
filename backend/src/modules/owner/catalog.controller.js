'use strict';

const Source = require('../../models/Source');
const Product = require('../../models/Product');
const DeliveryZone = require('../../models/DeliveryZone');
const Order = require('../../models/Order');

const storage = require('../../config/storage');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { notFound, badRequest } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const { toMilli, defaultStepMilli } = require('../../utils/quantity');
const { normalizeBdPhone } = require('../../utils/phone');
const present = require('../../utils/present');

/* ------------------------------------------------------------------- sources */

async function listSources(req, res) {
  const filter = req.query.includeArchived === 'true' ? {} : { isArchived: false };
  const sources = await Source.find(filter).sort({ name: 1 });
  return ok(res, { sources });
}

async function createSource(req, res) {
  const source = await Source.create({
    name: req.body.name,
    address: req.body.address,
    phoneE164: req.body.phone ? normalizeBdPhone(req.body.phone) : undefined,
    note: req.body.note,
  });
  return ok(res, { source }, 201);
}

async function updateSource(req, res) {
  const patch = { ...req.body };
  if (patch.phone !== undefined) {
    patch.phoneE164 = patch.phone ? normalizeBdPhone(patch.phone) : null;
    delete patch.phone;
  }

  const source = await Source.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!source) throw notFound('Source not found');
  return ok(res, { source });
}

/**
 * Archive, never delete. A source referenced by a shipped order has to stay
 * resolvable or the order history stops making sense.
 */
async function archiveSource(req, res) {
  const source = await Source.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: true } },
    { new: true }
  );
  if (!source) throw notFound('Source not found');
  return ok(res, { source });
}

/* ------------------------------------------------------------------ products */

async function listProducts(req, res) {
  const filter = req.query.includeArchived === 'true' ? {} : { isArchived: false };
  const products = await Product.find(filter)
    .sort({ sortOrder: 1, createdAt: -1 })
    .populate('source', 'name');
  return ok(res, { products: products.map(present.product) });
}

function buildProductPatch(body) {
  const patch = {};

  if (body.name !== undefined) patch.nameBn = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.unit !== undefined) patch.unit = body.unit;
  if (body.minOrderQty !== undefined) patch.minOrderQtyMilli = toMilli(body.minOrderQty, 'minOrderQty');
  if (body.step !== undefined) patch.qtyStepMilli = toMilli(body.step, 'step');
  if (body.costPrice !== undefined) patch.costPricePoisha = toPoisha(body.costPrice, 'costPrice');
  if (body.maxSellPrice !== undefined) {
    patch.maxSellPricePoisha =
      body.maxSellPrice === null ? null : toPoisha(body.maxSellPrice, 'maxSellPrice');
  }
  if (body.trackStock !== undefined) patch.trackStock = body.trackStock;
  if (body.stockQty !== undefined) patch.stockQtyMilli = toMilli(body.stockQty, 'stockQty');
  if (body.isAvailable !== undefined) patch.isAvailable = body.isAvailable;
  if (body.source !== undefined) patch.source = body.source;
  if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
  if (body.isArchived !== undefined) patch.isArchived = body.isArchived;

  return patch;
}

async function createProduct(req, res) {
  const patch = buildProductPatch(req.body);
  if (!patch.qtyStepMilli) patch.qtyStepMilli = defaultStepMilli(patch.unit);

  if (patch.maxSellPricePoisha != null && patch.maxSellPricePoisha < patch.costPricePoisha) {
    throw badRequest('BAD_MAX', 'Maximum selling price cannot be below the cost price', {
      maxSellPrice: 'Must be at least the cost price',
    });
  }

  const images = await uploadImages(req.files);
  const product = await Product.create({ ...patch, images });

  await audit.record({
    actor: req.user._id,
    action: 'product.create',
    targetType: 'Product',
    targetId: product._id,
    after: { costPricePoisha: product.costPricePoisha },
    ip: req.ip,
  });

  return ok(res, { product: present.product(product) }, 201);
}

async function updateProduct(req, res) {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw notFound('Product not found');

  const patch = buildProductPatch(req.body);
  const images = await uploadImages(req.files);

  /*
   * Removal is expressed as the keys to drop rather than the list to keep, so a
   * second owner adding a photo from another tab does not have theirs deleted by
   * whoever saves last. Only keys this product actually owns are honoured.
   */
  const requested = new Set(req.body.removeImages || []);
  const removed = existing.images.filter((img) => requested.has(img.key));
  const kept = existing.images.filter((img) => !requested.has(img.key));

  if (images.length > 0 || removed.length > 0) patch.images = [...kept, ...images];

  const nextCost = patch.costPricePoisha ?? existing.costPricePoisha;
  const nextMax = patch.maxSellPricePoisha ?? existing.maxSellPricePoisha;
  if (nextMax != null && nextMax < nextCost) {
    throw badRequest('BAD_MAX', 'Maximum selling price cannot be below the cost price', {
      maxSellPrice: 'Must be at least the cost price',
    });
  }

  const product = await Product.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });

  /*
   * The bucket is reconciled only after the document is, and a failure here is
   * swallowed deliberately. An orphaned object costs a fraction of a paisa a
   * month; failing the request would tell the owner their edit did not save when
   * it did, and the retry would then delete an image that is already gone.
   */
  await Promise.all(
    removed.map((img) =>
      storage.destroy(img.key).catch(() => {
        /* orphaned in the bucket, already detached from the product */
      })
    )
  );

  // A cost price change is the kind of thing that gets argued about later.
  if (patch.costPricePoisha !== undefined && patch.costPricePoisha !== existing.costPricePoisha) {
    await audit.record({
      actor: req.user._id,
      action: 'product.reprice',
      targetType: 'Product',
      targetId: product._id,
      before: { costPricePoisha: existing.costPricePoisha },
      after: { costPricePoisha: product.costPricePoisha },
      ip: req.ip,
    });
  }

  return ok(res, { product: present.product(product) });
}

/**
 * Only the storage key is kept. The delivery URL is derived when the product is
 * presented, so moving the bucket to a different domain does not orphan every
 * image already saved against the old one.
 */
async function uploadImages(files) {
  if (!files || files.length === 0) return [];

  const uploads = await Promise.all(
    files.map((file) =>
      storage.uploadBuffer(file.buffer, {
        folder: storage.FOLDERS.PRODUCT,
        contentType: file.mimetype,
      })
    )
  );
  return uploads.map((u) => ({ key: u.key }));
}

async function archiveProduct(req, res) {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: true, isAvailable: false } },
    { new: true }
  );
  if (!product) throw notFound('Product not found');
  return ok(res, { product: present.product(product) });
}

/* --------------------------------------------------------------------- zones */

async function listZones(_req, res) {
  const zones = await DeliveryZone.find().sort({ sortOrder: 1, name: 1 });
  return ok(res, {
    zones: zones.map((z) => ({
      id: z._id,
      name: z.name,
      districts: z.districts,
      charge: toTaka(z.chargePoisha),
      isActive: z.isActive,
      sortOrder: z.sortOrder,
    })),
  });
}

/** A district may belong to only one zone, or the charge would be ambiguous. */
async function assertDistrictsFree(districts, excludeId) {
  const clash = await DeliveryZone.findOne({
    isActive: true,
    districts: { $in: districts },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) {
    throw badRequest('DISTRICT_TAKEN', `Some districts are already in the zone ${clash.name}`, {
      districts: `Already covered by ${clash.name}`,
    });
  }
}

async function createZone(req, res) {
  await assertDistrictsFree(req.body.districts);
  const zone = await DeliveryZone.create({
    name: req.body.name,
    districts: req.body.districts,
    chargePoisha: toPoisha(req.body.charge, 'charge'),
    isActive: req.body.isActive ?? true,
    sortOrder: req.body.sortOrder ?? 0,
  });
  return ok(res, { zone }, 201);
}

async function updateZone(req, res) {
  const patch = {};
  if (req.body.name !== undefined) patch.name = req.body.name;
  if (req.body.districts !== undefined) {
    await assertDistrictsFree(req.body.districts, req.params.id);
    patch.districts = req.body.districts;
  }
  if (req.body.charge !== undefined) patch.chargePoisha = toPoisha(req.body.charge, 'charge');
  if (req.body.isActive !== undefined) patch.isActive = req.body.isActive;
  if (req.body.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;

  const zone = await DeliveryZone.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!zone) throw notFound('Zone not found');
  return ok(res, { zone });
}

async function deleteZone(req, res) {
  const inUse = await Order.exists({ deliveryZone: req.params.id });
  if (inUse) {
    // Deactivate instead, so historical orders keep resolving.
    const zone = await DeliveryZone.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );
    return ok(res, { zone, deactivated: true });
  }

  await DeliveryZone.deleteOne({ _id: req.params.id });
  return ok(res, { deleted: true });
}

module.exports = {
  listSources,
  createSource,
  updateSource,
  archiveSource,
  listProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  listZones,
  createZone,
  updateZone,
  deleteZone,
};
