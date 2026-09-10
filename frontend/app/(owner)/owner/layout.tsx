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
 * Ten destinations, four of which reach the bottom bar.
 *
 * The four are the ones touched every day: the day's numbers, the fulfilment
 * queue, the catalog behind it, and the money waiting for a decision. Setup
 * screens that are visited once a season, sources and zones among them, sit
 * behind More rather than competing for a thumb.
 */
const NAV: NavItem[] = [
  { href: '/owner', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/owner/orders', labelKey: 'nav.orders', icon: ClipboardList },
  { href: '/owner/products', labelKey: 'nav.products', icon: Package },
  { href: '/owner/finance', labelKey: 'nav.deposits', icon: Wallet },
  { href: '/owner/resellers', labelKey: 'nav.resellers', icon: Users },
  { href: '/owner/kyc', labelKey: 'nav.kyc', icon: BadgeCheck },
  { href: '/owner/sources', labelKey: 'nav.sources', icon: Store },
  { href: '/owner/zones', labelKey: 'nav.zones', icon: MapPin },
  { href: '/owner/reports', labelKey: 'nav.reports', icon: ChartColumn },
  { href: '/owner/settings', labelKey: 'nav.settings', icon: Settings },
];

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="owner" nav={NAV}>
      {children}
    </AppShell>
  );
}
