'use client';

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { useSession } from '@/lib/session';
import { kycBlocks } from '@/lib/kyc';
import { t, tf } from '@/lib/i18n/bn';
import { useGetResellerKycQuery } from '@/lib/store/endpoints/reseller';
import { skipToken } from '@reduxjs/toolkit/query';
import { Alert } from '@/components/ui/layout';

/**
 * The reseller can do their setup work while KYC is pending, so this explains
 * what is still blocked rather than blocking the whole dashboard.
 *
 * Each state gets its own words and its own way forward: nothing sent yet asks
 * for the documents, a pending review says there is nothing to do but wait, and
 * a rejection says why, in the owner's words, and offers to send again. It used
 * to say "pending" over a "submit documents" link in all three.
 *
 * Nothing at all for a reseller the owner never asked to verify, which is every
 * reseller by default: there is no gate to explain. See docs/adr/0017.
 */
export function KycBanner() {
  const { data: session } = useSession();
  const status = session?.profile?.kycStatus;
  const blocked = Boolean(status) && kycBlocks(session?.profile);

  // The owner's reason is on the submission, read only when there is one to show.
  const kyc = useGetResellerKycQuery(blocked && status === 'rejected' ? undefined : skipToken);
  const reason = kyc.data?.submission?.note;

  if (!status || !blocked) return null;

  if (status === 'pending') {
    return (
      <Alert tone="warning" title={t('kycReview.bannerPendingTitle')} icon={ShieldAlert}>
        <p className="mt-1">{t('kyc.pendingHelp')}</p>
        <Link href="/reseller/kyc" className="tap mt-1 inline-flex items-center font-semibold underline underline-offset-2">
          {t('kycReview.bannerPendingCta')}
        </Link>
      </Alert>
    );
  }

  const rejected = status === 'rejected';
  return (
    <Alert
      tone={rejected ? 'danger' : 'warning'}
      title={rejected ? t('kycReview.bannerRejectedTitle') : t('kycReview.bannerNeededTitle')}
      icon={ShieldAlert}
    >
      {rejected && reason && <p className="mt-1 font-medium">{tf('kycReview.bannerReason', { reason })}</p>}
      <p className="mt-1">{t('kyc.gateHelp')}</p>
      <Link href="/reseller/kyc" className="tap mt-1 inline-flex items-center font-semibold underline underline-offset-2">
        {rejected ? t('kycReview.bannerResubmit') : t('kyc.submit')}
      </Link>
    </Alert>
  );
}
