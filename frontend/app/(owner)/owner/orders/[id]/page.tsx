'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { ArrowRight, MessageSquareWarning } from 'lucide-react';
import { t, tf } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { useGetOrderComplaintsQuery } from '@/lib/store/endpoints/complaints';
import { useGetOwnerOrdersInfiniteQuery } from '@/lib/store/endpoints/orders';
import type { Order } from '@/lib/types';
import { Alert, Card, CardHeader, ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { OrderPage } from '@/components/order-page';
import { ComplaintList } from '@/components/complaints-panel';
import { OrderCostPanel, PackagingPanel } from '@/components/order-cost-panel';
import { primaryActionOf, useOrderActions } from '@/components/order-actions';
import { readOrdersQueue } from '@/components/orders-panel';

/** One order, as the owner sees it. Addressed by the order id. */
export default function OwnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 16; `use` unwraps it in a client component.
  const { id } = use(params);

  /*
   * The list this order was opened from, as that list's own query string. It
   * rebuilds the list for the back arrow when there is no history to go back
   * to, and it is what "পরের অর্ডার" walks: the same filters, the same order,
   * the same cache entry the list already filled.
   */
  const searchParams = useSearchParams();
  const list = searchParams.get('list');
  const queue = list !== null ? readOrdersQueue(new URLSearchParams(list)) : null;
  const backHref = (list ? `/owner/orders?${list}` : '/owner/orders') as Route;

  const actions = useOrderActions();

  /*
   * What was said about this order. Its own query rather than a field on the
   * order, because a complaint is not part of the order: it does not change its
   * status, it does not move money, and the reseller never sees it.
   */
  const complaints = useGetOrderComplaintsQuery({ orderId: id });
  const openComplaints = complaints.data?.complaints.filter((c) => !c.resolved).length ?? 0;

  const queueRows = useGetOwnerOrdersInfiniteQuery(queue ? queue.args : skipToken);
  const rows = queueRows.data?.pages.flatMap((page) => page.orders) ?? [];
  const index = rows.findIndex((row) => row.id === id);
  const found = index >= 0 ? (rows[index + 1] ?? null) : undefined;

  // Once acted on, this order leaves its queue; the next one is still the one
  // that was after it, so it is remembered from before the row went.
  const [remembered, setRemembered] = useState<{ for: string; next: Order | null } | null>(null);
  if (found !== undefined && (remembered?.for !== id || remembered.next?.id !== found?.id)) {
    setRemembered({ for: id, next: found });
  }
  const next = found !== undefined ? found : remembered?.for === id ? remembered.next : null;

  const actionsFor = (order: Order) => {
    const primary = primaryActionOf(order);
    const canReturn = order.actions.includes('return');
    const canCancel = order.actions.includes('cancel');
    if (!primary && !canReturn && !canCancel) return null;

    return (
      <>
        {primary && (
          <Button
            variant={primary.action === 'deliver' ? 'success' : 'primary'}
            loading={actions.packingId === order.id}
            onClick={() => actions.run(primary.action, order)}
          >
            {primary.label}
          </Button>
        )}
        {canReturn && (
          <Button variant="outline" onClick={() => actions.open('return', order)}>
            {t('order.return')}
          </Button>
        )}
        {canCancel && (
          <Button variant="outline" onClick={() => actions.open('cancel', order)}>
            {t('order.cancelOrder')}
          </Button>
        )}
      </>
    );
  };

  return (
    <>
      <OrderPage
        scope="owner"
        id={id}
        backHref={backHref}
        actions={actionsFor}
        onEditDeliveryCharge={(order) => actions.open('charge', order)}
        onEditCourier={(order) => actions.open('courier', order)}
        top={() => (
          <>
            {/*
             * An open complaint is the first thing to know before touching the
             * order, so it is said here and not only in the card at the bottom.
             */}
            {openComplaints > 0 && (
              <Alert tone="danger" icon={MessageSquareWarning}>
                <a href="#complaints" className="tap inline-flex items-center font-semibold hover:underline">
                  {tf('orders.openComplaintsHere', { count: formatNumber(openComplaints) })}
                </a>
              </Alert>
            )}
            {next && list !== null && (
              <div className="mb-3 flex justify-end">
                <Link
                  replace
                  href={`/owner/orders/${next.id}?list=${encodeURIComponent(list)}` as Route}
                  className="tap inline-flex items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary-ink hover:bg-primary-softer"
                >
                  {t('orders.nextOrder')}
                  <span className="tabular font-normal text-muted-foreground">{next.orderCode}</span>
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </div>
            )}
          </>
        )}
        /*
         * Complaints first under the order, on the owner's copy only. This is
         * the screen somebody lands on when a customer rings about a bad parcel,
         * so it is where it has to be possible to write that down — and where
         * the orchard behind each line is already named. Then the owner's side
         * of the books: what this parcel cost and what packing it takes. A
         * reseller is party to `order.totals` and to nothing here (docs/adr/0027).
         */
        below={(order) => (
          <div className="space-y-5">
            <Card id="complaints" className="scroll-mt-20">
              <CardHeader
                title={t('complaint.title')}
                subtitle={t('complaint.addHint')}
                action={
                  <Button variant="outline" size="sm" onClick={() => actions.open('complaint', order)}>
                    <MessageSquareWarning className="h-4 w-4" />
                    {t('complaint.add')}
                  </Button>
                }
              />
              {complaints.isLoading && <ListSkeleton rows={2} />}
              {complaints.isError && !complaints.data && (
                <ErrorState
                  onRetry={() => complaints.refetch()}
                  isRetrying={complaints.isFetching}
                  error={complaints.error}
                />
              )}
              {complaints.data && (
                <ComplaintList complaints={complaints.data.complaints} compactEmpty />
              )}
            </Card>
            <OrderCostPanel id={id} />
            <PackagingPanel id={id} />
          </div>
        )}
      />

      {actions.sheets}
    </>
  );
}
