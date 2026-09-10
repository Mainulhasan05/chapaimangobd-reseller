'use strict';

const crypto = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const env = require('./env');
const { AppError } = require('../utils/errors');

/**
 * File storage on Cloudflare R2, which speaks the S3 API.
 *
 * Two buckets, because R2 public access is bucket wide and cannot be scoped to a
 * prefix. There is no way to make product photos readable while keeping national
 * ID scans private inside one bucket.
 *
 *   R2_BUCKET         private. KYC scans and bKash screenshots. Reachable only
 *                     through signed URLs minted per request for the owner and
 *                     expiring in minutes, so a leaked link dies on its own and
 *                     a guessed key returns nothing.
 *   R2_PUBLIC_BUCKET  public. Product photos and shop logos, shown to customers
 *                     who are not logged in and therefore cannot sign anything.
 *
 * Which bucket an object belongs to follows from its folder, so a stored key is
 * enough to read or delete it later.
 */

/**
 * Every object this app writes lives under one root prefix, so the bucket stays
 * legible in the R2 console and a staging environment can share the same bucket
 * without colliding. Configurable, because that separation is the point.
 */
const ROOT = env.R2_PREFIX.replace(/^\/+|\/+$/g, '');

const FOLDERS = {
  KYC: 'kyc',
  DEPOSIT: 'deposits',
  PRODUCT: 'products',
  LOGO: 'logos',
};

/** Folders whose contents must never be reachable without a signed URL. */
const PRIVATE_FOLDERS = new Set([FOLDERS.KYC, FOLDERS.DEPOSIT]);

const isPrivateFolder = (folder) => PRIVATE_FOLDERS.has(folder);

/** The full prefix an object of this kind is written under. */
const prefixFor = (folder) => (ROOT ? `${ROOT}/${folder}` : folder);

/**
 * Which bucket a folder belongs in. R2 public access is bucket wide, so this is
 * the boundary that keeps national ID scans out of anything readable without a
 * signature. Private folders always use R2_BUCKET; public ones require a second,
 * separate bucket and refuse to fall back to the private one.
 */
const bucketFor = (folder) =>
  isPrivateFolder(folder) ? env.R2_BUCKET : env.R2_PUBLIC_BUCKET || null;

/**
 * Recovers the bucket from a stored key, so reading and deleting need nothing
 * beyond what the database already holds.
 */
function bucketForKey(key) {
  const parts = String(key).split('/');
  const folder = ROOT ? parts[1] : parts[0];
  return bucketFor(folder);
}

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

let client = null;

function getClient() {
  assertConfigured();
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

const isConfigured = () => env.r2Configured;

/**
 * A missing integration is a configuration problem, not a crash. Throwing a plain
 * Error surfaced as a generic 500, so a reseller uploading their NID was told
 * "something went wrong" when the real answer is that uploads were never set up.
 */
function assertConfigured() {
  if (!env.r2Configured) {
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      'File uploads are not set up yet. Set R2_* in the environment.'
    );
  }
}

/**
 * Public delivery needs its own bucket exposed on a domain; signing cannot help
 * here, because the viewer is an anonymous customer. The separate bucket is
 * mandatory rather than a fallback: writing a product photo into the private
 * bucket and then making that bucket public would expose every KYC scan in it.
 */
function assertPublicDelivery() {
  if (!env.R2_PUBLIC_BUCKET) {
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      'Public image delivery needs its own bucket. Set R2_PUBLIC_BUCKET to a separate, ' +
        'publicly readable bucket. Do not reuse the private one.'
    );
  }
  if (!env.R2_PUBLIC_BASE_URL) {
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      'Public image delivery is not set up. Set R2_PUBLIC_BASE_URL to the public bucket URL.'
    );
  }
  if (env.R2_PUBLIC_BUCKET === env.R2_BUCKET) {
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      'R2_PUBLIC_BUCKET must differ from R2_BUCKET. R2 public access is bucket wide, so ' +
        'sharing one bucket would expose KYC documents.'
    );
  }
}

/**
 * Uploads a buffer and returns the key to store. Keys are random, never derived
 * from the uploader's filename, so one reseller cannot guess another's objects
 * and a malicious filename cannot escape its folder.
 */
async function uploadBuffer(buffer, { folder, contentType }) {
  assertConfigured();
  if (!isPrivateFolder(folder)) assertPublicDelivery();

  const ext = EXTENSIONS[contentType] || 'bin';
  const key = `${prefixFor(folder)}/${crypto.randomUUID()}.${ext}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucketFor(folder),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return { key, size: buffer.length, contentType };
}

/**
 * A short-lived signed URL for a private object, minted per request.
 * Async, unlike the delivery URL below, because signing is a real operation.
 */
async function signedUrl(key, { expiresInSeconds = 600 } = {}) {
  assertConfigured();
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucketForKey(key), Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

/**
 * The public URL of an object in a bucket exposed on a domain. Derived rather
 * than stored, so moving the bucket does not orphan every image already saved.
 * Returns null when public delivery is not configured, and callers render a
 * placeholder rather than a broken image.
 */
function publicUrl(key) {
  if (!key || !env.R2_PUBLIC_BASE_URL) return null;
  return `${env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
}

async function destroy(key) {
  assertConfigured();
  await getClient().send(new DeleteObjectCommand({ Bucket: bucketForKey(key), Key: key }));
}

module.exports = {
  ROOT,
  FOLDERS,
  prefixFor,
  bucketFor,
  bucketForKey,
  isConfigured,
  assertConfigured,
  assertPublicDelivery,
  isPrivateFolder,
  uploadBuffer,
  signedUrl,
  publicUrl,
  destroy,
};
