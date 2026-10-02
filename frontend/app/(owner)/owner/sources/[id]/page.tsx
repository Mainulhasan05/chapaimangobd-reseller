'use client';

/**
 * One orchard, and whether to keep buying from it.
 *
 * The screen a complaint leads to. Somebody rings about a bad parcel, the order
 * names the orchard that line came from, and this is where that name goes: what
 * else came out of the same place, and what was said about all of it.
 *
 * The record and the complaints themselves are on the same page on purpose. A
 * rate with nothing under it is a number nobody can check, and "avoid this
 * orchard" is too expensive a decision to take on a percentage alone.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Archive,
  ArchiveRestore,
  ClipboardList,
  MapPin,
  MessageSquareWarning,
  Pencil,
  TriangleAlert,
} from 'lucide-react';
import { t, tf, tStatus, tUnit } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { OrderItem } from '@/lib/types';
import { useGetSourceQuery, type SourceOrder } from '@/lib/store/endpoints/catalog';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  PhoneLink,
  Stat,
  statusTone,
} from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { BackLink } from '@/components/ui/back-link';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { ComplaintList } from '@/components/complaints-panel';
import { ArchiveSourceSheet, SourceSheet, useSourceArchive } from '../source-sheet';

/**
 * Where a record stops being bad luck and starts being a pattern.
 *
 * A judgement, not a measurement, and said out loud rather than buried in a
 * colour: one complaint in ten orders is worth watching, and a quarter of orders
 * complained about is somewhere to stop buying from. The floor of five orders
 * matters more than the percentages — two complaints out of two is a 100% rate
 * and tells you almost nothing.
 */
const MIN_ORDERS_TO_JUDGE = 5;
const AVOID_RATE = 25;
const WATCH_RATE = 10;

function verdict(rate: number | null, orders: number): 'avoid' | 'watch' | 'clean' | null {
  if (rate === null || orders < MIN_ORDERS_TO_JUDGE) return null;
  if (rate >= AVOID_RATE) return 'avoid';
  if (rate >= WATCH_RATE) return 'watch';
  return 'clean';
}

/**
 * The lines of an order that came from this source, picked by id.
 *
 * It used to match on the snapshot name, which is what the orchard was called at
 * accept, so renaming an orchard emptied every order on its page. The server now
 * sends the lines picked by id; an older answer is filtered here the same way.
 */
const linesFrom = (order: SourceOrder, sourceId: string): OrderItem[] =>
  order.sourceItems ?? order.items.filter((item) => item.source === sourceId);

/** "হিমসাগর · ১১ কেজি × ২", or the weight for an order from before boxes. */
const lineText = (item: OrderItem) =>
  item.variantLabel && item.boxes
    ? `${item.productName} · ${item.variantLabel} × ${formatNumber(item.boxes)}`
    : `${item.productName} ${formatNumber(item.quantity)} ${tUnit(item.unit)}`;

export default function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useGetSourceQuery({ id });
  const { archive, restore, restoringId } = useSourceArchive();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const back = <BackLink fallback="/owner/sources" />;

  if (query.isLoading) {
    return (
      <>
        {back}
        <StatSkeleton count={4} />
        <ListSkeleton rows={3} />
      </>
    );
  }

  if (!query.data) {
    return (
      <>
        {back}
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
      </>
    );
  }

  const { source, record, complaints, orders } = query.data;
  const call = verdict(record.complaintRate, record.orders);
  const rate = formatNumber(record.complaintRate ?? 0);
  const ordersHref = `/owner/orders?source=${source._id}` as Route;

  return (
    <>
      {back}

      <PageHeader
        title={source.name}
        subtitle={source.address || undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {source.phoneE164 && (
              <PhoneLink
                phone={source.phoneE164}
                className="rounded-lg border border-input bg-surface px-3 text-sm sm:min-h-9"
              />
            )}
            {/*
             * Everything ever collected from here, not just the twenty below.
             * The orders list takes a source filter for exactly this link.
             */}
            <ButtonLink href={ordersHref} variant="outline" size="sm">
              <ClipboardList className="h-4 w-4" />
              {t('source.viewOrders')}
            </ButtonLink>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              {t('app.edit')}
            </Button>
            {source.isArchived ? (
              <Button
                variant="outline"
                size="sm"
                loading={restoringId === source._id}
                onClick={() => void restore(source)}
              >
                <ArchiveRestore className="h-4 w-4" />
                {t('app.restore')}
              </Button>
            ) : (
              <Button variant="quiet" size="sm" className="text-danger" onClick={() => setArchiving(true)}>
                <Archive className="h-4 w-4" />
                {t('app.archive')}
              </Button>
            )}
          </div>
        }
      />

      {source.isArchived && <Alert tone="warning">{t('sources.archivedNote')}</Alert>}

      {/*
       * The verdict in words, above the numbers that produced it. A percentage
       * on its own gets read as good or bad depending on the reader's mood, and
       * this is a decision about somebody's livelihood either way.
       */}
      {call === 'avoid' && (
        <Alert tone="danger" icon={TriangleAlert} title={t('source.avoid')}>
          {tf('sources.avoidLine', { rate })}
        </Alert>
      )}
      {call === 'watch' && (
        <Alert tone="warning" icon={TriangleAlert} title={t('sources.watch')}>
          {tf('sources.watchHint', { rate })}
        </Alert>
      )}
      {call === 'clean' && (
        <Alert tone="success" title={t('source.clean')}>
          {tf('sources.cleanLine', { rate })}
        </Alert>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={ClipboardList}
          tone="primary"
          label={t('source.suppliedOrders')}
          value={formatNumber(record.orders)}
          hint={record.cost > 0 ? tf('sources.collectedCost', { amount: formatMoney(record.cost) }) : undefined}
        />
        <Stat
          icon={MessageSquareWarning}
          label={t('complaint.plural')}
          value={formatNumber(record.complaints)}
          hint={
            record.openComplaints > 0
              ? tf('complaint.openCount', { n: formatNumber(record.openComplaints) })
              : undefined
          }
          tone={record.complaints > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          icon={TriangleAlert}
          label={t('source.complaintRate')}
          // Null, not zero, when nothing has been bought from here: an orchard
          // with no record is not the same as one with a clean record.
          value={record.complaintRate === null ? '—' : `${formatNumber(record.complaintRate)}%`}
          hint={call === null ? t('source.noRecord') : undefined}
          tone={call === 'avoid' ? 'danger' : call === 'watch' ? 'warning' : 'neutral'}
        />
        <Stat
          icon={MapPin}
          label={t('source.returnRate')}
          value={record.returnRate === null ? '—' : `${formatNumber(record.returnRate)}%`}
          hint={`${formatNumber(record.returned)} ${t('order.returned')}`}
          tone={(record.returnRate ?? 0) > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('complaint.plural')} subtitle={t('source.record')} />
          {complaints.length === 0 ? (
            <EmptyState compact title={t('complaint.noneAll')} />
          ) : (
            // The source is this page, so naming it on every row would be noise.
            <ComplaintList complaints={complaints} showOrder showSource={false} />
          )}
        </Card>

        <Card>
          <CardHeader title={t('source.recentOrders')} href={ordersHref} hrefLabel={t('source.viewOrders')} />
          {orders.length === 0 ? (
            <EmptyState compact title={t('order.noOrders')} />
          ) : (
            <ul className="-my-1 divide-y divide-border">
              {orders.map((order) => {
                // Only the lines from this orchard: the rest of the order came
                // from somewhere else and is not evidence about this one.
                const lines = linesFrom(order, source._id);
                return (
                  <li key={order.id}>
                    <Link
                      href={`/owner/orders/${order.id}` as Route}
                      className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="tabular truncate font-semibold">{order.orderCode}</p>
                        <ul className="text-xs text-muted-foreground">
                          {lines.map((item) => (
                            <li key={item.id} className="tabular">
                              {lineText(item)}
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs text-muted-foreground">{formatDate(order.businessDate)}</p>
                      </div>
                      <Badge tone={statusTone(order.status)} dot>
                        {tStatus(order.status)}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {editing && <SourceSheet source={source} onClose={() => setEditing(false)} />}
      {archiving && (
        <ArchiveSourceSheet source={source} onClose={() => setArchiving(false)} onConfirm={archive} />
      )}
    </>
  );
}
