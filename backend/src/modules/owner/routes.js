'use strict';

const express = require('express');
const catalog = require('./catalog.controller');
const resellers = require('./resellers.controller');
const orders = require('./orders.controller');
const finance = require('./finance.controller');
const reports = require('./reports.controller');
const settings = require('./settings.controller');
const landing = require('./landing.controller');
const sms = require('./sms.controller');
const customers = require('./customers.controller');
const complaints = require('./complaints.controller');
const auditLog = require('./audit.controller');
const notifications = require('../shared/notifications.controller');
const messaging = require('../shared/messaging.controller');
const prefsSchema = require('../shared/notificationPrefs.schema');
const schema = require('./schema');
const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { authenticate, requireRole } = require('../../middleware/auth');
const { upload, handleUploadErrors } = require('../../middleware/upload');
const { ROLES } = require('../../domain/constants');
const { createLimiter } = require('../../services/rateLimitStore');

const router = express.Router();

router.use(authenticate, requireRole(ROLES.OWNER));

/*
 * The owner is trusted, but a stolen session or a stuck retry loop is not, and
 * each upload goes out to the image host. Generous: a catalog of a few dozen
 * products, each with six photos, fits comfortably in an hour.
 */
const uploadLimiter = createLimiter({
  name: 'upload-owner',
  windowMs: 60 * 60 * 1000,
  limit: 200,
  keyGenerator: (req) => String(req.user._id),
  // A JSON edit on the same route carries no file and is not counted.
  skip: (req) => !req.is('multipart/form-data'),
  message: 'Too many uploads, please try again later',
});

/* sources */
router.get('/sources', asyncHandler(catalog.listSources));
router.post('/sources', validate({ body: schema.createSource }), asyncHandler(catalog.createSource));
router.patch(
  '/sources/:id',
  validate({ body: schema.updateSource }),
  asyncHandler(catalog.updateSource)
);
/*
 * One orchard, with what it has supplied and everything said about it. The
 * screen a complaint leads to: the question it answers is whether to keep
 * buying from here. Registered before the PATCH so the id route reads normally.
 */
router.get('/sources/:id', validate({ query: schema.dateRange }), asyncHandler(complaints.getSource));
router.delete('/sources/:id', asyncHandler(catalog.archiveSource));

/* products */
router.get('/products', asyncHandler(catalog.listProducts));
router.post(
  '/products',
  uploadLimiter,
  upload.array('images', 6),
  handleUploadErrors,
  validate({ body: schema.createProduct }),
  asyncHandler(catalog.createProduct)
);
router.patch(
  '/products/:id',
  uploadLimiter,
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
/*
 * A temporary password is a credential handed out by hand. Few are ever needed;
 * a burst means a stolen owner session walking the reseller list.
 */
const passwordResetLimiter = createLimiter({
  name: 'owner-password-reset',
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => String(req.user._id),
  message: 'Too many password resets, please try again later',
});
router.post(
  '/resellers/:id/password-reset',
  passwordResetLimiter,
  asyncHandler(resellers.resetPassword)
);
router.get('/resellers/:id/ledger', asyncHandler(finance.resellerLedger));
router.post(
  '/resellers/:id/ledger',
  validate({ body: schema.manualEntry }),
  asyncHandler(finance.manualEntry)
);
router.get('/resellers/:id/reconcile', asyncHandler(finance.reconcile));

/*
 * customers
 *
 * A buyer is a phone number with a history, not a row per order. See
 * models/Customer.js for why the number is the identity and the name is not.
 */
router.get('/customers', asyncHandler(customers.listCustomers));
router.get('/customers/:id', asyncHandler(customers.getCustomer));

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
/*
 * The counts and money for the filter the list is showing. Registered before
 * `/orders/:id` because Express matches in order and `summary` would otherwise
 * be read as an order id and answered with a cast error.
 */
router.get(
  '/orders/summary',
  validate({ query: schema.orderSummary }),
  asyncHandler(orders.ordersSummary)
);
router.get('/orders/:id', asyncHandler(orders.getOrder));
// The exact text a customer SMS would carry, before the owner ticks the box.
router.get(
  '/orders/:id/customer-sms-preview',
  validate({ query: schema.customerSmsPreview }),
  asyncHandler(orders.customerSmsPreview)
);
router.post('/orders/:id/accept', validate({ body: schema.acceptBody }), asyncHandler(orders.accept));
router.post('/orders/:id/pack', validate({ body: schema.transitionBody }), asyncHandler(orders.pack));
router.post('/orders/:id/ship', validate({ body: schema.shipOrder }), asyncHandler(orders.ship));
router.post('/orders/:id/deliver', validate({ body: schema.transitionBody }), asyncHandler(orders.deliver));
router.post('/orders/:id/cancel', validate({ body: schema.cancelBody }), asyncHandler(orders.cancel));
router.post(
  '/orders/:id/return',
  validate({ body: schema.returnBody }),
  asyncHandler(orders.markReturned)
);
router.patch(
  '/orders/:id/delivery-charge',
  validate({ body: schema.overrideDeliveryCharge }),
  asyncHandler(orders.overrideDeliveryCharge)
);
/*
 * What a customer said was wrong. Never changes the order's status and never
 * moves money: the order happened, and a return or a refund is its own
 * decision with its own ledger entries. See models/Complaint.js.
 */
router.get('/orders/:id/complaints', asyncHandler(complaints.orderComplaints));
router.post(
  '/orders/:id/complaints',
  validate({ body: schema.createComplaint }),
  asyncHandler(complaints.createComplaint)
);
// Delivery name, phone and address, until the order ships. PLAN-2 decision 9.
router.patch(
  '/orders/:id/customer',
  validate({ body: schema.editCustomer }),
  asyncHandler(orders.editCustomer)
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

/* complaints */
router.get(
  '/complaints',
  validate({ query: schema.listComplaints }),
  asyncHandler(complaints.listComplaints)
);
router.post(
  '/complaints/:id/resolve',
  validate({ body: schema.resolveComplaint }),
  asyncHandler(complaints.resolveComplaint)
);

/* audit log */
router.get('/audit', validate({ query: schema.listAudit }), asyncHandler(auditLog.list));

/*
 * reports
 *
 * Every one of these reads a Dhaka date off the query string. Validated rather
 * than trusted: an unchecked value reached `new Date()` as an Invalid Date and
 * came back out of Mongoose as a 500, so `?from=last-week` was a crash report
 * instead of a bad request.
 */
const range = validate({ query: schema.dateRange });

router.get('/reports/dashboard', asyncHandler(reports.dashboard));
router.get('/reports/receivables', asyncHandler(resellers.receivables));
router.get('/reports/products-sold', range, asyncHandler(reports.productsSold));
router.get('/reports/orders-by-day', range, asyncHandler(reports.ordersByDay));
// What traded over a range: totals, by day, by product, by payment mode.
router.get('/reports/sales', range, asyncHandler(reports.sales));
// Who sold it, against where their wallet stands today.
router.get('/reports/resellers', range, asyncHandler(reports.resellerPerformance));
// Stock on the shelf against what has been leaving it.
router.get('/reports/products', range, asyncHandler(reports.productsReport));
// Every orchard side by side, worst record first. The report this exists for.
router.get('/reports/sources', range, asyncHandler(complaints.sourcesReport));
// Who buys, and who refuses parcels. See models/Customer.js.
router.get(
  '/reports/customers',
  validate({ query: schema.customersReport }),
  asyncHandler(reports.customersReport)
);
// What has to be collected, and from which orchard. See docs/adr/0006.
router.get('/reports/pick-list', range, asyncHandler(reports.pickList));
// Every order matching a filter, unpaged, for the printable dispatch sheet.
router.get(
  '/reports/order-sheet',
  validate({ query: schema.orderSheet }),
  asyncHandler(reports.orderSheet)
);
router.get('/reports/reconcile', asyncHandler(finance.reconcile));
router.get(
  '/exports/orders.csv',
  validate({ query: schema.orderSummary }),
  asyncHandler(reports.exportOrders)
);
router.get('/exports/ledger.csv', range, asyncHandler(reports.exportLedger));

/* settings */
router.get('/settings', asyncHandler(settings.get));
router.patch('/settings', validate({ body: schema.updateSettings }), asyncHandler(settings.update));
/*
 * A public asset, hosted rather than stored. Everything the owner uploads here
 * is meant to be seen by logged-out customers; anything confidential belongs in
 * the private bucket, which nothing on this route can reach.
 */
router.post(
  '/settings/brand-logo',
  uploadLimiter,
  upload.single('image'),
  handleUploadErrors,
  asyncHandler(settings.uploadBrandLogo)
);
router.delete('/settings/brand-logo', asyncHandler(settings.removeBrandLogo));
router.get('/settings/sms-balance', asyncHandler(settings.smsBalance));

/*
 * landing page
 *
 * The content every public shop page is built from. Photos and reviews are
 * multipart and public, so they go to the image host like the brand logo.
 */
router.get('/landing', asyncHandler(landing.get));
router.patch('/landing', validate({ body: schema.updateLanding }), asyncHandler(landing.update));
router.post(
  '/landing/hero-images',
  uploadLimiter,
  upload.array('images', 6),
  handleUploadErrors,
  asyncHandler(landing.addHeroImages)
);
router.delete('/landing/hero-images/:imageId', asyncHandler(landing.removeHeroImage));
router.post(
  '/landing/reviews',
  uploadLimiter,
  upload.single('image'),
  handleUploadErrors,
  validate({ body: schema.addLandingReview }),
  asyncHandler(landing.addReview)
);
router.delete('/landing/reviews/:reviewId', asyncHandler(landing.removeReview));
router.get('/system/health', asyncHandler(settings.systemHealth));

/*
 * sms
 *
 * The switch and the record, together, because they are read together: the
 * reason to touch the switch is nearly always something seen in the record.
 * `/settings` can still set `features.sms` alongside everything else, and both
 * write the same field and the same audit action; this is the route the panel
 * uses, where turning SMS off is the only thing the request can do.
 */
router.get('/sms/overview', asyncHandler(sms.overview));
router.post('/sms/toggle', validate({ body: schema.toggleSms }), asyncHandler(sms.toggle));
router.get('/sms/logs', validate({ query: schema.listSmsLogs }), asyncHandler(sms.listLogs));
router.get('/sms/logs/:id', asyncHandler(sms.getLog));
router.post('/sms/logs/:id/resend', asyncHandler(sms.resend));
router.post('/sms/test', validate({ body: schema.sendTestSms }), asyncHandler(sms.sendTest));

/*
 * The owner's inbox.
 *
 * Every confirmed order already wrote the owner a notification and queued it
 * for Telegram and web push; there was simply no route that would hand them
 * back, so the owner's copy piled up unread and unreadable. Same five handlers
 * the reseller uses, scoped by the signed-in user rather than by role.
 */
router.get('/notifications', asyncHandler(notifications.list));
router.post('/notifications/read', asyncHandler(notifications.markRead));
router.get('/push/key', asyncHandler(notifications.pushKey));
router.post(
  '/push/subscribe',
  validate({ body: schema.subscribePush }),
  asyncHandler(notifications.subscribePush)
);
router.post('/push/unsubscribe', asyncHandler(notifications.unsubscribePush));

/*
 * Telegram and per-event channel choices, the same handlers the reseller uses.
 * The owner's SMS here is owner-paid (docs/adr/0013).
 */
router.get('/telegram', asyncHandler(messaging.telegramStatus));
router.post('/telegram/link-token', asyncHandler(messaging.telegramLinkToken));
router.delete('/telegram/link', asyncHandler(messaging.telegramUnlink));
router.get('/notification-preferences', asyncHandler(messaging.getPreferences));
router.put(
  '/notification-preferences',
  validate({ body: prefsSchema.updatePreferences }),
  asyncHandler(messaging.updatePreferences)
);

module.exports = router;
