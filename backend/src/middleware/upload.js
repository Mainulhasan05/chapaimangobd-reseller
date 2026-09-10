'use strict';

const multer = require('multer');
const { badRequest } = require('../utils/errors');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

/**
 * Files stay in memory and are streamed straight to R2, so nothing
 * sensitive ever lands on the application disk.
 */
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 6 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(badRequest('BAD_FILE_TYPE', 'Upload a JPG, PNG or WebP image'));
    }
    return cb(null, true);
  },
});

/** Turns multer size and count errors into the standard response envelope. */
function handleUploadErrors(err, _req, _res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(badRequest('FILE_TOO_LARGE', 'Each image must be under 5 MB'));
    }
    return next(badRequest('UPLOAD_FAILED', err.message));
  }
  return next(err);
}

module.exports = { upload, handleUploadErrors, MAX_BYTES, ALLOWED };
