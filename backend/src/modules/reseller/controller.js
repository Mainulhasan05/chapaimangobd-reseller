'use strict';

const ResellerProfile = require('../../models/ResellerProfile');
const ResellerProduct = require('../../models/ResellerProduct');
const Product = require('../../models/Product');
const KycSubmission = require('../../models/KycSubmission');

const storage = require('../../config/storage');
const imageService = require('../../services/images');
const pricing = require('../../services/pricing');
const { getSettings } = require('../../services/settings');
const present = require('../../utils/present');
const { ok } = require('../../middleware/error');
const { AppError, badRequest, notFound, forbidden, conflict } = require('../../utils/errors');
const audit = require('../../services/audit');
const { assertValidSlug } = require('../../utils/slug');
const { toPoisha, toTaka } = require('../../utils/money');
const { fromMilli } = require('../../utils/quantity');
const { KYC_STATUS, REVIEW_STATUS, KYC_DOC_TYPE } = require('../../domain/constants');
const { kycBlocks, kycRequired, kycVisible, kycCanSubmit } = require('../../domain/kyc');
const { findVariant, variantLabel } = require('../../domain/variants');

/* ------------------------------------------------------------------- profile */

/*
 * `isActive` lives on the account, not the profile, and is merged in so the
 * interface can show the deactivated banner from the one call it already makes.
 */
const getProfile = async (req, res) => {
  const settings = await getSettings();
  return ok(res, {
    profile: {
      ...req.reseller.toJSON(),
      isActive: req.user.isActive,
      // What a credit costs, beside how many they hold, for the SMS credits card.
      smsPricePerCredit: toTaka(settings.smsPricePerCreditPoisha),
    },
  });
};

async function updateProfile(req, res) {
  const profile = req.reseller;
  const body = req.body;
  const { shopName, slug, address, formActive } = body;

  if (slug && slug !== profile.slug) {
    assertValidSlug(slug);
    // Changing the address breaks every link already shared, so it is only
    // allowed once KYC has passed and the reseller is committed.
    if (kycBlocks(profile)) {
      throw forbidden('You can choose your shop address once KYC is approved');
    }
    const taken = await ResellerProfile.exists({ slug, _id: { $ne: profile._id } });
    if (taken) {
      throw badRequest('SLUG_TAKEN', 'That shop address is taken', { slug: 'Already taken' });
    }
    profile.slug = slug;
  }

  if (formActive === true && kycBlocks(profile)) {
    throw forbidden('Your KYC must be approved before your shop can open');
  }

  if (shopName !== undefined) profile.shopName = shopName;
  if (address !== undefined) profile.address = address;
  if (formActive !== undefined) profile.formActive = formActive;
  if (body.landingTemplate !== undefined) profile.landingTemplate = body.landingTemplate;

  /*
   * The shopfront. An empty string is a deletion, not a value: these are all
   * optional, and a reseller who adds a Facebook page has to be able to take it
   * off again. Stored as undefined so the field simply stops existing rather
   * than sitting there as an empty string the public page would have to test.
   */
  const shopfront = {
    publicPhone: body.publicPhone,
    whatsappNumber: body.whatsappNumber,
    facebookUrl: body.facebookUrl,
    about: body.about,
  };
  Object.entries(shopfront).forEach(([field, value]) => {
    if (value !== undefined) profile[field] = value === '' ? undefined : value;
  });

  if (body.bkashNumber !== undefined) {
    profile.payment.bkash = body.bkashNumber === '' ? undefined : body.bkashNumber;
  }
  if (body.nagadNumber !== undefined) {
    profile.payment.nagad = body.nagadNumber === '' ? undefined : body.nagadNumber;
  }

  await profile.save();
  return ok(res, { profile });
}

/**
 * The shop's picture.
 *
 * Public, and therefore hosted rather than stored: it is rendered on the
 * reseller's order form to a customer who has no account and cannot be handed a
 * signed URL. This is the opposite decision from `submitKyc` below, where the
 * same reseller uploads a photograph that must never be reachable without one.
 *
 * `logoUrl` is the field every reader renders. The record beside it exists only
 * so the image can be replaced or detached later.
 */
async function uploadLogo(req, res) {
  if (!req.file) throw badRequest('NO_FILE', 'Choose a picture first');

  const profile = req.reseller;
  const previous = profile.logo;

  const image = await imageService.uploadPublic(req.file, { kind: imageService.KINDS.LOGO });

  profile.logo = image;
  profile.logoUrl = imageService.urlOf(image);
  await profile.save();

  /*
   * The old picture is released only once the new one is saved, and a failure
   * is swallowed. Doing it the other way round leaves the shop with no logo if
   * the upload then fails, which is worse than leaving one orphaned image.
   */
  if (previous) await imageService.remove(previous);

  return ok(res, { profile });
}

async function removeLogo(req, res) {
  const profile = req.reseller;
  const previous = profile.logo;

  profile.logo = null;
  profile.logoUrl = null;
  await profile.save();

  if (previous) await imageService.remove(previous);

  return ok(res, { profile });
}

/* ----------------------------------------------------------------------- kyc */

async function submitKyc(req, res) {
  const profile = req.reseller;
  /*
   * The module is hidden until the owner asks this reseller for it, and hiding
   * a screen is not a control: an upload that the interface would never offer
   * is refused here too, before a single scan reaches the bucket. Otherwise the
   * platform would be holding national ID images nobody asked for.
   */
  if (!kycRequired(profile)) {
    throw new AppError(
      403,
      'KYC_NOT_REQUIRED',
      'Identity verification has not been requested for your account'
    );
  }
  if (profile.kycStatus === KYC_STATUS.APPROVED) {
    throw badRequest('ALREADY_APPROVED', 'Your KYC is already approved');
  }

  // Checked before anything is uploaded, so a double tap stores no orphan scans.
  const alreadyPending = () =>
    conflict('KYC_ALREADY_PENDING', 'Your documents are already waiting for review');
  if (await KycSubmission.exists({ reseller: profile._id, status: REVIEW_STATUS.PENDING })) {
    throw alreadyPending();
  }

  const files = req.files || [];
  if (files.length === 0) {
    throw badRequest('NO_DOCUMENTS', 'Upload at least the front of your NID');
  }

  const allowedTypes = new Set(Object.values(KYC_DOC_TYPE));
  const documents = [];

  for (const file of files) {
    const docType = file.fieldname;
    if (!allowedTypes.has(docType)) {
      throw badRequest('BAD_DOC_TYPE', `Unexpected document: ${docType}`);
    }
    // Private upload. A leaked database row is not a leaked scan, because the
    // bucket is private and the key alone will not fetch anything.
    // eslint-disable-next-line no-await-in-loop
    const uploaded = await storage.uploadBuffer(file.buffer, {
      folder: storage.FOLDERS.KYC,
      contentType: file.mimetype,
    });
    documents.push({
      type: docType,
      storageKey: uploaded.key,
      format: uploaded.contentType,
      bytes: uploaded.size,
    });
  }

  let submission;
  try {
    submission = await KycSubmission.create({
      reseller: profile._id,
      documents,
      status: REVIEW_STATUS.PENDING,
    });
  } catch (err) {
    // Two submissions raced past the check above and the partial unique index
    // let one in. The loser's scans are released rather than left orphaned.
    if (!(err && err.code === 11000)) throw err;
    await Promise.all(
      documents.map((d) => storage.destroy(d.storageKey).catch(() => undefined))
    );
    throw alreadyPending();
  }

  profile.kycStatus = KYC_STATUS.PENDING;
  await profile.save();

  return ok(res, { submission: { id: submission._id, status: submission.status } }, 201);
}

async function getKyc(req, res) {
  const submission = await KycSubmission.findOne({ reseller: req.reseller._id }).sort({
    createdAt: -1,
  });

  return ok(res, {
    /*
     * `required` is the gate, `visible` is the screen, and they are not the
     * same question: a reseller who submitted documents keeps sight of them
     * after the owner lifts the requirement. See domain/kyc.js.
     */
    required: kycRequired(req.reseller),
    visible: kycVisible(req.reseller),
    canSubmit: kycCanSubmit(req.reseller),
    status: req.reseller.kycStatus,
    submission: submission
      ? {
          id: submission._id,
          status: submission.status,
          note: submission.note,
          documentTypes: submission.documents.map((d) => d.type),
          createdAt: submission.createdAt,
          reviewedAt: submission.reviewedAt,
        }
      : null,
  });
}

/* ------------------------------------------------------------------- catalog */

/** Everything the owner sells, annotated with this reseller own pricing. */
const takaOrNull = (poisha) => (poisha == null ? null : toTaka(poisha));

/**
 * One product on the reseller's catalog screen: every box the owner offers, with
 * this reseller's price against each.
 *
 * A box with no price row is one this shop does not sell, and it is still listed
 * here with nulls rather than hidden: the screen's whole job is to show what is
 * not priced yet. See docs/adr/0021.
 */
function catalogItem(product, listing) {
  const priced = new Map(
    ((listing && listing.variants) || []).map((v) => [String(v.variant), v])
  );

  const variants = (product.variants || [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.contentMilli - b.contentMilli)
    .map((v) => {
      const own = priced.get(String(v._id));
      return {
        id: v._id,
        label: variantLabel(v, product.unit),
        content: fromMilli(v.contentMilli),
        costPrice: toTaka(v.costPricePoisha),
        maxSellPrice: takaOrNull(v.maxSellPricePoisha),
        // Boxes, not weight.
        inStock: !product.trackStock || v.stockQty > 0,
        stockQty: product.trackStock ? v.stockQty : null,
        isAvailable: v.isAvailable,
        // Priced by this reseller, and therefore sellable by them.
        activated: Boolean(own),
        sellPrice: own ? toTaka(own.sellPricePoisha) : null,
        regularPrice: own ? takaOrNull(own.regularPricePoisha) : null,
        isListed: own ? own.isListed : false,
      };
    });

  return {
    id: product._id,
    name: product.nameBn,
    description: product.description,
    images: present.images(product.images),
    unit: product.unit,
    variants,
    isAvailable: product.isAvailable,
    trackStock: product.trackStock,
    // A product reaches the public form only through a listed row here, and only
    // with at least one box priced.
    activated: Boolean(listing),
    hidePrice: listing ? listing.hidePrice : false,
    isListed: listing ? listing.isListed : false,
  };
}

async function listCatalog(req, res) {
  const products = await Product.find({ isArchived: false }).sort({ sortOrder: 1, createdAt: -1 });
  const listings = await ResellerProduct.find({ reseller: req.reseller._id });
  const byProduct = new Map(listings.map((l) => [String(l.product), l]));

  const items = products.map((p) => catalogItem(p, byProduct.get(String(p._id))));

  return ok(res, { products: items });
}

/**
 * Activating a product is exactly the act of pricing its boxes.
 *
 * The whole set arrives at once, because the screen shows one product's boxes
 * together. A box left out of the body loses its price row and stops being sold
 * by this shop; that is the only way to drop one, and it is deliberate that it
 * reads the same as never having priced it. See docs/adr/0021.
 */
async function setCatalogPrice(req, res) {
  const product = await Product.findOne({ _id: req.params.productId, isArchived: false });
  if (!product) throw notFound('Product not found');

  const seen = new Set();
  const variants = req.body.variants.map((row, i) => {
    const variant = findVariant(product, row.variant);
    if (!variant) {
      throw badRequest('UNKNOWN_VARIANT', 'That box is not one of this product’s', {
        [`variants.${i}.variant`]: 'Unknown box',
      });
    }
    if (seen.has(String(variant._id))) {
      throw badRequest('DUPLICATE_VARIANT', 'The same box is priced twice', {
        [`variants.${i}.variant`]: 'Already priced above',
      });
    }
    seen.add(String(variant._id));

    const sellPricePoisha = toPoisha(row.sellPrice, `variants.${i}.sellPrice`);
    // The floor and the ceiling are this box's, not the product's.
    pricing.assertSellPrice(sellPricePoisha, variant, `variants.${i}.sellPrice`);

    /*
     * A struck-through price has to be above the price paid, or the page would
     * advertise a saving that does not exist. Zero and null both mean "none".
     */
    let regularPricePoisha = null;
    if (row.regularPrice) {
      regularPricePoisha = toPoisha(row.regularPrice, `variants.${i}.regularPrice`);
      if (regularPricePoisha <= sellPricePoisha) {
        throw badRequest('REGULAR_PRICE_TOO_LOW', 'The regular price must be above your price', {
          [`variants.${i}.regularPrice`]: 'Must be above your price',
        });
      }
    }

    return {
      variant: variant._id,
      sellPricePoisha,
      regularPricePoisha,
      isListed: row.isListed ?? true,
    };
  });

  const existing = await ResellerProduct.findOne({ reseller: req.reseller._id, product: product._id });

  const listing = await ResellerProduct.findOneAndUpdate(
    { reseller: req.reseller._id, product: product._id },
    {
      $set: {
        variants,
        ...(req.body.hidePrice !== undefined ? { hidePrice: req.body.hidePrice } : {}),
        ...(req.body.isListed !== undefined ? { isListed: req.body.isListed } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  /*
   * What a customer is charged is the kind of thing argued about later, so a
   * price or visibility change is recorded. The box prices go in whole, because
   * which box moved is the question being asked of the log.
   */
  const prices = (row) =>
    (row.variants || []).map((v) => ({
      variant: String(v.variant),
      sellPricePoisha: v.sellPricePoisha,
      regularPricePoisha: v.regularPricePoisha,
      isListed: v.isListed,
    }));
  const before = existing
    ? { variants: prices(existing), hidePrice: existing.hidePrice, isListed: existing.isListed }
    : null;
  const after = { variants: prices(listing), hidePrice: listing.hidePrice, isListed: listing.isListed };

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await audit.record({
      actor: req.user._id,
      action: existing ? 'reseller.listing_update' : 'reseller.listing_create',
      targetType: 'ResellerProduct',
      targetId: listing._id,
      before,
      after: { ...after, product: product._id, reseller: req.reseller._id },
      ip: req.ip,
    });
  }

  return ok(res, { product: catalogItem(product, listing) });
}

async function removeCatalogListing(req, res) {
  const removed = await ResellerProduct.findOneAndDelete({
    reseller: req.reseller._id,
    product: req.params.productId,
  });
  if (removed) {
    await audit.record({
      actor: req.user._id,
      action: 'reseller.listing_remove',
      targetType: 'ResellerProduct',
      targetId: removed._id,
      before: {
        // Every box's price, so the log says what this shop was charging.
        variants: (removed.variants || []).map((v) => ({
          variant: String(v.variant),
          sellPricePoisha: v.sellPricePoisha,
          isListed: v.isListed,
        })),
        hidePrice: removed.hidePrice,
        isListed: removed.isListed,
        product: removed.product,
      },
      ip: req.ip,
    });
  }
  return ok(res, { removed: true });
}

/* ------------------------------------------------------------- notifications */

/*
 * The inbox is not reseller specific and is no longer implemented here. Every
 * handler was already scoped to `req.user` alone, and the owner needs the same
 * five endpoints; see modules/shared/notifications.controller.js.
 */
const {
  list: listNotifications,
  markRead: markNotificationsRead,
  subscribePush,
  unsubscribePush,
  pushKey,
} = require('../shared/notifications.controller');


module.exports = {
  uploadLogo,
  removeLogo,
  getProfile,
  updateProfile,
  submitKyc,
  getKyc,
  listCatalog,
  setCatalogPrice,
  removeCatalogListing,
  listNotifications,
  markNotificationsRead,
  subscribePush,
  unsubscribePush,
  pushKey,
};
