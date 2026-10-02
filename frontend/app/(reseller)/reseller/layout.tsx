'use client';

import { skipToken } from '@reduxjs/toolkit/query/react';
import {
  BadgeCheck,
  ClipboardList,
  Contact,
  LayoutDashboard,
  Package,
  Store,
  UserCog,
  Wallet,
} from 'lucide-react';
import { useSession } from '@/lib/session';
import { kycVisible } from '@/lib/kyc';
import { LIVE } from '@/lib/store/api';
import { useGetResellerOrdersInfiniteQuery } from '@/lib/store/endpoints/reseller';
import { useGetNotificationsInfiniteQuery } from '@/lib/store/endpoints/notifications';
import { AppShell, type NavItem } from '@/components/app-shell';

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
  { href: '/reseller/account', labelKey: 'nav.account', icon: UserCog, section: 'nav.groupSetup' },
];

export default function ResellerLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  // No background reads while a temporary password is still in use: the API
  // refuses them (PASSWORD_CHANGE_REQUIRED) and the shell is on its way to Account.
  const ready = Boolean(session) && !session?.user.mustChangePassword;

  /*
   * An order waiting to be confirmed is money not yet moving, so the count rides
   * on the tab rather than waiting to be discovered on the orders page. Gated on
   * the session because the layout renders before the redirect to /login, and an
   * ungated query would fire a guaranteed 401 on the way out.
   */
  const pending = useGetResellerOrdersInfiniteQuery(
    ready ? { status: 'pending', limit: 5 } : skipToken,
    LIVE
  );

  /*
   * The bell shows a dot rather than a number, so this only needs to know
   * whether anything is unread. Marking things read on the notifications page
   * updates this entry optimistically, so the bell clears without a second request.
   */
  const notifications = useGetNotificationsInfiniteQuery(
    ready ? { role: 'reseller', limit: 1 } : skipToken,
    LIVE
  );

  /*
   * KYC is not on the tab list unless it is this reseller's business: the owner
   * asked them to verify, or they already submitted something. Dropped rather
   * than disabled, because a permanently greyed tab is a question a reseller
   * cannot answer. The page behind it says the same thing. See docs/adr/0017.
   */
  const nav = NAV.filter(
    (item) => item.href !== '/reseller/kyc' || kycVisible(session?.profile)
  ).map((item) =>
    item.href === '/reseller/orders' ? { ...item, badge: pending.data?.pages[0]?.total ?? 0 } : item
  );

  return (
    <AppShell
      role="reseller"
      nav={nav}
      notificationsHref="/reseller/notifications"
      notificationCount={notifications.data?.pages[0]?.unread ?? 0}
    >
      {children}
    </AppShell>
  );
}
