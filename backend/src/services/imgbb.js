'use strict';

const env = require('../config/env');
const { AppError } = require('../utils/errors');

/**
 * ImgBB, the host for every image the public may see.
 *
 * Product photographs, shop logos and brand assets all end up here. The reason
 * is delivery, not storage: those images are shown to customers who are not
 * logged in and therefore cannot sign anything, and ImgBB hands back a plain
 * URL on a CDN with no bucket to expose, no signature to mint and no egress to
 * pay for.
 *
 * Nothing private is ever sent here. An ImgBB image is readable by anyone who
 * has the link, forever, so KYC scans and deposit screenshots stay in R2 behind
 * short-lived signed URLs. That split is enforced one level up, in
 * `services/images.js`, which is the only module that decides where an upload
 * goes. See `config/storage.js` for the private half.
 *
 * Two consequences worth knowing before reading the callers:
 *
 *   - There is no delete API. `delete_url` is a web page a human opens, not an
 *     endpoint, so removing an image from a product detaches it and keeps the
 *     link. Nothing this app does can make an already-shared URL stop resolving.
 *   - The returned URL is the record. Unlike an R2 key, it cannot be derived
 *     from anything we hold, so it is stored rather than rebuilt at render time.
 */

const isConfigured = () => env.imgbbConfigured;

/**
 * A missing integration is a configuration problem, not a crash. Without this
 * the owner adding a product photo is told "something went wrong" when the real
 * answer is that image hosting was never set up.
 */
function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      'Image hosting is not set up yet. Set IMGBB_API_KEY in the environment.'
    );
  }
}

/**
 * ImgBB's own ceiling. Multer stops uploads at 5 MB long before this, so it
 * exists to make the limit visible rather than to be hit.
 */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Uploads one image and returns what to store.
 *
 * The body is base64 in a multipart form. The documented alternative is a GET
 * with the image in the query string, which cannot carry a real photograph: a
 * 5 MB JPEG is about 6.8 MB of base64 and every URL length limit between here
 * and ImgBB would truncate it.
 *
 * `name` is passed through only to keep the ImgBB dashboard legible. It never
 * becomes part of the URL we depend on, so a hostile filename has nowhere to go.
 */
async function uploadBuffer(buffer, { name, contentType, expiresInSeconds } = {}) {
  assertConfigured();

  if (!buffer || buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'The image is empty');
  }
  if (buffer.length > MAX_BYTES) {
    throw new AppError(400, 'FILE_TOO_LARGE', 'The image is too large to host');
  }

  const url = new URL(env.IMGBB_UPLOAD_URL);
  url.searchParams.set('key', env.IMGBB_API_KEY);
  if (expiresInSeconds) url.searchParams.set('expiration', String(expiresInSeconds));

  const form = new FormData();
  form.append('image', buffer.toString('base64'));
  if (name) form.append('name', safeName(name));

  /*
   * A third party that stops answering must not hold an Express worker open
   * until the socket times out on its own. Node's fetch has no default timeout,
   * so the deadline has to be supplied here.
   */
  const abort = AbortSignal.timeout(env.IMGBB_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { method: 'POST', body: form, signal: abort });
  } catch (cause) {
    throw new AppError(
      502,
      'UPLOAD_FAILED',
      cause?.name === 'TimeoutError'
        ? 'The image host did not respond in time. Try again.'
        : 'Could not reach the image host. Check the connection and try again.'
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success || !payload?.data?.url) {
    /*
     * ImgBB reports a rejected upload in the body as much as in the status, and
     * its message names the real cause: a bad key, a file it will not take. It
     * is surfaced rather than swallowed, because "upload failed" sends whoever
     * is debugging this to the wrong place.
     */
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new AppError(502, 'UPLOAD_FAILED', `The image host refused the upload: ${detail}`);
  }

  return normalize(payload.data, contentType, buffer.length);
}

/**
 * What the database keeps: an identifier, the sizes we render, and the page a
 * human opens to delete the image by hand. Everything else ImgBB returns is
 * either derivable or of no use to a caller.
 */
function normalize(data, contentType, bytes) {
  return {
    provider: 'imgbb',
    id: data.id,
    url: data.url,
    // A grid of six product photos on a phone has no business fetching six full
    // size images. ImgBB renders both for free; falling back keeps the tile
    // working if it ever stops.
    thumbUrl: data.thumb?.url || data.medium?.url || data.url,
    mediumUrl: data.medium?.url || data.url,
    // Not an endpoint. A page the owner opens to remove the image from ImgBB.
    deleteUrl: data.delete_url || null,
    width: Number(data.width) || null,
    height: Number(data.height) || null,
    bytes: Number(data.size) || bytes || null,
    contentType: data.image?.mime || contentType || null,
  };
}

/** Keeps the ImgBB dashboard readable without letting a filename carry anything. */
function safeName(name) {
  return String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .slice(0, 60);
}

module.exports = { isConfigured, assertConfigured, uploadBuffer, MAX_BYTES };
