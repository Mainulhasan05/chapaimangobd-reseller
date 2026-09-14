'use strict';

const express = require('express');
const controller = require('./controller');
const orders = require('./orders.controller');
const wallet = require('./wallet.controller');
const customers = require('./customers.controller');
const messaging = require('../shared/messaging.controller');
const prefsSchema = require('../shared/notificationPrefs.schema');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const {
  authenticate,
  requireRole,
  loadReseller,
  requireKyc,
  readOnlyWhenInactive,
} = require('../../middleware/auth');
const { upload, handleUploadErrors } = require('../../middleware/upload');
const { ROLES, KYC_DOC_TYPE } = require('../../domain/constants');
const { createLimiter } = require('../../services/rateLimitStore');

const router = express.Router();

// Everything below is a signed-in reseller acting on their own data. The scope is
// applied per query, never inferred from a header the proxy could have set.
router.use(authenticate, requireRole(ROLES.RESELLER), loadReseller);

/*
 * A deactivated reseller reads everything and writes almost nothing: their
 * money must never be trapped, so a withdrawal request stays open, and marking
 * notifications read is housekeeping on their own inbox. Every other write is
 * a 403 RESELLER_INACTIVE. See docs/adr/0011.
 */
router.use(
  readOnlyWhenInactive([
    'POST /withdrawals',
    'POST /notifications/read',
    // Stopping messages is housekeeping too: nobody should be unable to unlink.
    'DELETE /telegram/link',
  ])
);

/*
 * Every upload is a round trip to R2 or the image host and up to five megabytes
 * per file held in memory, so a script looping on one of these costs real money
 * and memory. Keyed by the signed-in user, not the address: a shop on a shared
 * mobile connection must not be throttled by its neighbours. Thirty an hour is
 * several KYC retries, a logo change and a day of deposits.
 */
const uploadLimiter = createLimiter({
  name: 'upload-reseller',
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.user._id),
  // A JSON edit on the same route carries no file and is not counted.
  skip: (req) => !req.is('multipart/form-data'),
  message: 'Too many uploads, please try again later',
});

/* profile and kyc */
router.get('/profile', asyncHandler(controller.getProfile));
router.patch(
  '/profile',
  validate({ body: schema.updateProfile }),
  asyncHandler(controller.updateProfile)
);

/*
 * The shop picture is public and goes to the image host; the KYC documents
 * below are private and go to the bucket. Same reseller, same form factor, two
 * very different destinations. See services/images.js.
 */
router.post(
  '/profile/logo',
  uploadLimiter,
  upload.single('logo'),
  handleUploadErrors,
  asyncHandler(controller.uploadLogo)
);
router.delete('/profile/logo', asyncHandler(controller.removeLogo));

const kycFields = Object.values(KYC_DOC_TYPE).map((name) => ({ name, maxCount: 1 }));
router.post(
  '/kyc',
  uploadLimiter,
  upload.fields(kycFields),
  handleUploadErrors,
  // multer .fields gives an object keyed by field name; flatten for the controller.
  (req, _res, next) => {
    req.files = Object.values(req.files || {}).flat();
    next();
  },
  asyncHandler(controller.submitKyc)
);
router.get('/kyc', asyncHandler(controller.getKyc));

/* catalog */
router.get('/catalog', asyncHandler(controller.listCatalog));
router.put(
  '/catalog/:productId',
  validate({ body: schema.setCatalogPrice }),
  asyncHandler(controller.setCatalogPrice)
);
router.delete('/catalog/:productId', asyncHandler(controller.removeCatalogListing));

/*
 * customers
 *
 * Scoped to this reseller's own orders, never read off the shared customer
 * record: that record spans every shop a number has bought from, and one
 * reseller must not see another's sales. See the controller.
 */
router.get('/customers', asyncHandler(customers.listCustomers));
router.get('/customers/:phone', asyncHandler(customers.getCustomer));

/* orders */
router.get('/orders', validate({ query: schema.listOrders }), asyncHandler(orders.listOrders));
// Before the :id route, or 'stats' is read as an order id.
router.get('/orders/stats/daily', asyncHandler(orders.dailyStats));
router.get('/orders/:id', asyncHandler(orders.getOrder));

// Confirming and taking orders are the two actions that create a real obligation,
// so they are the two the KYC gate protects.
router.post(
  '/orders',
  requireKyc,
  validate({ body: schema.manualOrder }),
  asyncHandler(orders.createManualOrder)
);
router.post(
  '/orders/:id/confirm',
  requireKyc,
  validate({ body: schema.confirmOrder }),
  asyncHandler(orders.confirmOrder)
);
router.post(
  '/orders/:id/cancel',
  validate({ body: schema.cancelOrder }),
  asyncHandler(orders.cancelOrder)
);
// Delivery name, phone and address, until the order ships. PLAN-2 decision 9.
router.patch(
  '/orders/:id/customer',
  validate({ body: schema.editCustomer }),
  asyncHandler(orders.editCustomer)
);

/* wallet */
router.get('/wallet', asyncHandler(wallet.getWallet));
router.get('/wallet/ledger', asyncHandler(wallet.getLedger));

router.get('/deposits', asyncHandler(wallet.listDeposits));
router.post(
  '/deposits',
  uploadLimiter,
  upload.single('screenshot'),
  handleUploadErrors,
  validate({ body: schema.createDeposit }),
  asyncHandler(wallet.createDeposit)
);

router.get('/withdrawals', asyncHandler(wallet.listWithdrawals));
router.post(
  '/withdrawals',
  validate({ body: schema.createWithdrawal }),
  asyncHandler(wallet.createWithdrawal)
);

router.get('/sms', asyncHandler(wallet.smsCredits));
router.post('/sms/purchase', validate({ body: schema.purchaseSms }), asyncHandler(wallet.purchaseSms));

/* notifications */
router.get('/notifications', asyncHandler(controller.listNotifications));
router.post('/notifications/read', asyncHandler(controller.markNotificationsRead));
router.get('/push/key', asyncHandler(controller.pushKey));
router.post(
  '/push/subscribe',
  validate({ body: schema.subscribePush }),
  asyncHandler(controller.subscribePush)
);
router.post('/push/unsubscribe', asyncHandler(controller.unsubscribePush));
// `/telegram/link` is the original name for issuing a token and still works.
router.post('/telegram/link', asyncHandler(messaging.telegramLinkToken));
router.post('/telegram/link-token', asyncHandler(messaging.telegramLinkToken));
router.delete('/telegram/link', asyncHandler(messaging.telegramUnlink));
router.get('/telegram', asyncHandler(messaging.telegramStatus));

/*
 * Which events reach this reseller on which channel. In-app is always on. The
 * SMS column only matters while SMS is on for everyone and for this reseller;
 * the response says so as `smsAvailable`.
 */
router.get('/notification-preferences', asyncHandler(messaging.getPreferences));
router.put(
  '/notification-preferences',
  validate({ body: prefsSchema.updatePreferences }),
  asyncHandler(messaging.updatePreferences)
);

module.exports = router;
