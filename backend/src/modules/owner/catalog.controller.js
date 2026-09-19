'use strict';

const Source = require('../../models/Source');
const Product = require('../../models/Product');
const DeliveryZone = require('../../models/DeliveryZone');
const Order = require('../../models/Order');

const imageService = require('../../services/images');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { notFound, badRequest } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const { toMilli } = require('../../utils/quantity');
const { assertDistinctContents } = require('../../domain/variants');
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

  const existing = await Source.findById(req.params.id);
  if (!existing) throw notFound('Source not found');

  const source = await Source.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!source) throw notFound('Source not found');

  if (patch.isArchived !== undefined && Boolean(existing.isArchived) !== Boolean(source.isArchived)) {
    await auditArchive(req, 'Source', source, existing.isArchived, source.isArchived);
  }
  return ok(res, { source });
}

/** Archiving and restoring retire things orders refer to, so both are recorded. */
function auditArchive(req, targetType, doc, wasArchived, isArchived) {
  return audit.record({
    actor: req.user._id,
    action: `${targetType.toLowerCase()}.${isArchived ? 'archive' : 'unarchive'}`,
    targetType,
    targetId: doc._id,
    before: { isArchived: Boolean(wasArchived) },
    after: { isArchived: Boolean(isArchived) },
    ip: req.ip,
  });
}

/**
 * Archive, never delete. A source referenced by a shipped order has to stay
 * resolvable or the order history stops making sense.
 */
async function archiveSource(req, res) {
  const existing = await Source.findById(req.params.id);
  if (!existing) throw notFound('Source not found');

  const source = await Source.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: true } },
    { new: true }
  );
  if (!source) throw notFound('Source not found');
  if (!existing.isArchived) await auditArchive(req, 'Source', source, false, true);
  return ok(res, { source });
}

/* ------------------------------------------------------------------ products */

async function listProducts(req, res) {
  const filter = req.query.includeArchived === 'true' ? {} : { isArchived: false };
  const products = await Product.find(filter).sort({ sortOrder: 1, createdAt: -1 });
  return ok(res, { products: products.map(present.product) });
}

/**
 * The boxes, as the owner sent them, converted to what is stored.
 *
 * The whole list every time, not a patch per box: a reorder, an added box and a
 * removed one are all simply the new list, which is the same rule the landing
 * content follows and it means no index arithmetic anywhere. A box that carries
 * an `id` keeps it, so the order lines and the reseller price rows pointing at
 * it stay pointed at it. See domain/variants.js and docs/adr/0021.
 */
function buildVariants(input, { index = 0 } = {}) {
  const variants = input.map((variant, i) => {
    const costPricePoisha = toPoisha(variant.costPrice, `variants.${i}.costPrice`);
    const maxSellPricePoisha =
      variant.maxSellPrice == null
        ? null
        : toPoisha(variant.maxSellPrice, `variants.${i}.maxSellPrice`);

    if (maxSellPricePoisha != null && maxSellPricePoisha < costPricePoisha) {
      throw badRequest('BAD_MAX', 'Maximum selling price cannot be below the cost price', {
        [`variants.${i}.maxSellPrice`]: 'Must be at least the cost price',
      });
    }

    return {
      ...(variant.id ? { _id: variant.id } : {}),
      label: variant.label || '',
      contentMilli: toMilli(variant.content, `variants.${i}.content`),
      costPricePoisha,
      maxSellPricePoisha,
      stockQty: variant.stockQty ?? 0,
      isAvailable: variant.isAvailable ?? true,
      sortOrder: variant.sortOrder ?? index + i,
    };
  });

  assertDistinctContents(variants);
  return variants;
}

function buildProductPatch(body) {
  const patch = {};

  if (body.name !== undefined) patch.nameBn = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.unit !== undefined) patch.unit = body.unit;
  if (body.variants !== undefined) patch.variants = buildVariants(body.variants);
  if (body.trackStock !== undefined) patch.trackStock = body.trackStock;
  if (body.isAvailable !== undefined) patch.isAvailable = body.isAvailable;
  if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
  if (body.isArchived !== undefined) patch.isArchived = body.isArchived;

  return patch;
}

/** Every box's cost, for the audit log. A product has no single price any more. */
const variantCosts = (product) =>
  (product.variants || []).map((v) => ({
    variant: String(v._id),
    contentMilli: v.contentMilli,
    costPricePoisha: v.costPricePoisha,
  }));

async function createProduct(req, res) {
  const patch = buildProductPatch(req.body);

  const images = await uploadImages(req.files);
  const product = await Product.create({ ...patch, images });

  await audit.record({
    actor: req.user._id,
    action: 'product.create',
    targetType: 'Product',
    targetId: product._id,
    after: { variants: variantCosts(product) },
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
  // Addressed by handle, which is the ImgBB id or, for an image saved before
  // ImgBB, the R2 key. Only handles this product actually owns are honoured.
  const owns = (img) => requested.has(img.id) || (img.key && requested.has(img.key));
  const removed = existing.images.filter(owns);
  const kept = existing.images.filter((img) => !owns(img));

  if (images.length > 0 || removed.length > 0) patch.images = [...kept, ...images];

  /*
   * A box that has ever been ordered is switched off, never dropped.
   *
   * The same rule as archiving a product or a source, and for the same reason:
   * the pick list groups by box, a pending order is repriced from the live one
   * at confirm, and a deleted box turns both into a dead end. The owner's intent
   * is honoured either way - the box leaves every form - but the row stays.
   */
  if (patch.variants) {
    const kept = new Set(patch.variants.filter((v) => v._id).map((v) => String(v._id)));
    const dropped = existing.variants.filter((v) => !kept.has(String(v._id)));
    const ordered = await Promise.all(
      dropped.map((v) => Order.exists({ 'items.variant': v._id }))
    );
    dropped.forEach((variant, i) => {
      if (!ordered[i]) return;
      patch.variants.push({ ...variant.toObject(), isAvailable: false });
    });
  }

  const product = await Product.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });

  /*
   * The host is reconciled only after the document is, and a failure here is
   * swallowed deliberately. An orphaned object costs a fraction of a paisa a
   * month; failing the request would tell the owner their edit did not save when
   * it did, and the retry would then delete an image that is already gone.
   *
   * For an ImgBB image this detaches and nothing more. ImgBB has no delete API,
   * so a photo removed from a product stops being shown but its link keeps
   * resolving for anyone who already has it.
   */
  await imageService.removeMany(removed);

  if (patch.isArchived !== undefined && Boolean(existing.isArchived) !== Boolean(product.isArchived)) {
    await auditArchive(req, 'Product', product, existing.isArchived, product.isArchived);
  }

  // A cost price change is the kind of thing that gets argued about later. The
  // whole set of boxes is recorded, because which box moved is the question.
  const before = variantCosts(existing);
  const after = variantCosts(product);
  if (patch.variants !== undefined && JSON.stringify(before) !== JSON.stringify(after)) {
    await audit.record({
      actor: req.user._id,
      action: 'product.reprice',
      targetType: 'Product',
      targetId: product._id,
      before: { variants: before },
      after: { variants: after },
      ip: req.ip,
    });
  }

  return ok(res, { product: present.product(product) });
}

/**
 * Product photographs go to the public image host, never to the private bucket.
 *
 * The whole record comes back rather than a key, because an ImgBB URL cannot be
 * derived from anything we hold. `services/images.js` decides the destination;
 * this only has to say what kind of image it is handing over.
 */
async function uploadImages(files) {
  return imageService.uploadManyPublic(files, { kind: imageService.KINDS.PRODUCT });
}

async function archiveProduct(req, res) {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw notFound('Product not found');

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: true, isAvailable: false } },
    { new: true }
  );
  if (!product) throw notFound('Product not found');
  if (!existing.isArchived) await auditArchive(req, 'Product', product, false, true);
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

  const existing = await DeliveryZone.findById(req.params.id);
  if (!existing) throw notFound('Zone not found');

  const zone = await DeliveryZone.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!zone) throw notFound('Zone not found');

  // Switching a zone off stops every district in it from ordering.
  if (patch.isActive !== undefined && existing.isActive !== zone.isActive) {
    await audit.record({
      actor: req.user._id,
      action: zone.isActive ? 'zone.activate' : 'zone.deactivate',
      targetType: 'DeliveryZone',
      targetId: zone._id,
      before: { isActive: existing.isActive },
      after: { isActive: zone.isActive },
      ip: req.ip,
    });
  }
  return ok(res, { zone });
}

async function deleteZone(req, res) {
  const existing = await DeliveryZone.findById(req.params.id);
  if (!existing) throw notFound('Zone not found');

  const snapshotZone = {
    name: existing.name,
    districts: existing.districts,
    chargePoisha: existing.chargePoisha,
    isActive: existing.isActive,
  };

  const inUse = await Order.exists({ deliveryZone: req.params.id });
  if (inUse) {
    // Deactivate instead, so historical orders keep resolving.
    const zone = await DeliveryZone.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );
    if (existing.isActive) {
      await audit.record({
        actor: req.user._id,
        action: 'zone.deactivate',
        targetType: 'DeliveryZone',
        targetId: existing._id,
        before: snapshotZone,
        after: { isActive: false },
        ip: req.ip,
      });
    }
    return ok(res, { zone, deactivated: true });
  }

  await DeliveryZone.deleteOne({ _id: req.params.id });
  await audit.record({
    actor: req.user._id,
    action: 'zone.delete',
    targetType: 'DeliveryZone',
    targetId: existing._id,
    before: snapshotZone,
    after: null,
    ip: req.ip,
  });
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
