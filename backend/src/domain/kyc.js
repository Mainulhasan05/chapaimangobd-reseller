'use strict';

const { KYC_STATUS } = require('./constants');

/**
 * Whether identity verification is part of this reseller's life at all.
 *
 * KYC is **off by default**. A new reseller sees no KYC screen, is asked for no
 * national ID, and is gated by nothing: they register, price products, open
 * their shop and sell. The owner turns it on for one reseller at a time, by
 * setting `kycRequired` on their profile, and only then does the module appear
 * and the gate close. See docs/adr/0017.
 *
 * Two questions, deliberately separate, because they have different answers:
 *
 * - **required** — does KYC gate this reseller's shop and orders? Exactly the
 *   owner's flag. Turning it off lifts the gate immediately, whatever documents
 *   were or were not submitted.
 * - **visible** — should this reseller see the KYC module? The flag, *or* the
 *   fact that they already submitted something. A reseller who handed over
 *   their national ID never loses sight of it because the owner later switched
 *   the requirement off; hiding it would look like the documents had vanished.
 *
 * Every gate and every screen reads these, never `kycRequired` directly, so a
 * reseller the owner has not asked cannot be refused for not having asked.
 */

/** True when this reseller's KYC must be approved before they may sell. */
function kycRequired(profile) {
  return Boolean(profile && profile.kycRequired);
}

/** True when the KYC module belongs on this reseller's screens. */
function kycVisible(profile) {
  if (!profile) return false;
  return kycRequired(profile) || profile.kycStatus !== KYC_STATUS.NOT_SUBMITTED;
}

/**
 * True when a gated action must be refused: KYC is required of this reseller
 * and has not passed. The one predicate behind the form switch, the slug, the
 * public shop and the manual order.
 */
function kycBlocks(profile) {
  return kycRequired(profile) && profile.kycStatus !== KYC_STATUS.APPROVED;
}

/** True when the reseller may upload documents now. */
function kycCanSubmit(profile) {
  return (
    kycRequired(profile) &&
    (profile.kycStatus === KYC_STATUS.NOT_SUBMITTED || profile.kycStatus === KYC_STATUS.REJECTED)
  );
}

module.exports = { kycRequired, kycVisible, kycBlocks, kycCanSubmit };
