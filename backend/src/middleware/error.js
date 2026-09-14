'use strict';

const multer = require('multer');
const { AppError } = require('../utils/errors');
const env = require('../config/env');
const { logger } = require('../config/logger');

/** Every response body in this API is one of these two shapes. */
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

function notFoundHandler(req, res) {
  fail(res, 404, { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
}

/*
 * body-parser tags its failures with a `type`. These are the client's mistake,
 * not ours, and reporting them as a 500 hid real bugs among them in the logs.
 */
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': [400, 'BAD_JSON', 'The request body is not valid JSON'],
  'entity.too.large': [413, 'PAYLOAD_TOO_LARGE', 'The request body is too large'],
  'encoding.unsupported': [415, 'UNSUPPORTED_ENCODING', 'Unsupported content encoding'],
  'charset.unsupported': [415, 'UNSUPPORTED_CHARSET', 'Unsupported charset'],
  'request.aborted': [400, 'REQUEST_ABORTED', 'The request was aborted'],
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // A stream (a CSV export, say) that fails after the headers went out cannot
  // be turned into an envelope any more. Cut the connection so the client sees
  // a broken download rather than a silently truncated file.
  if (res.headersSent) {
    (req.log || logger).error({ err }, 'error after response started');
    return res.destroy();
  }

  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.fields) body.fields = err.fields;
    // Machine-readable extras a client acts on, such as `retryAfter` seconds.
    if (err.details) Object.assign(body, err.details);
    if (err.details && Number.isFinite(err.details.retryAfter)) {
      res.set('Retry-After', String(err.details.retryAfter));
    }
    return fail(res, err.status, body);
  }

  if (err && BODY_PARSER_ERRORS[err.type]) {
    const [status, code, message] = BODY_PARSER_ERRORS[err.type];
    return fail(res, status, { code, message });
  }

  if (err instanceof multer.MulterError) {
    return fail(res, 400, { code: 'UPLOAD_FAILED', message: err.message });
  }

  // Mongoose duplicate key. Surfacing the field is safe and saves a support round trip.
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return fail(res, 409, {
      code: 'DUPLICATE',
      message: `That ${field} is already in use`,
      fields: { [field]: 'Already in use' },
    });
  }

  if (err && err.name === 'ValidationError') {
    const fields = {};
    Object.entries(err.errors || {}).forEach(([k, v]) => {
      fields[k] = v.message;
    });
    return fail(res, 400, { code: 'VALIDATION_FAILED', message: 'Some fields are invalid', fields });
  }

  if (err && err.name === 'CastError') {
    return fail(res, 400, { code: 'INVALID_ID', message: 'Malformed identifier' });
  }

  /*
   * Some other library threw an http-errors style error with a deliberate 4xx.
   * Its message was written for a client, so it is passed on. A 5xx here is
   * still our problem and falls through to the generic answer below.
   */
  const status = err && Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) {
    return fail(res, status, { code: 'BAD_REQUEST', message: err.message || 'Bad request' });
  }

  // Anything reaching here is a bug. Log it in full, tell the client nothing.
  (req.log || logger).error({ err }, 'unhandled error');
  return fail(res, 500, {
    code: 'INTERNAL',
    message: 'Something went wrong',
    ...(env.isProd ? {} : { detail: err && err.message }),
  });
}

module.exports = { ok, notFoundHandler, errorHandler };
