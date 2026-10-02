'use client';

import { use, useEffect, useState } from 'react';
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
import { Card, CardHeader, ErrorState } from '@/components/ui/layout';
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
  // Opened from somewhere other than the orders list, the way back is to there.
  const from = searchParams.get('from');
  const backHref = (
    from === 'complaints' ? '/owner/complaints' : list ? `/owner/orders?${list}` : '/owner/orders'
  ) as Route;

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

  // The last loaded row of a longer list: bring the next page in so "next" has somewhere to go.
  const lastLoaded = index >= 0 && index === rows.length - 1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = queueRows;
  useEffect(() => {
    if (lastLoaded && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [lastLoaded, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const hasComplaints = (complaints.data?.complaints.length ?? 0) > 0;

  /*
   * What was said about this order, with the way to write one down. The
   * orchard behind each line is named on every complaint.
   */
  const complaintsCard = (order: Order) => (
    <Card id="complaints" className="scroll-mt-20">
      <CardHeader
        title={
          openComplaints > 0
            ? tf('orders.complaintsOpenTitle', { count: formatNumber(openComplaints) })
            : t('complaint.title')
        }
        subtitle={t('complaint.addHint')}
        action={
          <Button variant="outline" size="sm" onClick={() => actions.open('complaint', order)}>
            <MessageSquareWarning className="h-4 w-4" />
            {t('complaint.add')}
          </Button>
        }
      />
      {complaints.isLoading && <ListSkeleton rows={2} />}
      {complaints.isError && !complaints.currentData && (
        <ErrorState
          onRetry={() => complaints.refetch()}
          isRetrying={complaints.isFetching}
          error={complaints.error}
        />
      )}
      {complaints.data && <ComplaintList complaints={complaints.data.complaints} compactEmpty />}
    </Card>
  );

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
            {t('orders.markReturnedShort')}
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
        top={(order) => (
          <>
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
            {/*
             * Anything a customer has said about this order comes before the
             * order itself: it is the first thing to know before touching it.
             */}
            {hasComplaints && <div className="mb-5">{complaintsCard(order)}</div>}
          </>
        )}
        /*
         * The owner's side of the books: what this parcel cost and what packing
         * it takes. A reseller is party to `order.totals` and to nothing here
         * (docs/adr/0027). With no complaints yet, the card to write one sits
         * here too, since this is the screen a customer's call lands on.
         */
        below={(order) => (
          <div className="space-y-5">
            {!hasComplaints && complaintsCard(order)}
            <OrderCostPanel id={id} />
            <PackagingPanel id={id} />
          </div>
        )}
      />

      {actions.sheets}
    </>
  );
}
