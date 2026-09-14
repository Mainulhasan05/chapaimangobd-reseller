'use strict';

const env = require('../config/env');
const ResellerProfile = require('../models/ResellerProfile');
const gateway = require('../channels/sms');
const { getSettings } = require('./settings');
const { renderCustomerSms, templateFor, ACTIONS } = require('../domain/customerSms');
const { badRequest } = require('../utils/errors');

/**
 * Loads what a customer SMS needs and renders it. The preview endpoint and the
 * transition that queues the message both come through here with the same
 * inputs, which is what makes "exactly the previewed text is sent" true rather
 * than hoped for. See domain/customerSms.js and docs/adr/0013.
 */

/** Customer SMS needs only a configured gateway: it is owner-paid. */
const isAvailable = () => gateway.isConfigured();

function assertAvailable() {
  if (!isAvailable()) {
    throw badRequest('SMS_UNAVAILABLE', 'The SMS gateway is not configured, so no SMS can be sent');
  }
}

/**
 * `order` may be the order before the transition (preview) or after it (queue);
 * only its code, customer and totals are read, and none of those change here.
 * The courier and reason are passed explicitly for the same reason.
 */
async function buildCustomerSms({ order, action, courierName, trackingNumber, reason, session }) {
  if (!ACTIONS.includes(action)) {
    throw badRequest('INVALID_ACTION', 'Customer SMS is only sent on accept, ship or cancel');
  }

  const [settings, profile] = await Promise.all([
    getSettings({ fresh: true }),
    ResellerProfile.findById(order.reseller._id || order.reseller)
      .select('shopName slug')
      .session(session || null),
  ]);

  return renderCustomerSms({
    template: templateFor(settings, action),
    order,
    profile,
    settings,
    courierName,
    trackingNumber,
    reason,
    publicAppUrl: env.publicAppUrl,
  });
}

module.exports = { isAvailable, assertAvailable, buildCustomerSms };
