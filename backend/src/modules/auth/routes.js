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

/*
 * Anything that sends an SMS. The per-phone allowance in services/otp.js is the
 * real cap (three an hour); this stops one address walking through numbers.
 */
const otpLimiter = createLimiter({
  name: 'otp',
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many codes requested, please try again later',
});

/** Signed-in account changes, counted per account rather than per address. */
const accountLimiter = createLimiter({
  name: 'account',
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user._id),
  message: 'Too many attempts, please try again later',
});

router.post(
  '/register/otp',
  otpLimiter,
  validate({ body: schema.phoneOnly }),
  asyncHandler(controller.registerOtp)
);
router.post(
  '/register',
  authLimiter,
  validate({ body: schema.register }),
  asyncHandler(controller.register)
);
router.post('/login', authLimiter, validate({ body: schema.login }), asyncHandler(controller.login));
router.post(
  '/login/verify',
  authLimiter,
  validate({ body: schema.loginVerify }),
  asyncHandler(controller.verifyLogin)
);
router.post('/refresh', refreshLimiter, asyncHandler(controller.refresh));
router.post('/logout', asyncHandler(controller.logout));
router.get('/me', authenticate, asyncHandler(controller.me));

router.post(
  '/password/forgot',
  otpLimiter,
  validate({ body: schema.phoneOnly }),
  asyncHandler(controller.forgotPassword)
);
router.post(
  '/password/reset',
  authLimiter,
  validate({ body: schema.resetPassword }),
  asyncHandler(controller.resetPassword)
);
router.post(
  '/password/change',
  authenticate,
  accountLimiter,
  validate({ body: schema.changePassword }),
  asyncHandler(controller.changePassword)
);
router.post(
  '/phone/otp',
  authenticate,
  otpLimiter,
  validate({ body: schema.phoneOtp }),
  asyncHandler(controller.phoneOtp)
);
router.post(
  '/phone/change',
  authenticate,
  accountLimiter,
  validate({ body: schema.changePhone }),
  asyncHandler(controller.changePhone)
);

module.exports = router;
