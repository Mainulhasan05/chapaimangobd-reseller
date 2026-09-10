'use strict';

const express = require('express');
const catalog = require('./catalog.controller');
const resellers = require('./resellers.controller');
const orders = require('./orders.controller');
const finance = require('./finance.controller');
const reports = require('./reports.controller');
const settings = require('./settings.controller');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate, requireRole } = require('../../middleware/auth');
const { upload, handleUploadErrors } = require('../../middleware/upload');
const { ROLES } = require('../../domain/constants');

const router = express.Router();

router.use(authenticate, requireRole(ROLES.OWNER));

/* sources */
router.get('/sources', asyncHandler(catalog.listSources));
router.post('/sources', validate({ body: schema.createSource }), asyncHandler(catalog.createSource));
router.patch(
  '/sources/:id',
  validate({ body: schema.updateSource }),
  asyncHandler(catalog.updateSource)
);
router.delete('/sources/:id', asyncHandler(catalog.archiveSource));

/* products */
router.get('/products', asyncHandler(catalog.listProducts));
router.post(
  '/products',
  upload.array('images', 6),
  handleUploadErrors,
  validate({ body: schema.createProduct }),
  asyncHandler(catalog.createProduct)
);
router.patch(
  '/products/:id',
  upload.array('images', 6),
  handleUploadErrors,
  validate({ body: schema.updateProduct }),
  asyncHandler(catalog.updateProduct)
);
router.delete('/products/:id', asyncHandler(catalog.archiveProduct));

/* delivery zones */
router.get('/delivery-zones', asyncHandler(catalog.listZones));
router.post('/delivery-zones', validate({ body: schema.createZone }), asyncHandler(catalog.createZone));
router.patch(
  '/delivery-zones/:id',
  validate({ body: schema.updateZone }),
  asyncHandler(catalog.updateZone)
);
router.delete('/delivery-zones/:id', asyncHandler(catalog.deleteZone));

/* resellers */
router.get('/resellers', asyncHandler(resellers.listResellers));
router.get('/resellers/:id', asyncHandler(resellers.getReseller));
router.patch(
  '/resellers/:id',
  validate({ body: schema.updateReseller }),
  asyncHandler(resellers.updateReseller)
);
router.get('/resellers/:id/ledger', asyncHandler(finance.resellerLedger));
router.post(
  '/resellers/:id/ledger',
  validate({ body: schema.manualEntry }),
  asyncHandler(finance.manualEntry)
);
router.get('/resellers/:id/reconcile', asyncHandler(finance.reconcile));

/* kyc */
router.get('/kyc', asyncHandler(resellers.listKyc));
router.get('/kyc/:id/documents', asyncHandler(resellers.getKycDocuments));
router.post(
  '/kyc/:id/:decision(approve|reject)',
  validate({ body: schema.reviewDecision }),
  asyncHandler(resellers.decideKyc)
);

/* orders */
router.get('/orders', validate({ query: schema.listOrders }), asyncHandler(orders.listOrders));
router.get('/orders/:id', asyncHandler(orders.getOrder));
router.post('/orders/:id/accept', validate({ body: schema.transitionBody }), asyncHandler(orders.accept));
router.post('/orders/:id/pack', validate({ body: schema.transitionBody }), asyncHandler(orders.pack));
router.post('/orders/:id/ship', validate({ body: schema.shipOrder }), asyncHandler(orders.ship));
router.post('/orders/:id/deliver', validate({ body: schema.transitionBody }), asyncHandler(orders.deliver));
router.post('/orders/:id/cancel', validate({ body: schema.transitionBody }), asyncHandler(orders.cancel));
router.post(
  '/orders/:id/return',
  validate({ body: schema.transitionBody }),
  asyncHandler(orders.markReturned)
);
router.patch(
  '/orders/:id/delivery-charge',
  validate({ body: schema.overrideDeliveryCharge }),
  asyncHandler(orders.overrideDeliveryCharge)
);

/* finance */
router.get('/deposits', validate({ query: schema.listFinance }), asyncHandler(finance.listDeposits));
router.get('/deposits/:id/screenshot', asyncHandler(finance.getDepositScreenshot));
router.post(
  '/deposits/:id/:decision(approve|reject)',
  validate({ body: schema.reviewDecision }),
  asyncHandler(finance.decideDeposit)
);

router.get(
  '/withdrawals',
  validate({ query: schema.listFinance }),
  asyncHandler(finance.listWithdrawals)
);
router.post(
  '/withdrawals/:id/:decision(approve|reject)',
  validate({ body: schema.approveWithdrawal.merge(schema.reviewDecision) }),
  asyncHandler(finance.decideWithdrawal)
);

/* reports */
router.get('/reports/dashboard', asyncHandler(reports.dashboard));
router.get('/reports/receivables', asyncHandler(resellers.receivables));
router.get('/reports/products-sold', asyncHandler(reports.productsSold));
router.get('/reports/orders-by-day', asyncHandler(reports.ordersByDay));
router.get('/reports/reconcile', asyncHandler(finance.reconcile));
router.get('/exports/orders.csv', asyncHandler(reports.exportOrders));
router.get('/exports/ledger.csv', asyncHandler(reports.exportLedger));

/* settings */
router.get('/settings', asyncHandler(settings.get));
router.patch('/settings', validate({ body: schema.updateSettings }), asyncHandler(settings.update));
router.get('/settings/sms-balance', asyncHandler(settings.smsBalance));

module.exports = router;
