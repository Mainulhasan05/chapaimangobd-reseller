'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  ClipboardList,
  Contact,
  LayoutDashboard,
  Package,
  Store,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AppShell, type NavItem } from '@/components/app-shell';
import type { Order, Paged } from '@/lib/types';

/**
 * Order matters: the first four reach the bottom bar and the rest go behind
 * More. These four are the daily job. Sharing the shop link is a launch-day task
 * that lives on the dashboard as a button, so it does not need a permanent tab.
 *
 * Notifications used to be the seventh item here. It is now the bell in the
 * header, which is where a reader already looks for one and which is reachable
 * on a phone without opening the More sheet first.
 */
const NAV: NavItem[] = [
  {
    href: '/reseller',
    labelKey: 'nav.dashboard',
    icon: LayoutDashboard,
    section: 'nav.groupDaily',
  },
  {
    href: '/reseller/orders',
    labelKey: 'nav.orders',
    icon: ClipboardList,
    section: 'nav.groupDaily',
  },
  { href: '/reseller/catalog', labelKey: 'nav.catalog', icon: Package, section: 'nav.groupDaily' },
  { href: '/reseller/wallet', labelKey: 'nav.wallet', icon: Wallet, section: 'nav.groupDaily' },
  /*
   * Fifth, so the bottom bar keeps the four that are the daily job and this
   * sits behind More. It is a reference screen, opened when a number rings,
   * rather than something touched every hour.
   */
  { href: '/reseller/customers', labelKey: 'nav.customers', icon: Contact, section: 'nav.groupDaily' },
  { href: '/reseller/shop', labelKey: 'nav.myShop', icon: Store, section: 'nav.groupSetup' },
  { href: '/reseller/kyc', labelKey: 'nav.kyc', icon: BadgeCheck, section: 'nav.groupSetup' },
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

  /*
   * The bell shows a dot rather than a number, so this only needs to know
   * whether anything is unread. It shares a cache key with the notifications
   * page, which means opening that page and marking things read updates the bell
   * without a second request.
   */
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number }>('/reseller/notifications'),
    enabled: Boolean(session),
    refetchInterval: 60_000,
  });

  const nav = NAV.map((item) =>
    item.href === '/reseller/orders' ? { ...item, badge: pending.data?.total ?? 0 } : item
  );

  return (
    <AppShell
      role="reseller"
      nav={nav}
      notificationsHref="/reseller/notifications"
      notificationCount={notifications.data?.unread ?? 0}
    >
      {children}
    </AppShell>
  );
}
