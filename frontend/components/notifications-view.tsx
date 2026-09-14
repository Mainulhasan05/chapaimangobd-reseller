'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  BellOff,
  BadgeCheck,
  Ban,
  CheckCheck,
  ClipboardList,
  PackageCheck,
  Truck,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t, type DictKey } from '@/lib/i18n/bn';
import { syncPushRole } from '@/lib/push';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';

/**
 * The notification inbox, for either role.
 *
 * It was the reseller's page and nothing else, which was half a system: the
 * owner was sent a notification on every confirmed order, it was written, it was
 * queued, it was pushed to their browser, and there was no screen on which to
 * read it. The list is identical for both, so this is one component and the only
 * difference between the two callers is which API path they read.
 */

type NotificationRow = {
  _id: string;
  eventType: string;
  title: string;
  body?: string;
  data?: { orderId?: string; orderCode?: string };
  readAt: string | null;
  createdAt: string;
};

type PushState = 'unsupported' | 'ios-install' | 'default' | 'granted' | 'denied';

/** What the browser permission means, in words, rather than `default` or `granted`. */
const PUSH_STATE_LABEL: Record<PushState, DictKey> = {
  unsupported: 'push.stateUnsupported',
  'ios-install': 'push.stateIosInstall',
  default: 'push.stateDefault',
  granted: 'push.stateGranted',
  denied: 'push.stateDenied',
};

/**
 * The glyph for an event.
 *
 * A list of twenty rows in one typeface is read by nobody. The icon is what
 * makes "an order shipped" separable from "money arrived" at a glance, which is
 * the only way this list is ever actually scanned.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'order.pending': ClipboardList,
  'order.confirmed': ClipboardList,
  'order.accepted': PackageCheck,
  'order.shipped': Truck,
  'order.delivered': PackageCheck,
  'order.cancelled': Ban,
  'order.returned': Undo2,
  'kyc.approved': BadgeCheck,
  'kyc.rejected': Ban,
  'deposit.approved': Wallet,
  'deposit.rejected': Ban,
  'withdrawal.approved': Wallet,
  'withdrawal.rejected': Ban,
  'balance.near_limit': Wallet,
};

/** Events that are bad news, and should not be drawn in the same ink as the rest. */
const NEGATIVE = new Set([
  'order.cancelled',
  'order.returned',
  'kyc.rejected',
  'deposit.rejected',
  'withdrawal.rejected',
  'balance.near_limit',
]);

export function NotificationsView({
  base,
  ordersHref,
}: {
  /** The API prefix for this role: `/reseller` or `/owner`. */
  base: '/reseller' | '/owner';
  /** Where an order notification links to, so a row is a way in and not a dead end. */
  ordersHref: '/reseller/orders' | '/owner/orders';
}) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ notifications: NotificationRow[]; unread: number }>(`${base}/notifications`),
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: () => api.post(`${base}/notifications/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const rows = notifications.data?.notifications ?? [];

  return (
    <>
      <PageHeader
        title={t('nav.notifications')}
        action={
          (notifications.data?.unread ?? 0) > 0 ? (
            <Button
              size="sm"
              variant="outline"
              loading={markRead.isPending}
              onClick={() => markRead.mutate()}
            >
              <CheckCheck className="h-4 w-4" />
              {t('app.markAllRead')}
            </Button>
          ) : undefined
        }
      />

      <PushCard base={base} />
      {base === '/reseller' && session?.features.telegram && <TelegramCard />}

      <Card>
        <CardHeader title={t('nav.notifications')} />

        {notifications.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {notifications.isError && (
          <ErrorState
            onRetry={() => notifications.refetch()}
            isRetrying={notifications.isFetching}
            error={notifications.error}
          />
        )}

        {notifications.isSuccess && rows.length === 0 && (
          <EmptyState icon={BellOff} title={t('app.none')} />
        )}

        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <Row key={row._id} row={row} ordersHref={ordersHref} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function Row({ row, ordersHref }: { row: NotificationRow; ordersHref: Route }) {
  const Icon = ICONS[row.eventType] ?? ClipboardList;
  const negative = NEGATIVE.has(row.eventType);

  const inner = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          negative ? 'bg-danger-soft text-danger' : 'bg-primary-softer text-primary-ink'
        )}
      >
        <Icon className="h-[1.125rem] w-[1.125rem]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block', row.readAt ? 'text-muted-foreground' : 'font-semibold')}>
          {row.title}
        </span>
        {row.body && <span className="block text-sm text-muted-foreground">{row.body}</span>}
        <span className="block text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
      </span>

      {!row.readAt && (
        <Badge tone="primary" dot>
          {t('app.unread')}
        </Badge>
      )}
    </>
  );

  const className = cn(
    '-mx-2 flex items-start gap-3 rounded-lg px-2 py-3',
    !row.readAt && 'bg-primary-softer'
  );

  /*
   * An order notification is a prompt to do something about that order, so the
   * row goes there. The rest have no single destination worth guessing at, and
   * a link that lands somewhere unrelated is worse than no link.
   */
  return (
    <li>
      {row.data?.orderId ? (
        <Link href={`${ordersHref}/${row.data.orderId}` as Route} className={cn(className, 'hover:bg-muted')}>
          {inner}
        </Link>
      ) : (
        <div className={className}>{inner}</div>
      )}
    </li>
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
function PushCard({ base }: { base: '/reseller' | '/owner' }) {
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

      const { publicKey } = await api.get<{ publicKey: string | null }>(`${base}/push/key`);
      if (!publicKey) throw new Error(t('push.notConfigured'));

      await navigator.serviceWorker.register('/sw.js');
      // Subscribing through the active worker, and telling it the role first, so
      // a rotated subscription re-registers with this role's endpoint.
      const registration = await navigator.serviceWorker.ready;
      await syncPushRole(base === '/owner' ? 'owner' : 'reseller');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      const json = subscription.toJSON() as { endpoint: string; keys: Record<string, string> };
      await api.post(`${base}/push/subscribe`, { endpoint: json.endpoint, keys: json.keys });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('push.title')}
        subtitle={t('push.subtitle')}
        action={
          <Badge tone={state === 'granted' ? 'success' : state === 'denied' ? 'warning' : 'neutral'}>
            {t(PUSH_STATE_LABEL[state])}
          </Badge>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {state === 'ios-install' && (
        <Alert tone="warning">{t('push.iosInstall')}</Alert>
      )}

      {state === 'denied' && (
        <Alert tone="warning">{t('push.denied')}</Alert>
      )}

      {state === 'default' && (
        <Button size="sm" loading={enable.isPending} onClick={() => enable.mutate()}>
          {t('push.enable')}
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
      <CardHeader title={t('telegram.title')} subtitle={t('telegram.subtitle')} />

      {link.error && <Alert tone="warning">{errorMessage(link.error)}</Alert>}

      {link.data?.deepLink ? (
        <a href={link.data.deepLink} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline">
            {t('telegram.open')}
          </Button>
        </a>
      ) : (
        <Button size="sm" variant="outline" loading={link.isPending} onClick={() => link.mutate()}>
          {t('telegram.connect')}
        </Button>
      )}
    </Card>
  );
}
