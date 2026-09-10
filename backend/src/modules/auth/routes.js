'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./controller');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();

// Credential endpoints are guessable by nature, so they get their own bucket.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' },
  },
});

router.post(
  '/register',
  authLimiter,
  validate({ body: schema.register }),
  asyncHandler(controller.register)
);
router.post('/login', authLimiter, validate({ body: schema.login }), asyncHandler(controller.login));
router.post('/refresh', asyncHandler(controller.refresh));
router.post('/logout', asyncHandler(controller.logout));
router.get('/me', authenticate, asyncHandler(controller.me));

module.exports = router;
