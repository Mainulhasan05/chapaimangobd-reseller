'use strict';

const Source = require('../../models/Source');
const Product = require('../../models/Product');
const DeliveryZone = require('../../models/DeliveryZone');
const Order = require('../../models/Order');

const imageService = require('../../services/images');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { notFound, badRequest, conflict } = require('../../utils/errors');
const { toPoisha, toTaka } = require('../../utils/money');
const { toMilli, fromMilli } = require('../../utils/quantity');
const { assertDistinctContents, findVariant, MAX_VARIANTS } = require('../../domain/variants');
const { assertRecipe } = require('../../domain/packaging');
const Supply = require('../../models/Supply');
const { normalizeBdPhone } = require('../../utils/phone');
const present = require('../../utils/present');

/* ------------------------------------------------------------------- sources */

/**
 * Live ones by default. `includeArchived=true` adds the archived ones beside
 * them; `archived=only` is the "সরিয়ে রাখা" filter, where restoring happens.
 */
function archiveFilter(query) {
  if (query.archived === 'only') return { isArchived: true };
  return query.includeArchived === 'true' ? {} : { isArchived: false };
}

async function listSources(req, res) {
  const sources = await Source.find(archiveFilter(req.query)).sort({ name: 1 });
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
  const products = await Product.find(archiveFilter(req.query)).sort({
    sortOrder: 1,
    createdAt: -1,
  });
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
      // Only honoured for a new box. An existing box keeps the count it has;
      // see `keepStoredFields` and the stock endpoint.
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

/**
 * What an edit of the boxes never overwrites on a box that already exists: its
 * stock count and its packaging recipe.
 *
 * Both have their own endpoints and neither is on the product form. The count
 * used to be taken from the form, which meant a form opened at ten boxes and
 * saved after two orders had confirmed put the two boxes back on the shelf. The
 * recipe was simply missing from what the form sent, so every product edit
 * erased every recipe on it. A new box, which has neither, takes what was sent.
 */
function keepStoredFields(variants, existing) {
  const stored = new Map(existing.variants.map((v) => [String(v._id), v]));
  variants.forEach((variant) => {
    const current = variant._id ? stored.get(String(variant._id)) : null;
    if (!current) return;
    variant.stockQty = current.stockQty;
    variant.packaging = (current.packaging || []).map((row) => ({
      supply: row.supply,
      qtyMilli: row.qtyMilli,
    }));
  });
}

/**
 * The filter an edit is written under: this product, at the version it was read
 * at, with every box still holding the count it was read with.
 *
 * Two guards because there are two kinds of writer. Every owner write to a
 * product — an edit, a stock change, a recipe, a cover — bumps `__v`, so a
 * recipe saved or a photo added from another tab between this read and this
 * write is noticed rather than overwritten. A confirm takes stock with an atomic
 * $inc and no version bump, which is what the count check is for: without it the
 * edit could put back what that order had just taken. Either way nothing is
 * written and the edit is rebuilt from a fresh read.
 */
const unchanged = (existing) => {
  const filter = { _id: existing._id, __v: existing.__v ?? null };
  if (existing.variants.length > 0) {
    filter.variants = {
      $all: existing.variants.map((v) => ({
        $elemMatch: { _id: v._id, stockQty: v.stockQty },
      })),
    };
  }
  return filter;
};

/**
 * A box that is kept because it was ordered may not collide with what was sent.
 *
 * Kept boxes are put back after the sent list was checked, so a new five-kilo box
 * sent beside a dropped-but-ordered five-kilo box would have produced two of the
 * same box, and enough kept boxes could pass the ceiling. Refused with a field
 * error on the box that was sent, which is the one the owner can change.
 */
function assertKeptBoxesFit(variants, keptCount) {
  const sentCount = variants.length - keptCount;
  const kept = variants.slice(sentCount);
  kept.forEach((box) => {
    const clash = variants.slice(0, sentCount).findIndex((v) => v.contentMilli === box.contentMilli);
    if (clash === -1) return;
    const message =
      'A box of this size has orders, so it is kept (switched off). Switch that one back on instead';
    throw badRequest('DUPLICATE_VARIANT', message, { [`variants.${clash}.content`]: message });
  });
  if (variants.length > MAX_VARIANTS) {
    const message = `A product can have at most ${MAX_VARIANTS} boxes, counting the ones kept because they have orders`;
    throw badRequest('TOO_MANY_VARIANTS', message, { variants: message });
  }
}

/** How many times an edit is rebuilt after an order moved a stock count under it. */
const EDIT_ATTEMPTS = 5;

async function updateProduct(req, res) {
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

  let existing;
  let patch;
  let removed;
  let product = null;

  for (let attempt = 1; !product; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    existing = await Product.findById(req.params.id);
    if (!existing) throw notFound('Product not found');

    patch = buildProductPatch(req.body);
    removed = existing.images.filter(owns);
    const kept = existing.images.filter((img) => !owns(img));
    if (images.length > 0 || removed.length > 0) patch.images = [...kept, ...images];

    if (patch.variants) {
      keepStoredFields(patch.variants, existing);

      /*
       * A box that has ever been ordered is switched off, never dropped.
       *
       * The same rule as archiving a product or a source, and for the same reason:
       * the pick list groups by box, a pending order is repriced from the live one
       * at confirm, and a deleted box turns both into a dead end. The owner's intent
       * is honoured either way - the box leaves every form - but the row stays.
       */
      const sent = new Set(patch.variants.filter((v) => v._id).map((v) => String(v._id)));
      const dropped = existing.variants.filter((v) => !sent.has(String(v._id)));
      // eslint-disable-next-line no-await-in-loop
      const ordered = await Promise.all(
        dropped.map((v) => Order.exists({ 'items.variant': v._id }))
      );
      let keptCount = 0;
      dropped.forEach((variant, i) => {
        if (!ordered[i]) return;
        patch.variants.push({ ...variant.toObject(), isAvailable: false });
        keptCount += 1;
      });
      assertKeptBoxesFit(patch.variants, keptCount);
    }

    // eslint-disable-next-line no-await-in-loop
    product = await Product.findOneAndUpdate(
      unchanged(existing),
      { $set: patch, $inc: { __v: 1 } },
      { new: true }
    );

    if (!product && attempt >= EDIT_ATTEMPTS) {
      throw conflict('ALREADY_HANDLED', 'This product was just changed by someone else');
    }
  }

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

/**
 * Brings an archived product back into the catalog, switched off.
 *
 * Off rather than on, because archiving switched it off and nothing remembers
 * whether it was on before: a product that reappeared on every reseller's form
 * the moment it was restored would be a surprise to the owner and to customers.
 * Restoring is a decision to keep it; selling it again is a second one.
 */
async function restoreProduct(req, res) {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw notFound('Product not found');

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { isArchived: false } },
    { new: true }
  );
  if (!product) throw notFound('Product not found');
  if (existing.isArchived) await auditArchive(req, 'Product', product, true, false);
  return ok(res, { product: present.product(product) });
}

/**
 * Sets or adds to one box's stock count: "there are forty" or "twenty more came".
 *
 * The only way a count changes besides an order, and an atomic one. A set is the
 * count somebody just took; an add is a delivery or a correction, and may be
 * negative, but never below zero, because a count of minus three boxes is a typo
 * rather than a shelf. The edit form never carries stock for an existing box any
 * more; see `keepStoredFields`.
 *
 * `nonce`, when sent, makes the request safe to repeat: it is checked and
 * recorded in the same update as the count (see `stockNonces` on Product), so a
 * retry after a lost response answers with the product as it is and changes
 * nothing. Without one the request is applied every time it arrives.
 */
async function setVariantStock(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product not found');
  const variant = findVariant(product, req.params.variantId);
  if (!variant) throw notFound('Box not found on this product');
  if (!product.trackStock) {
    throw badRequest('STOCK_NOT_TRACKED', 'Turn on stock tracking for this product first');
  }

  const { set, add, nonce } = req.body;
  const filter = { _id: product._id, 'variants._id': variant._id };
  if (add !== undefined && add < 0) {
    filter.variants = { $elemMatch: { _id: variant._id, stockQty: { $gte: -add } } };
  }
  if (nonce) filter.stockNonces = { $ne: nonce };

  const update =
    set !== undefined
      ? { $set: { 'variants.$[box].stockQty': set } }
      : { $inc: { 'variants.$[box].stockQty': add } };
  update.$inc = { ...(update.$inc || {}), __v: 1 };
  if (nonce) update.$push = { stockNonces: { $each: [nonce], $slice: -STOCK_NONCES_KEPT } };

  const before = await Product.findOneAndUpdate(filter, update, {
    new: false,
    arrayFilters: [{ 'box._id': variant._id }],
  });

  if (!before) {
    const now = await Product.findById(product._id).select('+stockNonces');
    const box = findVariant(now, variant._id);
    if (!box) throw notFound('Box not found on this product');
    // Already applied: this is the retry of a request whose answer was lost.
    if (nonce && (now.stockNonces || []).includes(nonce)) {
      return ok(res, { product: present.product(now), replayed: true });
    }
    throw conflict('STOCK_BELOW_ZERO', `Only ${box.stockQty} box(es) are in stock`);
  }

  const was = findVariant(before, variant._id).stockQty;
  const fresh = await Product.findById(product._id);

  await audit.record({
    actor: req.user._id,
    action: 'product.stock',
    targetType: 'Product',
    targetId: product._id,
    before: { variantId: String(variant._id), stockQty: was },
    after: {
      variantId: String(variant._id),
      stockQty: findVariant(fresh, variant._id).stockQty,
      ...(set !== undefined ? { set } : { add }),
    },
    ip: req.ip,
  });

  return ok(res, { product: present.product(fresh), replayed: false });
}

/** How many recent stock request keys a product remembers. */
const STOCK_NONCES_KEPT = 50;

/**
 * Makes one photo the product's cover: the first image, the one every shop
 * shows on the product card.
 *
 * The only way to change the cover used to be deleting the photos in front of
 * it and uploading them again. The write lands only if the photo still sits
 * where it was read, so a photo removed or added from another tab meanwhile is
 * never put back or dropped by this reorder.
 */
async function setProductCover(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product not found');

  // The path form is the original; the body form is what the product screen sends.
  const handle = req.params.imageId || (req.body && req.body.imageId);
  const index = product.images.findIndex((img) => img.id === handle || img.key === handle);
  if (index === -1) throw notFound('Photo not found on this product');
  if (index === 0) return ok(res, { product: present.product(product) });

  const reordered = [product.images[index], ...product.images.filter((_img, i) => i !== index)];
  const updated = await Product.findOneAndUpdate(
    {
      _id: product._id,
      images: { $size: product.images.length },
      $or: [{ [`images.${index}.id`]: handle }, { [`images.${index}.key`]: handle }],
    },
    { $set: { images: reordered }, $inc: { __v: 1 } },
    { new: true }
  );
  if (!updated) throw conflict('ALREADY_HANDLED', 'The photos were just changed by someone else');

  await audit.record({
    actor: req.user._id,
    action: 'product.cover',
    targetType: 'Product',
    targetId: product._id,
    before: { cover: product.images[0].id ?? product.images[0].key },
    after: { cover: handle },
    ip: req.ip,
  });

  return ok(res, { product: present.product(updated) });
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

  /*
   * A zone an order points at stays, so historical orders keep resolving, and
   * the answer says so rather than quietly switching it off: a delete button
   * that sometimes deletes and sometimes deactivates is one the owner cannot
   * predict. Switching it off is a PATCH of `isActive`, and the screen offers it.
   */
  const orders = await Order.countDocuments({ deliveryZone: req.params.id });
  if (orders > 0) {
    throw conflict(
      'ZONE_IN_USE',
      `${orders} order(s) use this zone, so it cannot be deleted. Switch it off instead.`
    );
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

/**
 * Sets one variant's packaging recipe: what one box of it consumes.
 *
 * Its own route rather than part of the product update, because the product form
 * is multipart (it carries photographs) and a nested array of objects has no
 * honest multipart encoding — the same reason `variants` travels as a JSON string.
 *
 * An empty list is meaningful and allowed: it means this box is not counted.
 * See domain/packaging.js and docs/adr/0026.
 */
async function setVariantRecipe(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product not found');

  const variant = findVariant(product, req.params.variantId);
  if (!variant) throw notFound('Box not found on this product');

  const rows = (req.body.packaging || []).map((row) => ({
    supply: row.supplyId,
    qtyMilli: toMilli(row.quantity),
  }));

  // Shape, duplicates and positive quantities. Throws a field error the form shows.
  assertRecipe(rows);

  // Every supply has to exist and be live: a recipe naming an archived crate
  // would silently consume nothing at delivery.
  const ids = rows.map((r) => r.supply);
  const supplies = await Supply.find({ _id: { $in: ids } });
  const byId = new Map(supplies.map((s) => [String(s._id), s]));
  rows.forEach((row, index) => {
    const supply = byId.get(String(row.supply));
    if (!supply) throw notFound(`Supply not found on row ${index + 1}`);
    if (supply.isArchived) {
      throw badRequest('SUPPLY_ARCHIVED', `${supply.nameBn} is archived`, {
        [`packaging.${index}.supplyId`]: `${supply.nameBn} is archived`,
      });
    }
  });

  const before = (variant.packaging || []).map((r) => ({
    supply: String(r.supply),
    qtyMilli: r.qtyMilli,
  }));

  /*
   * Addressed by the box's id, not its position: an edit that reordered or
   * dropped boxes between the read above and this write must not land the
   * recipe on a different box. Bumps the version so an edit read before this is
   * rebuilt rather than writing the old recipe back.
   */
  const saved = await Product.findOneAndUpdate(
    { _id: product._id, 'variants._id': variant._id },
    { $set: { 'variants.$[box].packaging': rows }, $inc: { __v: 1 } },
    { new: true, arrayFilters: [{ 'box._id': variant._id }] }
  );
  if (!saved) throw notFound('Box not found on this product');

  await audit.record({
    actor: req.user._id,
    action: 'product.setRecipe',
    targetType: 'Product',
    targetId: product._id,
    before: { variantId: String(variant._id), packaging: before },
    after: {
      variantId: String(variant._id),
      packaging: rows.map((r) => ({ supply: String(r.supply), qtyMilli: r.qtyMilli })),
    },
    ip: req.ip,
  });

  return ok(res, {
    variantId: variant._id,
    packaging: rows.map((row) => ({
      supplyId: row.supply,
      supplyNameBn: byId.get(String(row.supply)).nameBn,
      unit: byId.get(String(row.supply)).unit,
      quantity: fromMilli(row.qtyMilli),
    })),
  });
}

module.exports = {
  setVariantRecipe,
  listSources,
  createSource,
  updateSource,
  archiveSource,
  listProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  restoreProduct,
  setVariantStock,
  setProductCover,
  listZones,
  createZone,
  updateZone,
  deleteZone,
};
