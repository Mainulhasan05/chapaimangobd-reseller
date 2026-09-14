'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  BellOff,
  BadgeCheck,
  ChevronRight,
  Settings2,
  Ban,
  CheckCheck,
  ClipboardList,
  ListChecks,
  PackageCheck,
  ShieldAlert,
  TriangleAlert,
  Truck,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t, type DictKey } from '@/lib/i18n/bn';
import { syncPushRole } from '@/lib/push';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import type { CursorPaged } from '@/lib/types';
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
import { LoadMore } from '@/components/ui/load-more';

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
  data?: { orderId?: string; orderCode?: string; url?: string };
  readAt: string | null;
  createdAt: string;
};

const PAGE_SIZE = 30;

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
  'alert.ledger_drift': TriangleAlert,
  'alert.daily_digest': ListChecks,
  'alert.new_device': ShieldAlert,
};

/** Events that are bad news, and should not be drawn in the same ink as the rest. */
const NEGATIVE = new Set([
  'order.cancelled',
  'order.returned',
  'kyc.rejected',
  'deposit.rejected',
  'withdrawal.rejected',
  'balance.near_limit',
  'alert.ledger_drift',
  'alert.new_device',
]);

/**
 * Where a row leads, or null when there is nowhere worth going.
 *
 * An order notification opens that order. The rest go to the one screen that
 * answers them: ledger drift to the reports page, where the receivables table
 * flags the drifting wallets and the reconcile button explains them; the
 * morning digest to the dashboard, which lists the aging orders; a reseller near
 * their limit to the wallet, where a deposit is one tap away. Everything else
 * has no single destination, and a link that lands somewhere unrelated is
 * worse than no link. Keep in step with `targetFor` in `public/sw.js`.
 */
function hrefFor(row: NotificationRow, base: '/reseller' | '/owner', ordersHref: Route): Route | null {
  // The server names the page since Phase F (backend/src/domain/notificationLinks.js).
  // Only a path inside this role's own screens is followed; older rows fall through.
  const url = row.data?.url;
  if (url && (url === base || url.startsWith(`${base}/`)) && !/[\s\\]/.test(url)) {
    return url as Route;
  }

  if (row.data?.orderId) return `${ordersHref}/${row.data.orderId}` as Route;

  if (base === '/owner') {
    if (row.eventType === 'alert.ledger_drift') return '/owner/reports';
    if (row.eventType === 'alert.daily_digest') return '/owner';
  }

  if (base === '/reseller' && row.eventType === 'balance.near_limit') return '/reseller/wallet';

  return null;
}

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

  // Newest first, thirty at a time. The key sits under ['notifications'], so the
  // header badge and this list are refreshed together by one invalidation.
  const notifications = useInfiniteQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: ({ pageParam }) =>
      api.get<CursorPaged<'notifications', NotificationRow> & { unread: number }>(
        `${base}/notifications?limit=${PAGE_SIZE}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
        }`
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: () => api.post(`${base}/notifications/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const rows = notifications.data?.pages.flatMap((page) => page.notifications) ?? [];
  // The newest page carries the freshest count.
  const unread = notifications.data?.pages[0]?.unread ?? 0;

  return (
    <>
      <PageHeader
        title={t('nav.notifications')}
        action={
          unread > 0 ? (
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

      {/* Telegram and the per-event choices live one tap away, not in the inbox. */}
      <Link
        href={base === '/owner' ? '/owner/notifications/settings' : '/reseller/notifications/settings'}
        className="card mb-4 flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <Settings2 aria-hidden className="h-4 w-4 text-muted-foreground" />
          {t('prefs.link')}
          {session?.features.telegram && (
            <span className="text-xs font-normal text-muted-foreground">· {t('telegram.title')}</span>
          )}
        </span>
        <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
      </Link>

      <Card>
        <CardHeader title={t('nav.notifications')} />

        {notifications.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {notifications.isError && rows.length === 0 && (
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
            <Row key={row._id} row={row} href={hrefFor(row, base, ordersHref)} />
          ))}
        </ul>

        {rows.length > 0 && (
          <LoadMore
            hasMore={Boolean(notifications.hasNextPage)}
            loading={notifications.isFetchingNextPage}
            onLoadMore={() => notifications.fetchNextPage()}
            error={notifications.isFetchNextPageError ? notifications.error : null}
          />
        )}
      </Card>
    </>
  );
}

function Row({ row, href }: { row: NotificationRow; href: Route | null }) {
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
        {/* The morning digest is several lines, one per problem, joined by newlines. */}
        {row.body && (
          <span className="block whitespace-pre-line text-sm text-muted-foreground">{row.body}</span>
        )}
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

  // See `hrefFor` for where each kind of row leads.
  return (
    <li>
      {href ? (
        <Link href={href} className={cn(className, 'hover:bg-muted')}>
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
export function PushCard({ base }: { base: '/reseller' | '/owner' }) {
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
