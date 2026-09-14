'use client';

import { NotificationSettings } from '@/components/notification-settings';

/** Browser push, Telegram and per-event channels, for a reseller. */
export default function ResellerNotificationSettingsPage() {
  return <NotificationSettings base="/reseller" />;
}
