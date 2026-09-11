'use strict';

const imgbb = require('./imgbb');
const storage = require('../config/storage');
const { AppError } = require('../utils/errors');

/**
 * Where a publicly visible image goes, and how it comes back.
 *
 * This is the one module that decides. Product photographs, shop logos and
 * brand assets are all shown to people who are not logged in, so they go to
 * ImgBB, which hands back a CDN URL with nothing to sign. R2 public delivery
 * stays as the fallback for a deployment that had it configured before ImgBB
 * existed, so nothing already saved has to move.
 *
 * The private half is not here and must not come here. KYC scans and deposit
 * screenshots go through `config/storage.js` directly, into the private R2
 * bucket, and are read through signed URLs that expire in minutes. An image
 * that goes to ImgBB is readable by anyone holding the link, forever, which is
 * exactly right for a mango photograph and exactly wrong for a national ID.
 *
 * Two shapes exist in the database because of that history:
 *
 *   { provider: 'imgbb', id, url, thumbUrl, deleteUrl }   hosted, URL stored
 *   { provider: 'r2',    id, key }                        bucket, URL derived
 *
 * `id` is the handle in both, so a caller deleting an image names one field
 * regardless of where it lives, and a row written before ImgBB still resolves.
 */

/** The kinds of public image, used to name the upload and nothing else. */
const KINDS = {
  PRODUCT: 'product',
  LOGO: 'logo',
  ASSET: 'asset',
};

/** Which R2 folder a kind falls back to, when ImgBB is not configured. */
const R2_FOLDER = {
  [KINDS.PRODUCT]: storage.FOLDERS.PRODUCT,
  [KINDS.LOGO]: storage.FOLDERS.LOGO,
  [KINDS.ASSET]: storage.FOLDERS.LOGO,
};

const hasHost = () => imgbb.isConfigured() || storage.isConfigured();

/**
 * Says which of the two is carrying public images, so the health endpoint can
 * report it and a form can refuse a photo before the person picks one.
 */
function provider() {
  if (imgbb.isConfigured()) return 'imgbb';
  if (storage.isConfigured()) return 'r2';
  return null;
}

function assertConfigured() {
  if (!hasHost()) {
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      'Image uploads are not set up yet. Set IMGBB_API_KEY in the environment.'
    );
  }
}

/**
 * Uploads one public image and returns the record to store.
 *
 * Takes a multer file rather than a bare buffer, because both back ends want
 * the mimetype and ImgBB wants the original name for its dashboard, and pulling
 * three fields out at every call site is how one of them ends up forgotten.
 */
async function uploadPublic(file, { kind = KINDS.ASSET } = {}) {
  assertConfigured();

  if (imgbb.isConfigured()) {
    const hosted = await imgbb.uploadBuffer(file.buffer, {
      name: `${kind}-${file.originalname || 'image'}`,
      contentType: file.mimetype,
    });
    return {
      provider: 'imgbb',
      id: hosted.id,
      url: hosted.url,
      thumbUrl: hosted.thumbUrl,
      deleteUrl: hosted.deleteUrl,
      width: hosted.width,
      height: hosted.height,
      bytes: hosted.bytes,
    };
  }

  const uploaded = await storage.uploadBuffer(file.buffer, {
    folder: R2_FOLDER[kind] || storage.FOLDERS.LOGO,
    contentType: file.mimetype,
  });

  // The key is the identifier as well as the location, so an old row and a new
  // one are addressed the same way by everything downstream.
  return { provider: 'r2', id: uploaded.key, key: uploaded.key, bytes: uploaded.size };
}

/** Uploads several, in parallel, failing the request if any one of them fails. */
function uploadManyPublic(files, options) {
  if (!files || files.length === 0) return Promise.resolve([]);
  return Promise.all(files.map((file) => uploadPublic(file, options)));
}

/**
 * The URL to render.
 *
 * An ImgBB image carries its own, because it cannot be derived from anything we
 * hold. An R2 one is built from the key at render time, so moving the bucket to
 * a different domain changes every image at once rather than orphaning the ones
 * already saved.
 */
function urlOf(image) {
  if (!image) return null;
  if (image.url) return image.url;
  if (image.key) return storage.publicUrl(image.key);
  return null;
}

/** The small rendition, for a grid of tiles. Falls back to the full image. */
const thumbUrlOf = (image) => image?.thumbUrl || urlOf(image);

/**
 * What the API hands a client: a handle, and the two sizes it may render.
 * `key` is kept alongside `id` because the owner's product form shipped
 * addressing images by key, and a client mid-session should not break.
 */
function present(image) {
  const url = urlOf(image);
  if (!url) return null;
  const id = image.id || image.key;
  return { id, key: id, url, thumbUrl: thumbUrlOf(image) };
}

/** A list of them, with anything unresolvable dropped rather than rendered broken. */
const presentMany = (list) => (list || []).map(present).filter(Boolean);

/**
 * Detaches an image from whatever owned it.
 *
 * For R2 this deletes the object. For ImgBB it does nothing, and deliberately:
 * `delete_url` is a web page a human opens, not an endpoint, so the image stops
 * being shown here but the link keeps resolving. The owner is told as much in
 * the product form rather than being left to assume a removed photo is gone.
 */
async function remove(image) {
  if (!image) return;
  if (image.provider === 'imgbb' || !image.key) return;
  await storage.destroy(image.key).catch(() => {
    /* orphaned in the bucket, already detached from its owner */
  });
}

const removeMany = (list) => Promise.all((list || []).map(remove));

module.exports = {
  KINDS,
  provider,
  hasHost,
  assertConfigured,
  uploadPublic,
  uploadManyPublic,
  urlOf,
  thumbUrlOf,
  present,
  presentMany,
  remove,
  removeMany,
};
