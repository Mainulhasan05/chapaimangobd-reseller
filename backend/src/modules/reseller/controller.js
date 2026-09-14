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
const { badRequest, notFound, forbidden, conflict } = require('../../utils/errors');
const audit = require('../../services/audit');
const { assertValidSlug } = require('../../utils/slug');
const { toPoisha, toTaka } = require('../../utils/money');
const { fromMilli } = require('../../utils/quantity');
const { KYC_STATUS, REVIEW_STATUS, KYC_DOC_TYPE } = require('../../domain/constants');

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
    if (profile.kycStatus !== KYC_STATUS.APPROVED) {
      throw forbidden('You can choose your shop address once KYC is approved');
    }
    const taken = await ResellerProfile.exists({ slug, _id: { $ne: profile._id } });
    if (taken) {
      throw badRequest('SLUG_TAKEN', 'That shop address is taken', { slug: 'Already taken' });
    }
    profile.slug = slug;
  }

  if (formActive === true && profile.kycStatus !== KYC_STATUS.APPROVED) {
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
const regularPriceOf = (listing) =>
  listing.regularPricePoisha == null ? null : toTaka(listing.regularPricePoisha);

async function listCatalog(req, res) {
  const products = await Product.find({ isArchived: false }).sort({ sortOrder: 1, createdAt: -1 });
  const listings = await ResellerProduct.find({ reseller: req.reseller._id });
  const byProduct = new Map(listings.map((l) => [String(l.product), l]));

  const items = products.map((p) => {
    const listing = byProduct.get(String(p._id));
    return {
      id: p._id,
      name: p.nameBn,
      description: p.description,
      images: present.images(p.images),
      unit: p.unit,
      step: fromMilli(p.qtyStepMilli),
      minOrderQty: fromMilli(p.minOrderQtyMilli),
      costPrice: toTaka(p.costPricePoisha),
      maxSellPrice: p.maxSellPricePoisha == null ? null : toTaka(p.maxSellPricePoisha),
      inStock: !p.trackStock || p.stockQtyMilli > 0,
      stockQty: p.trackStock ? fromMilli(p.stockQtyMilli) : null,
      isAvailable: p.isAvailable,
      // A product reaches the public form only through a listed row here.
      activated: Boolean(listing),
      sellPrice: listing ? toTaka(listing.sellPricePoisha) : null,
      regularPrice: listing ? regularPriceOf(listing) : null,
      hidePrice: listing ? listing.hidePrice : false,
      isListed: listing ? listing.isListed : false,
    };
  });

  return ok(res, { products: items });
}

/** Activating a product is exactly the act of setting a price on it. */
async function setCatalogPrice(req, res) {
  const product = await Product.findOne({ _id: req.params.productId, isArchived: false });
  if (!product) throw notFound('Product not found');

  const sellPricePoisha = toPoisha(req.body.sellPrice, 'sellPrice');
  pricing.assertSellPrice(sellPricePoisha, product);

  /*
   * A struck-through price has to be above the price paid, or the page would
   * advertise a saving that does not exist. Zero and null both mean "none".
   */
  let regularPricePoisha;
  if (req.body.regularPrice !== undefined) {
    regularPricePoisha = req.body.regularPrice
      ? toPoisha(req.body.regularPrice, 'regularPrice')
      : null;
    if (regularPricePoisha !== null && regularPricePoisha <= sellPricePoisha) {
      throw badRequest('REGULAR_PRICE_TOO_LOW', 'The regular price must be above your price', {
        regularPrice: 'Must be above your price',
      });
    }
  }

  const existing = await ResellerProduct.findOne({ reseller: req.reseller._id, product: product._id });

  const listing = await ResellerProduct.findOneAndUpdate(
    { reseller: req.reseller._id, product: product._id },
    {
      $set: {
        sellPricePoisha,
        ...(regularPricePoisha !== undefined ? { regularPricePoisha } : {}),
        ...(req.body.hidePrice !== undefined ? { hidePrice: req.body.hidePrice } : {}),
        ...(req.body.isListed !== undefined ? { isListed: req.body.isListed } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  /*
   * What a customer is charged is the kind of thing argued about later, so a
   * price or visibility change is recorded. Only the fields that moved.
   */
  const LISTING_FIELDS = ['sellPricePoisha', 'regularPricePoisha', 'hidePrice', 'isListed'];
  const moved = LISTING_FIELDS.filter((f) => !existing || existing[f] !== listing[f]);
  if (moved.length > 0) {
    await audit.record({
      actor: req.user._id,
      action: existing ? 'reseller.listing_update' : 'reseller.listing_create',
      targetType: 'ResellerProduct',
      targetId: listing._id,
      before: existing ? Object.fromEntries(moved.map((f) => [f, existing[f]])) : null,
      after: {
        ...Object.fromEntries(moved.map((f) => [f, listing[f]])),
        product: product._id,
        reseller: req.reseller._id,
      },
      ip: req.ip,
    });
  }

  return ok(res, {
    listing: {
      product: product._id,
      sellPrice: toTaka(listing.sellPricePoisha),
      regularPrice: regularPriceOf(listing),
      hidePrice: listing.hidePrice,
      isListed: listing.isListed,
    },
  });
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
        sellPricePoisha: removed.sellPricePoisha,
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
