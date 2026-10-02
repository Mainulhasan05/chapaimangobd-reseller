'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { UserX, Warehouse } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatDateTime } from '@/lib/format';
import { useGetCustomerQuery } from '@/lib/store/endpoints/people';
import { resellerIdOf } from '@/lib/store/endpoints/shared';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  statusTone,
} from '@/components/ui/layout';
import { BackLink } from '@/components/ui/back-link';
import { ListSkeleton, Skeleton } from '@/components/ui/skeleton';
import { CustomerProfile } from '@/components/customer-profile';
import type { Order } from '@/lib/types';

/**
 * One buyer's whole history with whoever is looking.
 *
 * The order list underneath is the point of the screen. It shows the name and
 * the address used on each order rather than the buyer's current ones, because
 * those are the things that change between orders and the reason someone opened
 * this: the same number ordering under a different name each time is not an
 * anomaly here, it is the normal case.
 */

/**
 * The distinct orchards one order was collected from.
 *
 * Taken from the line snapshots rather than by populating a source, for the
 * same reason a line carries its own price: renaming or retiring an orchard
 * must not rewrite what happened. One order can draw on several, so the list is
 * deduplicated and an order not yet accepted yields nothing at all.
 */
const sourcesOf = (order: Order): string[] =>
  Array.from(
    new Set((order.items || []).map((item) => item.sourceName).filter((name): name is string => Boolean(name)))
  );

export function CustomerDetail({
  base,
  identifier,
  backHref,
  orderHref,
}: {
  base: '/owner' | '/reseller';
  /** An id for the owner, a phone number for the reseller. */
  identifier: string;
  backHref: Route;
  orderHref: (order: Order) => Route;
}) {
  const role = base === '/owner' ? 'owner' : 'reseller';
  const query = useGetCustomerQuery({ role, id: identifier });

  // The way back is on screen in every state, not only once the data arrives.
  const back = <BackLink fallback={backHref} />;

  if (query.isLoading) {
    return (
      <>
        {back}
        <Skeleton className="mb-4 h-40 w-full rounded-2xl" />
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        {back}
        <PageHeader title={t('cust.title')} />
        {missing ? (
          <EmptyState icon={UserX} title={t('customers.notFound')} description={t('customers.notFoundHelp')} />
        ) : (
          <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
        )}
      </>
    );
  }

  const { customer, orders } = query.data;

  return (
    <>
      {back}

      <CustomerProfile customer={customer} />

      <Card>
        <CardHeader title={t('cust.orderHistory')} />

        {orders.length === 0 ? (
          <EmptyState compact title={t('app.none')} />
        ) : (
          <ul className="-my-1 divide-y divide-border">
            {orders.map((order, index) => {
              const shopId = base === '/owner' ? resellerIdOf(order) : undefined;
              return (
                /*
                 * The order link covers the row; the shop link sits above it, so
                 * the two stay separate controls rather than one link inside
                 * another.
                 */
                <li key={order.id} className="relative -mx-2 flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-muted">
                  {/*
                   * Counted from the end of the list, so the oldest order is
                   * number one. "Their fourth order" is how anybody actually
                   * talks about this, and it is not something a date conveys.
                   */}
                  <span className="tabular mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-bold text-muted-foreground">
                    {orders.length - index}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={orderHref(order)}
                        className="tabular text-sm font-semibold after:absolute after:inset-0 after:content-['']"
                      >
                        {order.orderCode}
                      </Link>
                      <Badge tone={statusTone(order.status)} dot>
                        {tStatus(order.status)}
                      </Badge>
                      {order.shopName &&
                        (shopId ? (
                          <Link
                            href={`/owner/resellers/${shopId}` as Route}
                            className="relative z-10 inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
                          >
                            {order.shopName}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">{order.shopName}</span>
                        ))}
                    </span>

                    {/*
                     * The name and address as they were on this order, read
                     * from the snapshot rather than from the buyer's record.
                     * That is the whole question this screen answers.
                     */}
                    <span className="mt-0.5 block truncate text-sm">{order.customer.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {order.customer.address}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(order.createdAt)}
                    </span>

                    {/*
                     * Which orchard this order's crates were collected from,
                     * read from the line snapshots, so a retired orchard still
                     * renders correctly here years later. An order not yet
                     * accepted has none, because nobody has decided yet.
                     */}
                    {sourcesOf(order).length > 0 && (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <Warehouse aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
                        {sourcesOf(order).map((name) => (
                          <span
                            key={name}
                            className="rounded bg-subtle px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground"
                          >
                            {name}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>

                  <span className="tabular shrink-0 text-sm font-semibold">
                    {formatMoney(order.totals.customerTotal)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
