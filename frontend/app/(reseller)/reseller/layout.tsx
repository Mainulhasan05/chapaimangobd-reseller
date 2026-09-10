'use client';

import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Bell, ClipboardList, LayoutDashboard, Package, Store, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AppShell, type NavItem } from '@/components/app-shell';
import type { Order, Paged } from '@/lib/types';

/**
 * Order matters: the first four reach the bottom bar and the rest go behind
 * More. These four are the daily job. Sharing the shop link is a launch-day task
 * that lives on the dashboard as a button, so it does not need a permanent tab.
 */
const NAV: NavItem[] = [
  { href: '/reseller', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/reseller/orders', labelKey: 'nav.orders', icon: ClipboardList },
  { href: '/reseller/catalog', labelKey: 'nav.catalog', icon: Package },
  { href: '/reseller/wallet', labelKey: 'nav.wallet', icon: Wallet },
  { href: '/reseller/shop', labelKey: 'nav.myShop', icon: Store },
  { href: '/reseller/kyc', labelKey: 'nav.kyc', icon: BadgeCheck },
  { href: '/reseller/notifications', labelKey: 'nav.notifications', icon: Bell },
];

export default function ResellerLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  /*
   * An order waiting to be confirmed is money not yet moving, so the count rides
   * on the tab rather than waiting to be discovered on the orders page. Gated on
   * the session because the layout renders before the redirect to /login, and an
   * ungated query would fire a guaranteed 401 on the way out.
   */
  const pending = useQuery({
    queryKey: ['orders', 'pending'],
    queryFn: () => api.get<Paged<'orders', Order>>('/reseller/orders?status=pending&limit=5'),
    enabled: Boolean(session),
    refetchInterval: 60_000,
  });

  const nav = NAV.map((item) =>
    item.href === '/reseller/orders' ? { ...item, badge: pending.data?.total ?? 0 } : item
  );

  return (
    <AppShell role="reseller" nav={nav}>
      {children}
    </AppShell>
  );
}
