'use client';

import {
  BadgeCheck,
  ChartColumn,
  ClipboardList,
  Contact,
  LayoutDashboard,
  LayoutTemplate,
  MapPin,
  MessageSquare,
  Package,
  ScrollText,
  Settings,
  Store,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AppShell, type NavItem } from '@/components/app-shell';
import type { Order, Paged } from '@/lib/types';

/**
 * Fourteen destinations, four of which reach the bottom bar on a phone.
 *
 * The four are the ones touched every day: the day's numbers, the fulfilment
 * queue, the catalog behind it, and the money waiting for a decision. Setup
 * screens that are visited once a season, sources and zones among them, sit
 * behind More rather than competing for a thumb.
 *
 * The sections only mean anything in the sidebar, where all of them are visible
 * at once and an unbroken column that long would be a wall. The order still has
 * to put the daily four first, because that is what the bottom bar slices off.
 */
const NAV: NavItem[] = [
  { href: '/owner', labelKey: 'nav.dashboard', icon: LayoutDashboard, section: 'nav.groupDaily' },
  { href: '/owner/orders', labelKey: 'nav.orders', icon: ClipboardList, section: 'nav.groupDaily' },
  { href: '/owner/products', labelKey: 'nav.products', icon: Package, section: 'nav.groupDaily' },
  { href: '/owner/finance', labelKey: 'nav.deposits', icon: Wallet, section: 'nav.groupDaily' },
  { href: '/owner/resellers', labelKey: 'nav.resellers', icon: Users, section: 'nav.groupMoney' },
  { href: '/owner/customers', labelKey: 'nav.customers', icon: Contact, section: 'nav.groupMoney' },
  { href: '/owner/kyc', labelKey: 'nav.kyc', icon: BadgeCheck, section: 'nav.groupMoney' },
  { href: '/owner/reports', labelKey: 'nav.reports', icon: ChartColumn, section: 'nav.groupMoney' },
  { href: '/owner/sources', labelKey: 'nav.sources', icon: Store, section: 'nav.groupSetup' },
  // The content every reseller's public page is drawn from.
  { href: '/owner/landing', labelKey: 'nav.landing', icon: LayoutTemplate, section: 'nav.groupSetup' },
  { href: '/owner/zones', labelKey: 'nav.zones', icon: MapPin, section: 'nav.groupSetup' },
  /*
   * SMS sits in setup because it is configured once, but it is the one setup
   * screen with a control the owner may need in a hurry: the master switch that
   * stops every message the platform would send.
   */
  { href: '/owner/sms', labelKey: 'nav.sms', icon: MessageSquare, section: 'nav.groupSetup' },
  { href: '/owner/settings', labelKey: 'nav.settings', icon: Settings, section: 'nav.groupSetup' },
  // Who changed what. Read when something needs explaining, so it sits with setup.
  { href: '/owner/audit', labelKey: 'nav.audit', icon: ScrollText, section: 'nav.groupSetup' },
  { href: '/owner/account', labelKey: 'nav.account', icon: UserCog, section: 'nav.groupSetup' },
];

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  // No background reads while a temporary password is still in use: the API
  // refuses them (PASSWORD_CHANGE_REQUIRED) and the shell is on its way to Account.
  const ready = Boolean(session) && !session?.user.mustChangePassword;

  /*
   * Orders waiting to be accepted. A confirmed order is one the reseller has
   * committed to and the owner has not yet touched, and mangoes do not wait, so
   * the count rides on the tab rather than waiting to be discovered. Gated on
   * the session because the layout renders before the redirect to /login, and an
   * ungated query would fire a guaranteed 401 on the way out.
   */
  const waiting = useQuery({
    queryKey: ['owner', 'orders', 'confirmed'],
    queryFn: () => api.get<Paged<'orders', Order>>('/owner/orders?status=confirmed&limit=5'),
    enabled: ready,
    refetchInterval: 60_000,
  });

  /*
   * Only the count is wanted, so one row is asked for. The key is the prefix of
   * the notifications page's own, so marking things read there refreshes the bell.
   */
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number }>('/owner/notifications?limit=1'),
    enabled: ready,
    refetchInterval: 60_000,
  });

  const nav = NAV.map((item) =>
    item.href === '/owner/orders' ? { ...item, badge: waiting.data?.total ?? 0 } : item
  );

  return (
    <AppShell
      role="owner"
      nav={nav}
      notificationsHref="/owner/notifications"
      notificationCount={notifications.data?.unread ?? 0}
    >
      {children}
    </AppShell>
  );
}
