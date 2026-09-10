'use client';

import { AppShell, type NavItem } from '@/components/app-shell';

const NAV: NavItem[] = [
  { href: '/reseller', labelKey: 'nav.dashboard' },
  { href: '/reseller/orders', labelKey: 'nav.orders' },
  { href: '/reseller/catalog', labelKey: 'nav.catalog' },
  { href: '/reseller/wallet', labelKey: 'nav.wallet' },
  { href: '/reseller/shop', labelKey: 'nav.myShop' },
  { href: '/reseller/kyc', labelKey: 'nav.kyc' },
  { href: '/reseller/notifications', labelKey: 'nav.notifications' },
];

export default function ResellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="reseller" nav={NAV}>
      {children}
    </AppShell>
  );
}
