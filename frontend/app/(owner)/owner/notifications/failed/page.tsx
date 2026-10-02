'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight, MailCheck, RotateCcw, X } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import {
  useDismissFailedDeliveryMutation,
  useGetFailedDeliveriesInfiniteQuery,
  useRetryFailedDeliveryMutation,
  type FailedDelivery,
} from '@/lib/store/endpoints/notifications';
import { t, tf, tMaybe, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PhoneLink,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { BackLink } from '@/components/ui/back-link';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';
import { useToast } from '@/components/ui/toast';

/**
 * Failed deliveries: the messages that gave up after every attempt.
 *
 * The dashboard counted these for a long time ("notification failed: 3") with
 * nowhere to see which three, so the count was a worry with no action attached.
 * This is the action: who it was for, what it said, which channel failed, and a
 * retry or a dismiss. Both take the row off the list at once and then refetch
 * the pages, so page-number paging never skips the rows that moved up. A
 * dismiss cannot be undone, so it asks first.
 */
export default function FailedDeliveriesPage() {
  const toast = useToast();
  const list = useGetFailedDeliveriesInfiniteQuery({});
  const [retry, retryState] = useRetryFailedDeliveryMutation();
  const [dismiss, dismissState] = useDismissFailedDeliveryMutation();
  const [dismissing, setDismissing] = useState<FailedDelivery | null>(null);

  const rows = list.data?.pages.flatMap((page) => page.messages) ?? [];
  const total = list.data?.pages[list.data.pages.length - 1]?.total ?? 0;

  const resend = async (row: FailedDelivery) => {
    try {
      await retry({ id: row.id }).unwrap();
      toast(t('failed.retried'));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  const pendingId =
    (retryState.isLoading && retryState.originalArgs?.id) ||
    (dismissState.isLoading && dismissState.originalArgs?.id) ||
    null;

  return (
    <>
      <BackLink fallback="/owner/notifications/settings" label={t('prefs.link')} />
      <PageHeader title={t('failed.title')} subtitle={t('failed.subtitle')} />

      {list.isLoading && <ListSkeleton rows={4} />}

      {list.isError && rows.length === 0 && (
        <ErrorState onRetry={() => list.refetch()} isRetrying={list.isFetching} error={list.error} />
      )}

      {/* "All delivered" only when the server says so, not when the loaded rows ran out. */}
      {list.isSuccess && rows.length === 0 && total === 0 && (
        <EmptyState icon={MailCheck} title={t('failed.empty')} description={t('failed.emptyHelp')} />
      )}

      {rows.length > 0 && (
        <ul className={cn('grid gap-3 transition-opacity', list.isFetching && 'opacity-80')}>
          {rows.map((row) => (
            <li key={row.id}>
              <FailedCard
                row={row}
                busy={pendingId === row.id}
                onRetry={() => resend(row)}
                onDismiss={() => setDismissing(row)}
              />
            </li>
          ))}
        </ul>
      )}

      {(rows.length > 0 || total > 0) && (
        <LoadMore
          hasMore={Boolean(list.hasNextPage)}
          loading={list.isFetchingNextPage}
          onLoadMore={() => list.fetchNextPage()}
          error={list.isFetchNextPageError ? list.error : null}
          shown={rows.length}
          total={total}
        />
      )}

      {dismissing && (
        <ConfirmSheet
          title={t('failed.dismissTitle')}
          tone="danger"
          confirmLabel={t('failed.dismiss')}
          summary={<p className="font-semibold">{recipientName(dismissing)}</p>}
          consequences={[t('failed.dismissConsequence')]}
          onClose={() => setDismissing(null)}
          onConfirm={async () => {
            await dismiss({ id: dismissing.id }).unwrap();
            toast(t('failed.dismissed'));
          }}
        />
      )}
    </>
  );
}

const CHANNEL_STATUS: Record<string, { key: DictKey; tone: 'danger' | 'success' | 'neutral' }> = {
  failed: { key: 'failed.channelFailed', tone: 'danger' },
  sent: { key: 'failed.channelSent', tone: 'success' },
  pending: { key: 'failed.channelPending', tone: 'neutral' },
};

/** The outbox names channels `in_app`, `web_push`, `telegram`, `sms`; the screens say ফোনে for push. */
function channelLabel(name: string): string {
  return tMaybe(`prefs.channel.${name === 'web_push' ? 'push' : name}`, name);
}

function recipientName(row: FailedDelivery): string {
  if (row.kind === 'customer_sms') return t('failed.customer');
  if (!row.recipient) return t('failed.unknownRecipient');
  const role = row.recipient.type === 'owner' ? t('role.owner') : t('role.reseller');
  return row.recipient.name ? `${row.recipient.name} · ${role}` : role;
}

/** Where the original message pointed, for the "what was it about" link. */
function recordHref(row: FailedDelivery): Route | null {
  if (row.url && row.url.startsWith('/owner') && !/[\s\\]/.test(row.url)) return row.url as Route;
  if (row.orderId) return `/owner/orders/${row.orderId}` as Route;
  return null;
}

function FailedCard({
  row,
  busy,
  onRetry,
  onDismiss,
}: {
  row: FailedDelivery;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const what =
    row.kind === 'customer_sms'
      ? t('failed.customerSms')
      : row.eventType
        ? (t(`event.${row.eventType}` as DictKey) ?? row.title ?? '')
        : (row.title ?? '');
  const href = recordHref(row);
  // The technical reasons, for whoever fixes the gateway. Kept behind a fold.
  const errors = row.channels.filter((c) => c.lastError).map((c) => c.lastError as string);
  if (errors.length === 0 && row.lastError) errors.push(row.lastError);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{what}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{recipientName(row)}</p>
          {row.recipient?.phone && (
            <PhoneLink phone={row.recipient.phone} className="text-sm" />
          )}
        </div>
        <span className="shrink-0 text-right text-xs text-muted-foreground">
          {t('failed.failedAt')}
          <span className="tabular block">{formatDateTime(row.deadAt ?? row.createdAt)}</span>
        </span>
      </div>

      {(row.title || row.body) && (
        <div className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm">
          {row.title && row.kind !== 'customer_sms' && <p className="font-medium">{row.title}</p>}
          {row.body && (
            <p className="whitespace-pre-line text-muted-foreground" lang={row.kind === 'customer_sms' ? 'en' : undefined}>
              {row.body}
            </p>
          )}
        </div>
      )}

      <ul className="mt-3 flex flex-wrap gap-2">
        {row.channels.map((channel) => {
          const status = CHANNEL_STATUS[channel.status] ?? CHANNEL_STATUS.pending;
          return (
            <li key={channel.name}>
              <Badge tone={status.tone}>
                {channelLabel(channel.name)}: {t(status.key)}
                {channel.attempts > 0 && (
                  <span className="opacity-75">
                    {' · '}
                    {tf('failed.attempts', { count: formatNumber(channel.attempts) })}
                  </span>
                )}
              </Badge>
            </li>
          );
        })}
      </ul>

      {errors.length > 0 && (
        <details className="mt-2">
          <summary className="tap cursor-pointer text-xs font-semibold text-muted-foreground">
            {t('failed.technical')}
          </summary>
          <ul lang="en" className="mt-1 space-y-1 break-words font-mono text-xs text-muted-foreground">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy} onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          {t('failed.retry')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onDismiss}>
          <X className="h-4 w-4" />
          {t('failed.dismiss')}
        </Button>
        {href && (
          <Link
            href={href}
            className="tap ml-auto inline-flex items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary-ink hover:bg-muted"
          >
            {t('failed.openRecord')}
            <ChevronRight aria-hidden className="h-4 w-4" />
          </Link>
        )}
      </div>
    </Card>
  );
}
