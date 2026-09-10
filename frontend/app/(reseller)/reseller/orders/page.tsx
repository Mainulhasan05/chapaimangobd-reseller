'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatQuantity, formatAge } from '@/lib/format';
import type { Order, Paged } from '@/lib/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  statusTone,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Input, Select } from '@/components/ui/form';
import { ConfirmOrderModal } from '@/components/confirm-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { OrderDetail } from '@/components/order-detail';

const PAGE_SIZE = 20;

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: t('app.all') },
  { value: 'pending', label: t('order.pending') },
  { value: 'confirmed', label: t('order.confirmed') },
  { value: 'shipped', label: t('order.shipped') },
  { value: 'delivered', label: t('order.delivered') },
  { value: 'cancelled', label: t('order.cancelled') },
];

export default function ResellerOrdersPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <OrdersView />
    </Suspense>
  );
}

function OrdersView() {
  const params = useSearchParams();
  // The dashboard links here with a filter already chosen.
  const [status, setStatus] = useState(() => params.get('status') ?? '');
  const [term, setTerm] = useState('');
  const [confirming, setConfirming] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [viewing, setViewing] = useState<Order | null>(null);

  const search = useDebounced(term);

  /**
   * Paged rather than a hard-coded fifty. A reseller two seasons in has more
   * orders than that, and the fifty-first was previously unreachable by any
   * means the interface offered.
   */
  const orders = useInfiniteQuery({
    queryKey: ['orders', status, search],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'orders', Order>>(
        `/reseller/orders?limit=${PAGE_SIZE}&page=${pageParam}` +
          `${status ? `&status=${status}` : ''}` +
          `${search ? `&q=${encodeURIComponent(search)}` : ''}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.orders.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
    refetchInterval: 60_000,
  });

  const rows = orders.data?.pages.flatMap((page) => page.orders) ?? [];
  const total = orders.data?.pages[0]?.total ?? 0;

  // Arriving from the dashboard with a specific order to act on. Derived during
  // render rather than pushed into state by an effect, so opening the modal does
  // not cost a second render pass.
  const openId = params.get('open');
  const [autoOpenDismissed, setAutoOpenDismissed] = useState(false);

  const autoOpen =
    openId && !autoOpenDismissed
      ? (rows.find((o) => o.id === openId && o.status === 'pending') ?? null)
      : null;

  const confirmTarget = confirming ?? autoOpen;

  return (
    <>
      <PageHeader
        title={t('nav.orders')}
        subtitle={t('order.confirmHelp')}
        action={
          <Link href="/reseller/orders/new" className="hidden sm:block">
            <Button size="sm">{t('order.manualOrder')}</Button>
          </Link>
        }
      />

      {/*
       * One box for the order code, the customer's name and their phone number,
       * because a reseller with someone on the line knows exactly one of those
       * three and should not have to pick a field first.
       */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('app.searchOrders')}
            aria-label={t('order.searchHelp')}
            className="pl-9 pr-9"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label={t('app.clear')}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="sm:w-40"
          aria-label={t('app.status')}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>

      <Link href="/reseller/orders/new" className="mb-4 block sm:hidden">
        <Button full variant="outline">
          {t('order.manualOrder')}
        </Button>
      </Link>

      {orders.isLoading && <ListSkeleton />}

      {orders.isError && (
        <ErrorState
          onRetry={() => orders.refetch()}
          isRetrying={orders.isFetching}
          error={orders.error}
        />
      )}

      {orders.isSuccess && rows.length === 0 && (
        <EmptyState
          title={search ? t('app.noResults') : t('order.noOrders')}
          description={search ? t('order.searchHelp') : t('shop.shareHelp')}
        />
      )}

      {rows.length > 0 && (
        <>
          {/* Phones get cards. A 42rem table put Confirm off the right edge. */}
          <ul className="space-y-3 sm:hidden">
            {rows.map((order) => (
              <li key={order.id}>
                <OrderCard
                  order={order}
                  onView={() => setViewing(order)}
                  onConfirm={() => setConfirming(order)}
                  onCancel={() => setCancelling(order)}
                />
              </li>
            ))}
          </ul>

          <TableWrap>
            <thead>
              <tr>
                <Th>{t('order.code')}</Th>
                <Th>{t('order.customer')}</Th>
                <Th>{t('order.items')}</Th>
                <Th className="text-right">{t('order.customerTotal')}</Th>
                <Th className="text-right">{t('order.yourProfit')}</Th>
                <Th>{t('app.status')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} className="hover:bg-muted/50">
                  <Td>
                    <button
                      type="button"
                      onClick={() => setViewing(order)}
                      className="tabular font-medium underline-offset-2 hover:underline"
                    >
                      {order.orderCode}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {formatAge(order.createdAt)}
                    </div>
                  </Td>
                  <Td>
                    <div className="font-medium">{order.customer.name}</div>
                    <div className="tabular text-xs text-muted-foreground">
                      {order.customer.phoneE164}
                    </div>
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {order.items
                      .map((i) => `${i.productName} ${formatQuantity(i.quantity, i.unit)}`)
                      .join(', ')}
                  </Td>
                  <Td className="tabular text-right">{formatMoney(order.totals.customerTotal)}</Td>
                  <Td className="tabular text-right text-success">
                    {formatMoney(order.totals.resellerMargin)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(order.status)}>{tStatus(order.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      {order.actions.includes('confirm') && (
                        <Button size="sm" onClick={() => setConfirming(order)}>
                          {t('app.confirm')}
                        </Button>
                      )}
                      {order.actions.includes('cancel') && (
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(order)}>
                          {t('app.cancel')}
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <div className="mt-4 flex flex-col items-center gap-2">
            {orders.hasNextPage ? (
              <Button
                variant="outline"
                full
                loading={orders.isFetchingNextPage}
                onClick={() => orders.fetchNextPage()}
                className="sm:w-auto"
              >
                {t('app.loadMore')}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{t('app.allLoaded')}</p>
            )}
            <p className="tabular text-xs text-muted-foreground">
              {rows.length} / {total}
            </p>
          </div>
        </>
      )}

      <ConfirmOrderModal
        order={confirmTarget}
        onClose={() => {
          setConfirming(null);
          setAutoOpenDismissed(true);
        }}
      />
      <CancelOrderModal order={cancelling} scope="reseller" onClose={() => setCancelling(null)} />
      <OrderDetail order={viewing} onClose={() => setViewing(null)} showCost />
    </>
  );
}

/**
 * One order on a phone.
 *
 * The card itself opens the detail and the buttons sit on their own row at full
 * width, so the two things a reseller does to a pending order are the two
 * largest targets on it.
 */
function OrderCard({
  order,
  onView,
  onConfirm,
  onCancel,
}: {
  order: Order;
  onView: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const canConfirm = order.actions.includes('confirm');
  const canCancel = order.actions.includes('cancel');

  return (
    <Card className="p-4">
      <button type="button" onClick={onView} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{order.customer.name}</p>
            <p className="tabular text-xs text-muted-foreground">{order.customer.phoneE164}</p>
          </div>
          <Badge tone={statusTone(order.status)}>{tStatus(order.status)}</Badge>
        </div>

        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {order.items
            .map((item) => `${item.productName} ${formatQuantity(item.quantity, item.unit)}`)
            .join(', ')}
        </p>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
          <div>
            <p className="tabular text-lg font-semibold">
              {formatMoney(order.totals.customerTotal)}
            </p>
            <p className="tabular text-xs text-success">
              {t('order.yourProfit')} {formatMoney(order.totals.resellerMargin)}
            </p>
          </div>
          <p className="tabular shrink-0 text-right text-xs text-muted-foreground">
            {order.orderCode}
            <span className="block">{formatAge(order.createdAt)}</span>
          </p>
        </div>
      </button>

      {(canConfirm || canCancel) && (
        <div className="mt-3 flex gap-2 [&>button]:flex-1">
          {canConfirm && <Button onClick={onConfirm}>{t('app.confirm')}</Button>}
          {canCancel && (
            <Button variant="outline" onClick={onCancel}>
              {t('app.cancel')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
