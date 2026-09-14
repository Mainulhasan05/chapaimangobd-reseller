'use strict';

const express = require('express');
const controller = require('./controller');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { createLimiter } = require('../../services/rateLimitStore');

const router = express.Router();

/*
 * Every counter lives in MongoDB, so a second API instance shares the limits
 * instead of doubling them. See docs/adr/0012.
 */

/**
 * Order submission is unauthenticated, so it is limited per IP and per shop.
 * One abused reseller must not exhaust the budget for every other shop, and one
 * attacker must not be able to spam every form from a single address.
 */
const orderLimiter = createLimiter({
  name: 'order-ip',
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${req.ip}:${req.params.slug}`,
  message: 'Too many orders from this device, please try again shortly',
});

/**
 * A ceiling per shop, whatever the address. Rotating IPs defeats the limiter
 * above; this one caps what a botnet can pour into one reseller's pending list,
 * which is a pile the reseller has to clear by hand. Sixty in ten minutes is far
 * beyond a real shop's busiest moment.
 */
const orderSlugLimiter = createLimiter({
  name: 'order-slug',
  windowMs: 10 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => String(req.params.slug || '').toLowerCase(),
  message: 'This shop is receiving too many orders right now, please try again shortly',
});

// Without this the tracking endpoint is an order-code enumeration oracle.
const trackLimiter = createLimiter({
  name: 'track',
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: 'Too many lookups, please try again shortly',
});

const browseLimiter = createLimiter({
  name: 'browse',
  windowMs: 60 * 1000,
  limit: 120,
  message: 'Too many requests',
});

router.get('/delivery-zones', browseLimiter, asyncHandler(controller.listZones));
router.get('/shop/:slug', browseLimiter, asyncHandler(controller.getShop));

router.post(
  '/shop/:slug/orders',
  orderLimiter,
  orderSlugLimiter,
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
