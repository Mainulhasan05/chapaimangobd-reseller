'use strict';

const express = require('express');
const controller = require('./controller');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const { createLimiter } = require('../../services/rateLimitStore');

const router = express.Router();

// Credential endpoints are guessable by nature, so they get their own bucket.
// Counted in MongoDB, so every instance shares it. See docs/adr/0012.
const authLimiter = createLimiter({
  name: 'auth',
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many attempts, please try again later',
});

/*
 * Refresh is not guessable, a token is 48 random bytes, but it does a database
 * write per call and every open tab calls it. Generous enough for a family with
 * several tabs on one connection, tight enough to blunt a replay loop.
 */
const refreshLimiter = createLimiter({
  name: 'refresh',
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: 'Too many attempts, please try again later',
});

router.post(
  '/register',
  authLimiter,
  validate({ body: schema.register }),
  asyncHandler(controller.register)
);
router.post('/login', authLimiter, validate({ body: schema.login }), asyncHandler(controller.login));
router.post('/refresh', refreshLimiter, asyncHandler(controller.refresh));
router.post('/logout', asyncHandler(controller.logout));
router.get('/me', authenticate, asyncHandler(controller.me));

module.exports = router;
