'use client';

import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatDateTime } from '@/lib/format';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';

type NotificationRow = {
  _id: string;
  eventType: string;
  title: string;
  body?: string;
  readAt: string | null;
  createdAt: string;
};

type PushState = 'unsupported' | 'ios-install' | 'default' | 'granted' | 'denied';

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ notifications: NotificationRow[]; unread: number }>('/reseller/notifications'),
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/reseller/notifications/read'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <>
      <PageHeader
        title={t('nav.notifications')}
        action={
          (notifications.data?.unread ?? 0) > 0 ? (
            <Button size="sm" variant="outline" loading={markRead.isPending} onClick={() => markRead.mutate()}>
              {t('app.yes')}
            </Button>
          ) : undefined
        }
      />

      <PushCard />
      {session?.features.telegram && <TelegramCard />}

      <Card>
        <CardHeader title={t('nav.notifications')} />

        {notifications.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {notifications.data?.notifications.length === 0 && <EmptyState title={t('app.none')} />}

        <ul className="divide-y divide-border">
          {notifications.data?.notifications.map((row) => (
            <li key={row._id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className={row.readAt ? 'text-muted-foreground' : 'font-medium'}>{row.title}</p>
                {row.body && <p className="text-sm text-muted-foreground">{row.body}</p>}
                <p className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
              </div>
              {!row.readAt && <Badge tone="primary">{t('app.yes')}</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** Reads the browser permission. Nothing to subscribe to: it changes on reload. */
const subscribeToNothing = () => () => {};

function readPushState(): PushState {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported) {
    // iOS Safari only exposes PushManager once the site is installed.
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios-install' : 'unsupported';
  }
  return Notification.permission as PushState;
}

/**
 * Web push is a nudge, never a guarantee: Xiaomi, Realme, Oppo and Vivo battery
 * savers kill the browser background process, and on iOS this only works from a
 * home screen install. The in-app list is the source of truth.
 */
function PushCard() {
  // An external system read, so it goes through useSyncExternalStore rather than
  // an effect that pushes the value into state and costs a second render.
  const detected = useSyncExternalStore<PushState>(
    subscribeToNothing,
    readPushState,
    () => 'default'
  );
  const [granted, setGranted] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = granted ?? detected;

  const enable = useMutation({
    mutationFn: async () => {
      // Requested from a click, never on load: Chrome permanently penalises a
      // site that asks without a user gesture.
      const permission = await Notification.requestPermission();
      setGranted(permission as PushState);
      if (permission !== 'granted') return;

      const { publicKey } = await api.get<{ publicKey: string | null }>('/reseller/push/key');
      if (!publicKey) throw new Error('সার্ভারে পুশ কনফিগার করা হয়নি');

      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      const json = subscription.toJSON() as { endpoint: string; keys: Record<string, string> };
      await api.post('/reseller/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('nav.notifications')}
        subtitle="ফোনে সাথে সাথে জানতে চালু করুন"
        action={<Badge tone={state === 'granted' ? 'success' : 'neutral'}>{state}</Badge>}
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {state === 'ios-install' && (
        <Alert tone="warning">
          আইফোনে নোটিফিকেশন পেতে সাফারির শেয়ার মেনু থেকে Add to Home Screen করুন
        </Alert>
      )}

      {state === 'denied' && (
        <Alert tone="warning">ব্রাউজারের সেটিংস থেকে নোটিফিকেশন অনুমতি দিন</Alert>
      )}

      {state === 'default' && (
        <Button size="sm" loading={enable.isPending} onClick={() => enable.mutate()}>
          {t('nav.notifications')}
        </Button>
      )}
    </Card>
  );
}

function TelegramCard() {
  const link = useMutation({
    mutationFn: () =>
      api.post<{ deepLink: string | null; linkToken: string }>('/reseller/telegram/link'),
  });

  return (
    <Card className="mb-4">
      <CardHeader title="Telegram" subtitle="বিনামূল্যে এবং নির্ভরযোগ্য" />

      {link.error && <Alert tone="warning">{errorMessage(link.error)}</Alert>}

      {link.data?.deepLink ? (
        <a href={link.data.deepLink} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline">
            Telegram
          </Button>
        </a>
      ) : (
        <Button size="sm" variant="outline" loading={link.isPending} onClick={() => link.mutate()}>
          {t('app.confirm')}
        </Button>
      )}
    </Card>
  );
}
