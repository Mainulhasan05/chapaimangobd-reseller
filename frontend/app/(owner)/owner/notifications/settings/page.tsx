'use client';

import { NotificationSettings } from '@/components/notification-settings';

/** Browser push, Telegram and per-event channels, for the owner. */
export default function OwnerNotificationSettingsPage() {
  return <NotificationSettings base="/owner" />;
}
