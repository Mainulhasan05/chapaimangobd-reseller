'use strict';

const crypto = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const env = require('./env');
const { AppError } = require('../utils/errors');

/**
 * File storage on Cloudflare R2, which speaks the S3 API.
 *
 * National ID scans and bKash screenshots are the most sensitive data here. The
 * bucket is private, so an object is unreachable without a signed URL, and those
 * are minted per request for the owner and expire within minutes. A leaked link
 * stops working on its own, and a guessed key returns nothing.
 *
 * Product images and shop logos are the exception: they are shown to customers
 * who are not logged in, so they are served from the bucket's public base URL
 * rather than signed on every render.
 */

const FOLDERS = {
  KYC: 'kyc',
  DEPOSIT: 'deposits',
  PRODUCT: 'products',
  LOGO: 'logos',
};

/** Folders whose contents must never be reachable without a signed URL. */
const PRIVATE_FOLDERS = new Set([FOLDERS.KYC, FOLDERS.DEPOSIT]);

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

/** Public delivery needs the bucket exposed on a domain; signing cannot help here. */
function assertPublicDelivery() {
  if (!env.R2_PUBLIC_BASE_URL) {
    throw new AppError(
      503,
      'NOT_CONFIGURED',
      'Public image delivery is not set up. Set R2_PUBLIC_BASE_URL to the bucket public URL.'
    );
  }
}

const isPrivateFolder = (folder) => PRIVATE_FOLDERS.has(folder);

/**
 * Uploads a buffer and returns the key to store. Keys are random, never derived
 * from the uploader's filename, so one reseller cannot guess another's objects
 * and a malicious filename cannot escape its folder.
 */
async function uploadBuffer(buffer, { folder, contentType }) {
  assertConfigured();
  if (!isPrivateFolder(folder)) assertPublicDelivery();

  const ext = EXTENSIONS[contentType] || 'bin';
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
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
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
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
  await getClient().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}

module.exports = {
  FOLDERS,
  isConfigured,
  assertConfigured,
  assertPublicDelivery,
  isPrivateFolder,
  uploadBuffer,
  signedUrl,
  publicUrl,
  destroy,
};
