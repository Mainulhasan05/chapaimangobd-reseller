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

import { use } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ClipboardList,
  MapPin,
  MessageSquareWarning,
  Phone,
  TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { t, tStatus, tUnit } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { SourceDetail } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  statusTone,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { ComplaintList } from '@/components/complaints-panel';

/**
 * Where a record stops being bad luck and starts being a pattern.
 *
 * A judgement, not a measurement, and said out loud rather than buried in a
 * colour: one complaint in three orders is a warning, and a quarter of orders
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

export default function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const query = useQuery({
    queryKey: ['owner', 'source', id],
    queryFn: () => api.get<SourceDetail>(`/owner/sources/${id}`),
  });

  const back = (
    <Link
      href="/owner/sources"
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('app.back')}
    </Link>
  );

  if (query.isLoading) {
    return (
      <>
        {back}
        <StatSkeleton count={4} />
        <ListSkeleton rows={3} />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        {back}
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
      </>
    );
  }

  const { source, record, complaints, orders } = query.data!;
  const call = verdict(record.complaintRate, record.orders);

  return (
    <>
      {back}

      <PageHeader
        title={source.name}
        subtitle={source.address || undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {source.phoneE164 && (
              <a href={`tel:${source.phoneE164}`}>
                <Button variant="outline" size="sm">
                  <Phone className="h-4 w-4" />
                  {source.phoneE164}
                </Button>
              </a>
            )}
            {/*
             * Everything ever collected from here, not just the twenty below.
             * The orders list takes a source filter for exactly this link.
             */}
            <Link href={`/owner/orders?source=${source._id}` as Route}>
              <Button variant="outline" size="sm">
                <ClipboardList className="h-4 w-4" />
                {t('source.viewOrders')}
              </Button>
            </Link>
          </div>
        }
      />

      {source.isArchived && <Alert tone="warning">{t('source.archivedNote')}</Alert>}

      {/*
       * The verdict in words, above the numbers that produced it. A percentage
       * on its own gets read as good or bad depending on the reader's mood, and
       * this is a decision about somebody's livelihood either way.
       */}
      {call === 'avoid' && (
        <Alert tone="danger" title={t('source.avoid')}>
          {t('source.avoidHint')} · {formatNumber(record.complaintRate ?? 0)}%
        </Alert>
      )}
      {call === 'clean' && (
        <Alert tone="success">{t('source.clean')}</Alert>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ClipboardList}
          tone="primary"
          label={t('source.suppliedOrders')}
          value={formatNumber(record.orders)}
          hint={
            record.quantity > 0
              ? `${formatNumber(record.quantity)} · ${formatMoney(record.cost)}`
              : undefined
          }
        />
        <Stat
          icon={MessageSquareWarning}
          label={t('complaint.plural')}
          value={formatNumber(record.complaints)}
          hint={
            record.openComplaints > 0
              ? t('complaint.openCount').replace('{n}', formatNumber(record.openComplaints))
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
            <EmptyState icon={MessageSquareWarning} title={t('complaint.noneAll')} />
          ) : (
            // The source is this page, so naming it on every row would be noise.
            <ComplaintList complaints={complaints} showOrder showSource={false} />
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('source.recentOrders')}
            action={
              <Link href={`/owner/orders?source=${source._id}` as Route}>
                <Button variant="outline" size="sm">
                  {t('source.viewOrders')}
                </Button>
              </Link>
            }
          />
          {orders.length === 0 ? (
            <EmptyState icon={ClipboardList} title={t('order.noOrders')} />
          ) : (
            <ul className="-my-1 divide-y divide-border">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/owner/orders/${order.id}` as Route}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <p className="tabular truncate font-semibold">{order.orderCode}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {/* Only the lines from this orchard: the rest of the
                          * order came from somewhere else and is not evidence
                          * about this one. */}
                        {order.items
                          .filter((item) => item.sourceName === source.name)
                          .map(
                            (item) =>
                              `${item.productName} ${formatNumber(item.quantity)}${tUnit(item.unit)}`
                          )
                          .join(', ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(order.businessDate)}
                      </p>
                    </div>
                    <Badge tone={statusTone(order.status)} dot>
                      {tStatus(order.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
