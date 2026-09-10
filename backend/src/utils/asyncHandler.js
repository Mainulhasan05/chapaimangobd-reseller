'use strict';

/**
 * Express 4 does not forward rejected promises to the error middleware.
 * Every async route handler is wrapped in this.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
