'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  Ban,
  BellOff,
  BellRing,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  FileCheck,
  ListChecks,
  MessageSquareWarning,
  PackageCheck,
  Settings2,
  ShieldAlert,
  TriangleAlert,
  Truck,
  Undo2,
  Wallet,
} from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import {
  useGetNotificationsInfiniteQuery,
  useLazyGetPushKeyQuery,
  useMarkNotificationReadMutation,
  useMarkNotificationsReadMutation,
  useSubscribePushMutation,
  type NotificationRow,
} from '@/lib/store/endpoints/notifications';
import { useUrlState } from '@/lib/use-url-state';
import { t, type DictKey } from '@/lib/i18n/bn';
import { syncPushRole } from '@/lib/push';
import { cn } from '@/lib/utils';
import { businessDate, formatDate } from '@/lib/format';
import type { Role } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Segmented } from '@/components/ui/toolbar';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';
import { useToast } from '@/components/ui/toast';

/**
 * The notification inbox, for either role.
 *
 * It was the reseller's page and nothing else, which was half a system: the
 * owner was sent a notification on every confirmed order, it was written, it was
 * queued, it was pushed to their browser, and there was no screen on which to
 * read it. The list is identical for both, so this is one component and the only
 * difference between the two callers is which API path they read.
 */

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
  // The owner's queues: something now waits on a decision.
  'deposit.requested': ArrowDownToLine,
  'withdrawal.requested': ArrowUpFromLine,
  'kyc.submitted': FileCheck,
  'complaint.created': MessageSquareWarning,
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
  'complaint.created',
]);

/*
 * The owner's queues, opened already filtered to what is waiting. The server
 * names these pages itself (`data.url`); this is for rows written before it did.
 */
const OWNER_QUEUES: Record<string, Route> = {
  'deposit.requested': '/owner/finance?tab=deposits&status=pending' as Route,
  'withdrawal.requested': '/owner/finance?tab=withdrawals&status=pending' as Route,
  'kyc.submitted': '/owner/kyc?status=pending' as Route,
  'complaint.created': '/owner/complaints',
};

/**
 * Where a row leads, or null when there is nowhere worth going.
 *
 * An order notification opens that order. The rest go to the one screen that
 * answers them: a request to the queue it waits in, ledger drift to the reports
 * page, the morning digest to the dashboard, a reseller near their limit to the
 * wallet. Everything else has no single destination, and a link that lands
 * somewhere unrelated is worse than no link. Keep in step with `targetFor` in
 * `public/sw.js` and `backend/src/domain/notificationLinks.js`.
 */
function hrefFor(row: NotificationRow, base: '/reseller' | '/owner', ordersHref: Route): Route | null {
  // Only a path inside this role's own screens is followed; older rows fall through.
  const url = row.data?.url;
  if (url && (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) && !/[\s\\]/.test(url)) {
    return url as Route;
  }

  if (base === '/owner' && OWNER_QUEUES[row.eventType]) return OWNER_QUEUES[row.eventType];

  if (row.data?.orderId) return `${ordersHref}/${row.data.orderId}` as Route;

  if (base === '/owner') {
    if (row.eventType === 'alert.ledger_drift') return '/owner/reports';
    if (row.eventType === 'alert.daily_digest') return '/owner';
  }

  if (base === '/reseller' && row.eventType === 'balance.near_limit') return '/reseller/wallet';

  return null;
}

const TIME = new Intl.DateTimeFormat('bn-BD', {
  timeZone: 'Asia/Dhaka',
  hour: 'numeric',
  minute: '2-digit',
});

/** Rows under "আজ", "গতকাল" or the date, newest day first, in the order they came. */
function groupByDay(rows: NotificationRow[]) {
  const today = businessDate();
  const yesterday = businessDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const groups: { key: string; label: string; rows: NotificationRow[] }[] = [];
  rows.forEach((row) => {
    const day = businessDate(new Date(row.createdAt));
    let group = groups[groups.length - 1];
    if (!group || group.key !== day) {
      const label =
        day === today ? t('notif.today') : day === yesterday ? t('notif.yesterday') : formatDate(row.createdAt);
      group = { key: day, label, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  });
  return groups;
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
  const role = base.slice(1) as Role;
  const toast = useToast();
  const { data: session } = useSession();
  const [filters, setFilters] = useUrlState({ unread: false as boolean });

  /*
   * Newest first, thirty at a time. Not polled: a poll refetches every loaded
   * page. The shell's bell polls the count, and a rise refreshes this list.
   */
  const inbox = useGetNotificationsInfiniteQuery({ role });
  const [markAll, markAllState] = useMarkNotificationsReadMutation();
  const [markOne] = useMarkNotificationReadMutation();

  const rows = inbox.data?.pages.flatMap((page) => page.notifications) ?? [];
  // The newest page carries the freshest count.
  const unread = inbox.data?.pages[0]?.unread ?? 0;
  const shown = filters.unread ? rows.filter((row) => !row.readAt) : rows;

  /*
   * The API has no unread filter, so "শুধু নতুন" filters what is loaded. While
   * the count says unread rows exist beyond the loaded pages, keep loading, so
   * the filter never claims "nothing new" with new rows still on the server.
   */
  const missingUnread = filters.unread && shown.length < unread;
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = inbox;
  useEffect(() => {
    if (missingUnread && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [missingUnread, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const readAll = async () => {
    try {
      await markAll({ role }).unwrap();
      toast(t('notif.allRead'));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  /*
   * Tapping a row reads that row, and only that row. It used to read nothing, so
   * the list could never say which ones had been looked at short of "mark all".
   * Shown read at once; the request runs behind the navigation.
   */
  const open = (row: NotificationRow) => {
    if (row.readAt) return;
    markOne({ role, id: row._id })
      .unwrap()
      .catch(() => toast(t('notif.markFailed'), 'danger'));
  };

  return (
    <>
      <PageHeader
        title={t('nav.notifications')}
        action={
          unread > 0 ? (
            <Button size="sm" variant="outline" loading={markAllState.isLoading} onClick={readAll}>
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
        className="card mb-4 flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
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

      <Segmented
        label={t('nav.notifications')}
        className="mb-3"
        value={filters.unread ? 'unread' : 'all'}
        onChange={(value) => setFilters({ unread: value === 'unread' })}
        options={[
          { value: 'all', label: t('notif.allShown') },
          { value: 'unread', label: t('notif.onlyUnread'), count: unread },
        ]}
      />

      {inbox.isLoading && <ListSkeleton rows={5} />}

      {inbox.isError && rows.length === 0 && (
        <ErrorState onRetry={() => inbox.refetch()} isRetrying={inbox.isFetching} error={inbox.error} />
      )}

      {inbox.isSuccess && rows.length === 0 && (
        <EmptyState icon={BellOff} title={t('notif.empty')} description={t('notif.emptyHelp')} />
      )}

      {rows.length > 0 && shown.length === 0 && !(missingUnread && hasNextPage) && (
        <FilteredEmpty
          title={t('notif.noneUnread')}
          description=""
          onClear={() => setFilters({ unread: false })}
        />
      )}

      {shown.length > 0 && (
        <Card className="px-4 py-2 sm:px-6 sm:py-3">
          {groupByDay(shown).map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h2 className="pb-1 pt-3 text-xs font-semibold text-muted-foreground">{group.label}</h2>
              <ul className="divide-y divide-border">
                {group.rows.map((row) => (
                  <Row
                    key={row._id}
                    row={row}
                    href={hrefFor(row, base, ordersHref)}
                    onOpen={() => open(row)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}

      {rows.length > 0 && (
        <LoadMore
          hasMore={Boolean(inbox.hasNextPage)}
          loading={inbox.isFetchingNextPage}
          onLoadMore={() => inbox.fetchNextPage()}
          error={inbox.isFetchNextPageError ? inbox.error : null}
        />
      )}
    </>
  );
}

function Row({
  row,
  href,
  onOpen,
}: {
  row: NotificationRow;
  href: Route | null;
  onOpen: () => void;
}) {
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
        <span className="tabular block text-xs text-muted-foreground">
          {TIME.format(new Date(row.createdAt))}
        </span>
      </span>

      {!row.readAt && (
        <Badge tone="primary" dot className="shrink-0">
          {t('app.unread')}
        </Badge>
      )}
      {href && <ChevronRight aria-hidden className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />}
    </>
  );

  const className = cn(
    '-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-3 text-left transition-colors',
    !row.readAt && 'bg-primary-softer'
  );

  // See `hrefFor` for where each kind of row leads.
  return (
    <li>
      {href ? (
        <Link href={href} onClick={onOpen} className={cn(className, 'hover:bg-muted')}>
          {inner}
        </Link>
      ) : !row.readAt ? (
        // Nowhere to go, but tapping still reads it.
        <button type="button" onClick={onOpen} className={cn(className, 'hover:bg-muted')}>
          {inner}
        </button>
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
 *
 * "On" means this browser holds a subscription, not merely that permission was
 * granted: a granted permission whose subscription failed, or was cleared with
 * the site data, used to read "চালু আছে" while nothing could arrive. Once it is
 * really on, the card shrinks to one line, because a settled setting does not
 * need a card's worth of the inbox. Hidden entirely while the owner has push
 * switched off.
 */
export function PushCard({ base }: { base: '/reseller' | '/owner' }) {
  const role = base.slice(1) as Role;
  const { data: session } = useSession();
  // An external system read, so it goes through useSyncExternalStore rather than
  // an effect that pushes the value into state and costs a second render.
  const detected = useSyncExternalStore<PushState>(
    subscribeToNothing,
    readPushState,
    () => 'default'
  );
  const [granted, setGranted] = useState<PushState | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [getKey] = useLazyGetPushKeyQuery();
  const [subscribe] = useSubscribePushMutation();
  const toast = useToast();

  const state = granted ?? detected;

  // Whether this browser actually holds a subscription. Asked only once
  // permission exists, because asking earlier can only answer no.
  useEffect(() => {
    if (state !== 'granted') return undefined;
    let live = true;
    navigator.serviceWorker
      .getRegistration('/')
      .then((registration) => registration?.pushManager.getSubscription() ?? null)
      .then((subscription) => {
        if (live) setSubscribed(Boolean(subscription));
      })
      .catch(() => {
        if (live) setSubscribed(false);
      });
    return () => {
      live = false;
    };
  }, [state]);

  if (session && session.features.webPush === false) return null;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      // Requested from a click, never on load: Chrome permanently penalises a
      // site that asks without a user gesture.
      const permission = await Notification.requestPermission();
      setGranted(permission as PushState);
      if (permission !== 'granted') return;

      const { publicKey } = await getKey({ role }).unwrap();
      if (!publicKey) throw new Error(t('push.notConfigured'));

      await navigator.serviceWorker.register('/sw.js');
      // Subscribing through the active worker, and telling it the role first, so
      // a rotated subscription re-registers with this role's endpoint.
      const registration = await navigator.serviceWorker.ready;
      await syncPushRole(role);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      const json = subscription.toJSON() as { endpoint: string; keys: Record<string, string> };
      await subscribe({ role, endpoint: json.endpoint, keys: json.keys }).unwrap();
      setSubscribed(true);
      toast(t('push.enabled'));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const on = state === 'granted' && subscribed === true;

  if (on || (state === 'granted' && subscribed === null)) {
    return (
      <div className="card mb-4 flex min-h-12 items-center gap-2.5 px-4 py-3 text-sm">
        {subscribed === null ? (
          <Spinner className="text-muted-foreground" />
        ) : (
          <BellRing aria-hidden className="h-4 w-4 shrink-0 text-success-ink" />
        )}
        <span className="min-w-0 flex-1">{t('push.title')}</span>
        {on && <Badge tone="success">{t('push.stateGranted')}</Badge>}
      </div>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('push.title')}
        subtitle={t('push.subtitle')}
        action={
          <Badge tone={state === 'denied' ? 'warning' : 'neutral'}>
            {state === 'granted' ? t('push.stateDefault') : t(PUSH_STATE_LABEL[state])}
          </Badge>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {state === 'ios-install' && <Alert tone="warning">{t('push.iosInstall')}</Alert>}

      {state === 'denied' && <Alert tone="warning">{t('push.denied')}</Alert>}

      {state === 'granted' && subscribed === false && (
        <>
          <p className="mb-3 text-sm text-muted-foreground">{t('push.grantedNoSubscription')}</p>
          <Button size="sm" loading={busy} onClick={enable}>
            {t('push.retry')}
          </Button>
        </>
      )}

      {state === 'default' && (
        <Button size="sm" loading={busy} onClick={enable}>
          {t('push.enable')}
        </Button>
      )}
    </Card>
  );
}
