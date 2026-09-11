'use client';

import {
  BadgeCheck,
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  MapPin,
  Package,
  Settings,
  Store,
  Users,
  Wallet,
} from 'lucide-react';
import { AppShell, type NavItem } from '@/components/app-shell';

/**
 * Ten destinations, four of which reach the bottom bar on a phone.
 *
 * The four are the ones touched every day: the day's numbers, the fulfilment
 * queue, the catalog behind it, and the money waiting for a decision. Setup
 * screens that are visited once a season, sources and zones among them, sit
 * behind More rather than competing for a thumb.
 *
 * The sections only mean anything in the sidebar, where all ten are visible at
 * once and ten unbroken rows would be a wall. The order still has to put the
 * daily four first, because that is what the bottom bar slices off.
 */
const NAV: NavItem[] = [
  { href: '/owner', labelKey: 'nav.dashboard', icon: LayoutDashboard, section: 'nav.groupDaily' },
  { href: '/owner/orders', labelKey: 'nav.orders', icon: ClipboardList, section: 'nav.groupDaily' },
  { href: '/owner/products', labelKey: 'nav.products', icon: Package, section: 'nav.groupDaily' },
  { href: '/owner/finance', labelKey: 'nav.deposits', icon: Wallet, section: 'nav.groupDaily' },
  { href: '/owner/resellers', labelKey: 'nav.resellers', icon: Users, section: 'nav.groupMoney' },
  { href: '/owner/kyc', labelKey: 'nav.kyc', icon: BadgeCheck, section: 'nav.groupMoney' },
  { href: '/owner/reports', labelKey: 'nav.reports', icon: ChartColumn, section: 'nav.groupMoney' },
  { href: '/owner/sources', labelKey: 'nav.sources', icon: Store, section: 'nav.groupSetup' },
  { href: '/owner/zones', labelKey: 'nav.zones', icon: MapPin, section: 'nav.groupSetup' },
  { href: '/owner/settings', labelKey: 'nav.settings', icon: Settings, section: 'nav.groupSetup' },
];

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="owner" nav={NAV}>
      {children}
    </AppShell>
  );
}
