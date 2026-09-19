'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';
import { kycBlocks } from '@/lib/kyc';
import { t } from '@/lib/i18n/bn';
import { ShieldAlert } from 'lucide-react';
import { Alert } from '@/components/ui/layout';

/**
 * The reseller can do their setup work while KYC is pending, so this explains
 * what is still blocked rather than blocking the whole dashboard.
 *
 * Nothing at all for a reseller the owner never asked to verify, which is every
 * reseller by default: there is no gate to explain. See docs/adr/0017.
 */
export function KycBanner() {
  const { data: session } = useSession();
  const status = session?.profile?.kycStatus;

  if (!status || !kycBlocks(session?.profile)) return null;

  const tone = status === 'rejected' ? 'danger' : 'warning';
  const title = status === 'rejected' ? t('kyc.rejected') : t('kyc.pending');

  return (
    <Alert tone={tone} title={title} icon={ShieldAlert}>
      <p className="mt-1">{t('kyc.gateHelp')}</p>
      <Link href="/reseller/kyc" className="mt-2 inline-block font-semibold underline underline-offset-2">
        {t('kyc.submit')}
      </Link>
    </Alert>
  );
}
