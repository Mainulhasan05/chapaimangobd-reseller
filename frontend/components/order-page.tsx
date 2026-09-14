'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, SearchX } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Order } from '@/lib/types';
import { Card, EmptyState, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { OrderDetailBody } from '@/components/order-detail';
import { canEditDeliveryCharge } from '@/components/delivery-charge-field';

/**
 * Where an order's own cache entry lives.
 *
 * Under the prefix each role's mutations already invalidate (`['owner']` for the
 * owner, `['orders']` for the reseller), so accepting or cancelling from this
 * page refreshes it with no extra wiring in the modals.
 */
export const orderQueryKey = (scope: 'owner' | 'reseller', id: string) =>
  scope === 'owner' ? (['owner', 'order', id] as const) : (['orders', 'detail', id] as const);

/**
 * One order on its own page, for either role.
 *
 * The page a notification opens and a list row links to. It owns the fetch and
 * the loading, error and not-found states; the caller supplies the actions,
 * because what the owner and a reseller may do to an order has nothing in common.
 */
export function OrderPage({
  scope,
  id,
  backHref,
  actions,
  onEditDeliveryCharge,
}: {
  scope: 'owner' | 'reseller';
  id: string;
  backHref: Route;
  actions: (order: Order) => React.ReactNode;
  /** Owner only. Offered while the order has not shipped. */
  onEditDeliveryCharge?: (order: Order) => void;
}) {
  const query = useQuery({
    queryKey: orderQueryKey(scope, id),
    queryFn: () => api.get<{ order: Order }>(`/${scope}/orders/${encodeURIComponent(id)}`),
  });

  const back = (
    <Link
      href={backHref}
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
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (query.isError) {
    // A malformed id is answered 400 INVALID_ID, which to a person is the same thing.
    const missing =
      query.error instanceof ApiError &&
      (query.error.status === 404 || query.error.code === 'INVALID_ID');

    return (
      <>
        {back}
        {missing ? (
          <EmptyState
            icon={SearchX}
            title={t('order.notFound')}
            description={t('order.notFoundHelp')}
            action={
              <Link href={backHref}>
                <Button variant="outline">{t('nav.orders')}</Button>
              </Link>
            }
          />
        ) : (
          <ErrorState
            onRetry={() => query.refetch()}
            isRetrying={query.isFetching}
            error={query.error}
          />
        )}
      </>
    );
  }

  const order = query.data!.order;
  const actionNodes = actions(order);

  return (
    <>
      {back}
      <PageHeader title={order.orderCode} subtitle={order.customer.name} />

      {actionNodes && (
        <div className="mb-4 flex flex-wrap gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
          {actionNodes}
        </div>
      )}

      <Card className="mx-auto max-w-3xl">
        <OrderDetailBody
          order={order}
          showCost
          onEditDeliveryCharge={
            onEditDeliveryCharge && canEditDeliveryCharge(order)
              ? () => onEditDeliveryCharge(order)
              : undefined
          }
        />
      </Card>
    </>
  );
}
