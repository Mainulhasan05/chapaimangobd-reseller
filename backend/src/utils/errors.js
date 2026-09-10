'use strict';

/**
 * Every failure the API returns deliberately is an AppError. Anything else that
 * reaches the error middleware is a bug and is reported as a 500 without detail.
 */
class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

const badRequest = (code, message, fields) => new AppError(400, code, message, fields);
const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', message);
const forbidden = (message = 'Not allowed') => new AppError(403, 'FORBIDDEN', message);
const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
const conflict = (code, message) => new AppError(409, code, message);
const tooMany = (message = 'Too many requests') => new AppError(429, 'RATE_LIMITED', message);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, tooMany };
