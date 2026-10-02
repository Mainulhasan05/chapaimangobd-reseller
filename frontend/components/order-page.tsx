'use client';

import { useState } from 'react';
import type { Route } from 'next';
import { SearchX } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { useAppDispatch } from '@/lib/store/hooks';
import { primeOrder, useGetOrderQuery } from '@/lib/store/endpoints/orders';
import type { Order, OrderCost } from '@/lib/types';
import { Card, EmptyState, ErrorState, PageHeader } from '@/components/ui/layout';
import { ButtonLink } from '@/components/ui/button';
import { BackLink } from '@/components/ui/back-link';
import { ListSkeleton } from '@/components/ui/skeleton';
import { OrderDetailBody } from '@/components/order-detail';
import { canEditDeliveryCharge } from '@/components/delivery-charge-field';
import { CustomerEditSheet } from '@/components/customer-edit-sheet';
import { useReadOnlyAccount } from '@/lib/session';

/**
 * One order on its own page, for either role.
 *
 * The page a notification opens and a list row links to. It owns the fetch and
 * the loading, error and not-found states; the caller supplies the actions,
 * because what the owner and a reseller may do to an order has nothing in common.
 *
 * The two edits both roles share live here instead: correcting the customer's
 * details, for either role, and the delivery charge, for the owner. Whether
 * each is offered comes from the order's `actions`, never from a status list
 * copied out of the API.
 *
 * The back arrow goes back when the page was reached from inside the app, so
 * the list it came from returns exactly as it was; `backHref` is where it goes
 * when there is nothing to go back to.
 */
export function OrderPage({
  scope,
  id,
  backHref,
  actions,
  onEditDeliveryCharge,
  onEditCourier,
  top,
  below,
}: {
  scope: 'owner' | 'reseller';
  id: string;
  backHref: Route;
  actions: (order: Order) => React.ReactNode;
  /** Owner only. Offered while the order has not shipped. */
  onEditDeliveryCharge?: (order: Order) => void;
  /** Owner only. Offered while the parcel is with the courier. */
  onEditCourier?: (order: Order) => void;
  /** Above the order: what needs attention before reading on, and the way to the next one. */
  top?: (order: Order) => React.ReactNode;
  /**
   * Anything that belongs under the order but is not part of it. The owner puts
   * the complaints and the costs here: they are about the order without being
   * on it, and the reseller never sees them.
   */
  below?: (order: Order, cost: OrderCost | undefined) => React.ReactNode;
}) {
  const dispatch = useAppDispatch();
  const readOnly = useReadOnlyAccount();
  const [editingCustomer, setEditingCustomer] = useState<Order | null>(null);

  const query = useGetOrderQuery({ role: scope, id });

  const back = <BackLink fallback={backHref} />;

  if (query.isLoading) {
    return (
      <>
        {back}
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (query.isError && !query.data) {
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
              <ButtonLink href={backHref} variant="outline">
                {t('nav.orders')}
              </ButtonLink>
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

  if (!query.data) return back;

  const { order, cost } = query.data;
  const actionNodes = actions(order);
  const canEditCustomer = !readOnly && order.actions.includes('editCustomer');
  const canEditCourier = scope === 'owner' && order.actions.includes('editCourier');

  return (
    <>
      {back}
      <PageHeader title={order.orderCode} subtitle={order.customer.name} />

      {top && <div className="mx-auto max-w-3xl">{top(order)}</div>}

      {actionNodes && (
        <div className="mx-auto mb-4 flex max-w-3xl flex-wrap gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
          {actionNodes}
        </div>
      )}

      <Card className="mx-auto max-w-3xl">
        <OrderDetailBody
          order={order}
          scope={scope}
          cost={cost}
          onEditDeliveryCharge={
            onEditDeliveryCharge && canEditDeliveryCharge(order)
              ? () => onEditDeliveryCharge(order)
              : undefined
          }
          onEditCustomer={canEditCustomer ? () => setEditingCustomer(order) : undefined}
          onEditCourier={
            onEditCourier && canEditCourier ? () => onEditCourier(order) : undefined
          }
        />
      </Card>

      {below && <div className="mx-auto mt-5 max-w-3xl">{below(order, cost)}</div>}

      <CustomerEditSheet
        scope={scope}
        order={editingCustomer}
        onClose={() => setEditingCustomer(null)}
        // The edit endpoint writes through on its own; this covers the sheet's
        // own request until it moves onto that endpoint.
        onSaved={(saved) => primeOrder(dispatch, scope, saved)}
      />
    </>
  );
}
