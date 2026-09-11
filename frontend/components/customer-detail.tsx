'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatDateTime } from '@/lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  statusTone,
} from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';
import { CustomerProfile } from '@/components/customer-profile';
import type { Customer, Order } from '@/lib/types';

/**
 * One buyer's whole history with whoever is looking.
 *
 * The order list underneath is the point of the screen. It shows the name and
 * the address used on each order rather than the buyer's current ones, because
 * those are the things that change between orders and the reason someone opened
 * this: the same number ordering under a different name each time is not an
 * anomaly here, it is the normal case.
 */

type Response = { customer: Customer; orders: (Order & { shopName?: string | null })[] };

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
  const query = useQuery({
    queryKey: ['customer', base, identifier],
    queryFn: () =>
      api.get<Response>(`${base}/customers/${encodeURIComponent(identifier)}`),
  });

  if (query.isLoading) return <ListSkeleton rows={5} />;

  if (query.isError) {
    return (
      <>
        <PageHeader title={t('cust.title')} />
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} />
      </>
    );
  }

  const { customer, orders } = query.data!;

  return (
    <>
      <Link
        href={backHref}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('app.back')}
      </Link>

      <CustomerProfile customer={customer} />

      <Card>
        <CardHeader title={t('cust.orderHistory')} />

        {orders.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t('app.none')} />
        ) : (
          <ul className="-my-1 divide-y divide-border">
            {orders.map((order, index) => (
              <li key={order.id}>
                <Link
                  href={orderHref(order)}
                  className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-muted"
                >
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
                      <span className="tabular text-sm font-semibold">{order.orderCode}</span>
                      <Badge tone={statusTone(order.status)} dot>
                        {tStatus(order.status)}
                      </Badge>
                      {order.shopName && (
                        <span className="text-xs text-muted-foreground">{order.shopName}</span>
                      )}
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
                  </span>

                  <span className="tabular shrink-0 text-sm font-semibold">
                    {formatMoney(order.totals.customerTotal)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
