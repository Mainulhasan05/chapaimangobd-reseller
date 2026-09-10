'use strict';

const { AppError } = require('../utils/errors');
const env = require('../config/env');

/** Every response body in this API is one of these two shapes. */
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });

function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.fields) body.fields = err.fields;
    return res.status(err.status).json({ ok: false, error: body });
  }

  // Mongoose duplicate key. Surfacing the field is safe and saves a support round trip.
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({
      ok: false,
      error: { code: 'DUPLICATE', message: `That ${field} is already in use`, fields: { [field]: 'Already in use' } },
    });
  }

  if (err && err.name === 'ValidationError') {
    const fields = {};
    Object.entries(err.errors || {}).forEach(([k, v]) => {
      fields[k] = v.message;
    });
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Some fields are invalid', fields },
    });
  }

  if (err && err.name === 'CastError') {
    return res.status(400).json({
      ok: false,
      error: { code: 'INVALID_ID', message: 'Malformed identifier' },
    });
  }

  // Anything reaching here is a bug. Log it in full, tell the client nothing.
  // eslint-disable-next-line no-console
  console.error('[unhandled]', err);
  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong',
      ...(env.isProd ? {} : { detail: err && err.message }),
    },
  });
}

module.exports = { ok, notFoundHandler, errorHandler };
