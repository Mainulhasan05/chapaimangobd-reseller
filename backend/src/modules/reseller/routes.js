'use strict';

const express = require('express');
const controller = require('./controller');
const orders = require('./orders.controller');
const wallet = require('./wallet.controller');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate, requireRole, loadReseller, requireKyc } = require('../../middleware/auth');
const { upload, handleUploadErrors } = require('../../middleware/upload');
const { ROLES, KYC_DOC_TYPE } = require('../../domain/constants');

const router = express.Router();

// Everything below is a signed-in reseller acting on their own data. The scope is
// applied per query, never inferred from a header the proxy could have set.
router.use(authenticate, requireRole(ROLES.RESELLER), loadReseller);

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
  upload.single('logo'),
  handleUploadErrors,
  asyncHandler(controller.uploadLogo)
);
router.delete('/profile/logo', asyncHandler(controller.removeLogo));

const kycFields = Object.values(KYC_DOC_TYPE).map((name) => ({ name, maxCount: 1 }));
router.post(
  '/kyc',
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

/* wallet */
router.get('/wallet', asyncHandler(wallet.getWallet));
router.get('/wallet/ledger', asyncHandler(wallet.getLedger));

router.get('/deposits', asyncHandler(wallet.listDeposits));
router.post(
  '/deposits',
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
router.post('/telegram/link', asyncHandler(controller.telegramLink));

module.exports = router;
