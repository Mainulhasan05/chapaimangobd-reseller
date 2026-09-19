'use strict';

const { SHOP_CLOSED_REASON } = require('./constants');
const { kycBlocks } = require('./kyc');

/**
 * Whether a shop takes orders, and if not, why.
 *
 * One answer for the shop page and the order submission alike, so the page can
 * never invite an order the submission would then refuse. The account flag is
 * checked first: a deactivated reseller's shop is closed whatever the profile
 * says, and the reason is the one a customer is shown. See docs/adr/0011.
 *
 * KYC closes a shop only where the owner asked that reseller for it: a
 * reseller who was never asked has nothing pending and nothing to prove, so
 * the question does not arise. See docs/adr/0017.
 *
 * @param {{ kycRequired: boolean, kycStatus: string, formActive: boolean }} profile
 * @param {{ isActive: boolean } | null} user the reseller's account
 * @returns {{ acceptingOrders: boolean, reason: string | null }}
 */
function shopAvailability(profile, user) {
  if (!user || !user.isActive) {
    return { acceptingOrders: false, reason: SHOP_CLOSED_REASON.INACTIVE };
  }
  if (kycBlocks(profile)) {
    return { acceptingOrders: false, reason: SHOP_CLOSED_REASON.KYC };
  }
  if (!profile.formActive) {
    return { acceptingOrders: false, reason: SHOP_CLOSED_REASON.CLOSED };
  }
  return { acceptingOrders: true, reason: null };
}

module.exports = { shopAvailability };
