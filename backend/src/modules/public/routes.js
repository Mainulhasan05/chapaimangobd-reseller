'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./controller');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();

const limitMessage = (message) => ({
  ok: false,
  error: { code: 'RATE_LIMITED', message },
});

/**
 * Order submission is unauthenticated, so it is limited per IP and per shop.
 * One abused reseller must not exhaust the budget for every other shop, and one
 * attacker must not be able to spam every form from a single address.
 */
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.params.slug}`,
  message: limitMessage('Too many orders from this device, please try again shortly'),
});

// Without this the tracking endpoint is an order-code enumeration oracle.
const trackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage('Too many lookups, please try again shortly'),
});

const browseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage('Too many requests'),
});

router.get('/delivery-zones', browseLimiter, asyncHandler(controller.listZones));
router.get('/shop/:slug', browseLimiter, asyncHandler(controller.getShop));

router.post(
  '/shop/:slug/orders',
  orderLimiter,
  validate({ body: schema.createOrder }),
  asyncHandler(controller.createOrder)
);

router.get(
  '/track/:code',
  trackLimiter,
  validate({ query: schema.trackQuery }),
  asyncHandler(controller.trackOrder)
);

module.exports = router;
