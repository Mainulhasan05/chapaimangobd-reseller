'use strict';

const ResellerProfile = require('../../models/ResellerProfile');
const ResellerProduct = require('../../models/ResellerProduct');
const Product = require('../../models/Product');
const KycSubmission = require('../../models/KycSubmission');
const Notification = require('../../models/Notification');
const PushSubscription = require('../../models/PushSubscription');

const storage = require('../../config/storage');
const telegram = require('../../channels/telegram');
const webpush = require('../../channels/webpush');
const pricing = require('../../services/pricing');
const present = require('../../utils/present');
const { ok } = require('../../middleware/error');
const { badRequest, notFound, forbidden } = require('../../utils/errors');
const { assertValidSlug } = require('../../utils/slug');
const { toPoisha, toTaka } = require('../../utils/money');
const { fromMilli } = require('../../utils/quantity');
const { KYC_STATUS, REVIEW_STATUS, KYC_DOC_TYPE } = require('../../domain/constants');

/* ------------------------------------------------------------------- profile */

const getProfile = async (req, res) => ok(res, { profile: req.reseller });

async function updateProfile(req, res) {
  const profile = req.reseller;
  const { shopName, slug, address, formActive } = req.body;

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

  await profile.save();
  return ok(res, { profile });
}

/* ----------------------------------------------------------------------- kyc */

async function submitKyc(req, res) {
  const profile = req.reseller;
  if (profile.kycStatus === KYC_STATUS.APPROVED) {
    throw badRequest('ALREADY_APPROVED', 'Your KYC is already approved');
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

  const submission = await KycSubmission.create({
    reseller: profile._id,
    documents,
    status: REVIEW_STATUS.PENDING,
  });

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

  const listing = await ResellerProduct.findOneAndUpdate(
    { reseller: req.reseller._id, product: product._id },
    {
      $set: {
        sellPricePoisha,
        ...(req.body.hidePrice !== undefined ? { hidePrice: req.body.hidePrice } : {}),
        ...(req.body.isListed !== undefined ? { isListed: req.body.isListed } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return ok(res, {
    listing: {
      product: product._id,
      sellPrice: toTaka(listing.sellPricePoisha),
      hidePrice: listing.hidePrice,
      isListed: listing.isListed,
    },
  });
}

async function removeCatalogListing(req, res) {
  await ResellerProduct.deleteOne({ reseller: req.reseller._id, product: req.params.productId });
  return ok(res, { removed: true });
}

/* ------------------------------------------------------------- notifications */

async function listNotifications(req, res) {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const unread = await Notification.countDocuments({ user: req.user._id, readAt: null });
  return ok(res, { notifications: items, unread });
}

async function markNotificationsRead(req, res) {
  await Notification.updateMany(
    { user: req.user._id, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return ok(res, { read: true });
}

async function subscribePush(req, res) {
  const { endpoint, keys } = req.body;
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { $set: { user: req.user._id, endpoint, keys, userAgent: req.get('user-agent') } },
    { upsert: true }
  );
  return ok(res, { subscribed: true });
}

async function unsubscribePush(req, res) {
  await PushSubscription.deleteOne({ endpoint: req.body.endpoint, user: req.user._id });
  return ok(res, { subscribed: false });
}

const pushKey = (_req, res) => ok(res, { publicKey: webpush.publicKey() });

async function telegramLink(req, res) {
  if (!telegram.isConfigured()) throw badRequest('NOT_CONFIGURED', 'Telegram is not set up yet');
  const link = await telegram.createLinkToken(req.user._id);
  return ok(res, link);
}

module.exports = {
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
  telegramLink,
};
