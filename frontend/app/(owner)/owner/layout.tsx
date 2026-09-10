'use client';

import { AppShell, type NavItem } from '@/components/app-shell';

const NAV: NavItem[] = [
  { href: '/owner', labelKey: 'nav.dashboard' },
  { href: '/owner/orders', labelKey: 'nav.orders' },
  { href: '/owner/products', labelKey: 'nav.products' },
  { href: '/owner/sources', labelKey: 'nav.sources' },
  { href: '/owner/zones', labelKey: 'nav.zones' },
  { href: '/owner/resellers', labelKey: 'nav.resellers' },
  { href: '/owner/kyc', labelKey: 'nav.kyc' },
  { href: '/owner/finance', labelKey: 'nav.deposits' },
  { href: '/owner/reports', labelKey: 'nav.reports' },
  { href: '/owner/settings', labelKey: 'nav.settings' },
];

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="owner" nav={NAV}>
      {children}
    </AppShell>
  );
}
