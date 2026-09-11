'use client';

import { NotificationsView } from '@/components/notifications-view';

/**
 * The owner's inbox, which did not exist.
 *
 * Every order a reseller confirms writes the owner a notification. They were
 * being written, queued and pushed, with no screen to read them on and no route
 * that would return them, so the owner learned about a confirmed order only by
 * going and looking at the orders page.
 */
export default function OwnerNotificationsPage() {
  return <NotificationsView base="/owner" ordersHref="/owner/orders" />;
}
