'use client';

import { NotificationsView } from '@/components/notifications-view';

/** The reseller half of the shared inbox; see components/notifications-view.tsx. */
export default function NotificationsPage() {
  return <NotificationsView base="/reseller" ordersHref="/reseller/orders" />;
}
