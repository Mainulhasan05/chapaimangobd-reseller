'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { Alert } from '@/components/ui/layout';

/**
 * The reseller can do their setup work while KYC is pending, so this explains
 * what is still blocked rather than blocking the whole dashboard.
 */
export function KycBanner() {
  const { data: session } = useSession();
  const status = session?.profile?.kycStatus;

  if (!status || status === 'approved') return null;

  const tone = status === 'rejected' ? 'danger' : 'warning';
  const title = status === 'rejected' ? t('kyc.rejected') : t('kyc.pending');

  return (
    <Alert tone={tone} title={title}>
      <p className="mt-1">{t('kyc.gateHelp')}</p>
      <Link href="/reseller/kyc" className="mt-2 inline-block font-medium underline">
        {t('kyc.submit')}
      </Link>
    </Alert>
  );
}
