import type { KycStatus } from '@/lib/types';

/**
 * Whether identity verification is part of this reseller's life at all.
 *
 * The mirror of the backend's `domain/kyc.js`, and the only place a screen asks
 * the question. KYC is off by default: a new reseller has no KYC tab, no upload
 * form, no banner and no gate. The owner turns it on for one reseller at a
 * time. See docs/adr/0017.
 *
 * These are conveniences for drawing a screen, never a control. The API refuses
 * an upload with `KYC_NOT_REQUIRED` and a shop opening with a 403 regardless of
 * what the interface chose to show.
 */

/** The shape every one of these reads. The session profile satisfies it. */
export type KycSubject = { kycRequired?: boolean; kycStatus: KycStatus };

/** True when this reseller's verification must pass before they may sell. */
export function kycRequired(subject: KycSubject | null | undefined): boolean {
  return Boolean(subject?.kycRequired);
}

/**
 * True when the KYC module belongs on this reseller's screens.
 *
 * The requirement, or documents already handed over. A reseller who submitted
 * their national ID keeps sight of it after the owner lifts the requirement:
 * hiding it then would look like the documents had disappeared.
 */
export function kycVisible(subject: KycSubject | null | undefined): boolean {
  if (!subject) return false;
  return kycRequired(subject) || subject.kycStatus !== 'not_submitted';
}

/**
 * True when a gated thing must be shown as blocked: verification is required of
 * this reseller and has not passed. The one predicate behind the form switch,
 * the shop address field, the dashboard's share button and the setup checklist.
 */
export function kycBlocks(subject: KycSubject | null | undefined): boolean {
  return kycRequired(subject) && subject!.kycStatus !== 'approved';
}
