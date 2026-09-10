'use strict';

const { v2: cloudinary } = require('cloudinary');
const env = require('./env');

if (env.cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/**
 * National ID scans and bKash screenshots are the most sensitive data here.
 * They upload as "authenticated", so the delivery URL alone is not enough to
 * fetch them and a guessed public id returns nothing. Product images are public.
 */
const FOLDERS = {
  KYC: 'chapaimango/kyc',
  DEPOSIT: 'chapaimango/deposits',
  PRODUCT: 'chapaimango/products',
  LOGO: 'chapaimango/logos',
};

function assertConfigured() {
  if (!env.cloudinaryConfigured) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_* in the environment.');
  }
}

/** Uploads a buffer. Private folders never get a usable public URL. */
function uploadBuffer(buffer, { folder, isPrivate = false, filename }) {
  assertConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        type: isPrivate ? 'authenticated' : 'upload',
        public_id: filename,
        overwrite: false,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

/**
 * A short-lived signed URL for a private asset. Generated per request for the
 * owner only, so a leaked link stops working within the hour.
 */
function signedUrl(publicId, { expiresInSeconds = 600 } = {}) {
  assertConfigured();
  return cloudinary.url(publicId, {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

const destroy = (publicId, { isPrivate = true } = {}) => {
  assertConfigured();
  return cloudinary.uploader.destroy(publicId, { type: isPrivate ? 'authenticated' : 'upload' });
};

module.exports = { cloudinary, FOLDERS, uploadBuffer, signedUrl, destroy, assertConfigured };
