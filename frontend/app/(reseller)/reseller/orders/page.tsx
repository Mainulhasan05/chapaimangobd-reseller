'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Ban, ClipboardList, Eye, Plus } from 'lucide-react';
import { useReadOnlyAccount } from '@/lib/session';
import { useUrlSearch, useUrlState } from '@/lib/use-url-state';
import { LIVE } from '@/lib/store/api';
import { useGetResellerOrdersInfiniteQuery } from '@/lib/store/endpoints/reseller';
import { cn } from '@/lib/utils';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatQuantity, formatAge } from '@/lib/format';
import type { Order } from '@/lib/types';
import {
  Badge,
  Card,
  ColumnToggle,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  RowMenu,
  SortTh,
  statusTone,
  TableWrap,
  Td,
  Th,
  Tr,
  useColumns,
  useSort,
  type ColumnDef,
  type MenuItem,
} from '@/components/ui/layout';
import { Segmented, SearchInput, SortSelect, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button, ButtonLink } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { ConfirmOrderModal } from '@/components/confirm-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: t('app.all') },
  { value: 'pending', label: t('order.pending') },
  { value: 'confirmed', label: t('order.confirmed') },
  { value: 'shipped', label: t('order.shipped') },
  { value: 'delivered', label: t('order.delivered') },
  { value: 'cancelled', label: t('order.cancelled') },
];

type SortKey = 'code' | 'customer' | 'items' | 'total' | 'margin' | 'status';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'code', label: t('order.code'), locked: true },
  { key: 'customer', label: t('order.customer') },
  { key: 'items', label: t('order.items') },
  { key: 'total', label: t('order.customerTotal') },
  { key: 'margin', label: t('order.yourProfit') },
  { key: 'status', label: t('app.status') },
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
  const readOnly = useReadOnlyAccount();
  /*
   * The tab and the search live in the URL, so opening an order and coming back
   * returns to the same list, and the dashboard can link here already filtered.
   */
  const [filters, setFilters] = useUrlState({ status: '' });
  const status = filters.status;
  const { input: term, setInput: setTerm, term: search } = useUrlSearch();
  const [confirming, setConfirming] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const router = useRouter();

  /**
   * Paged rather than a hard-coded fifty. A reseller two seasons in has more
   * orders than that, and the fifty-first was previously unreachable by any
   * means the interface offered.
   */
  const orders = useGetResellerOrdersInfiniteQuery({ status, q: search }, LIVE);
  // The previous list stays on screen, dimmed, while a new tab or search loads.
  const switching = orders.isFetching && !orders.currentData;

  /** The order's own page, which is also where a notification lands. */
  const detailHref = (order: Order) => `/reseller/orders/${order.id}` as Route;

  const loaded = orders.data?.pages.flatMap((page) => page.orders) ?? [];
  const total = orders.data?.pages[0]?.total ?? 0;

  const itemSummary = (order: Order) =>
    order.items
      .map((item) => `${item.productName} ${formatQuantity(item.quantity, item.unit)}`)
      .join(', ');

  /*
   * Sorting reorders the pages already loaded, not the whole history. Asking the
   * API to sort would let "load more" insert rows above ones already read.
   */
  const sorting = useSort<Order, SortKey>(loaded, {
    code: (order) => order.orderCode,
    customer: (order) => order.customer.name,
    items: itemSummary,
    total: (order) => order.totals.customerTotal,
    margin: (order) => order.totals.resellerMargin,
    status: (order) => tStatus(order.status),
  });

  const rows = sorting.rows;
  const columns = useColumns(COLUMNS, 'reseller-orders');

  // Arriving from the dashboard with a specific order to act on. Derived during
  // render rather than pushed into state by an effect, so opening the modal does
  // not cost a second render pass.
  const openId = params.get('open');
  const [autoOpenDismissed, setAutoOpenDismissed] = useState(false);

  const autoOpen =
    openId && !autoOpenDismissed && !readOnly
      ? (rows.find((o) => o.id === openId && o.status === 'pending') ?? null)
      : null;

  const confirmTarget = confirming ?? autoOpen;

  /** Everything here is also a full-width button on the phone card below. */
  const menuFor = (order: Order): MenuItem[] => [
    { label: t('order.viewDetail'), icon: Eye, onSelect: () => router.push(detailHref(order)) },
    ...(!readOnly && order.actions.includes('cancel')
      ? [
          {
            label: t('order.cancelOrder'),
            icon: Ban,
            tone: 'danger' as const,
            onSelect: () => setCancelling(order),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('nav.orders')}
        subtitle={t('order.confirmHelp')}
        action={
          readOnly ? undefined : (
            <ButtonLink href="/reseller/orders/new" size="sm" className="hidden sm:inline-flex">
              {t('order.manualOrder')}
            </ButtonLink>
          )
        }
      />

      {/*
       * One box for the order code, the customer's name and their phone number,
       * because a reseller with someone on the line knows exactly one of those
       * three and should not have to pick a field first.
       */}
      <Toolbar>
        <Segmented
          label={t('app.status')}
          value={status}
          onChange={(value) => setFilters({ status: value })}
          options={FILTERS}
        />
        <ToolbarSpacer />
        <SearchInput value={term} onChange={setTerm} placeholder={t('app.searchOrders')} />
        <SortSelect
          value={sorting.sort?.key ?? ''}
          onChange={(key) => sorting.setSort(key ? { key, direction: 'asc' } : null)}
          options={COLUMNS.map((column) => ({ value: column.key, label: column.label }))}
        />
        <div className="hidden sm:block">
          <ColumnToggle columns={COLUMNS} isVisible={columns.isVisible} onToggle={columns.toggle} />
        </div>
      </Toolbar>

      {!readOnly && (
        <ButtonLink href="/reseller/orders/new" full variant="outline" className="mb-4 sm:hidden">
          <Plus className="h-4 w-4" />
          {t('order.manualOrder')}
        </ButtonLink>
      )}

      {orders.isLoading && <ListSkeleton />}

      {orders.isError && (
        <ErrorState
          onRetry={() => orders.refetch()}
          isRetrying={orders.isFetching}
          error={orders.error}
        />
      )}

      {orders.isSuccess && !switching && rows.length === 0 && (
        search ? (
          <EmptyState
            icon={ClipboardList}
            title={t('app.noResults')}
            description={t('order.searchHelp')}
          />
        ) : status ? (
          // A tab emptied the list, not a lack of orders: say so and offer the way back.
          <FilteredEmpty onClear={() => setFilters({ status: '' })} />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title={t('order.noOrders')}
            description={t('shop.shareHelp')}
          />
        )
      )}

      {rows.length > 0 && (
        <div className={cn('transition-opacity', switching && 'opacity-60')}>
          {/* Phones get cards. A 42rem table put Confirm off the right edge. */}
          {/*
           * Cards below `xl`, two across once there is room. Seven columns want
           * more width than a 1024px screen has left after the sidebar takes its
           * 17rem; see TableWrap.
           */}
          <ul className="grid gap-3 sm:grid-cols-2 xl:hidden">
            {rows.map((order) => (
              <li key={order.id}>
                <OrderCard
                  order={order}
                  readOnly={readOnly}
                  href={detailHref(order)}
                  onConfirm={() => setConfirming(order)}
                  onCancel={() => setCancelling(order)}
                />
              </li>
            ))}
          </ul>

          <TableWrap from="xl" minWidth="52rem">
            <thead>
              <tr>
                {columns.isVisible('code') && (
                  <SortTh column="code" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('order.code')}
                  </SortTh>
                )}
                {columns.isVisible('customer') && (
                  <SortTh column="customer" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('order.customer')}
                  </SortTh>
                )}
                {columns.isVisible('items') && (
                  <SortTh column="items" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('order.items')}
                  </SortTh>
                )}
                {columns.isVisible('total') && (
                  <SortTh column="total" sort={sorting.sort} onSort={sorting.toggle} align="right">
                    {t('order.customerTotal')}
                  </SortTh>
                )}
                {columns.isVisible('margin') && (
                  <SortTh column="margin" sort={sorting.sort} onSort={sorting.toggle} align="right">
                    {t('order.yourProfit')}
                  </SortTh>
                )}
                {columns.isVisible('status') && (
                  <SortTh column="status" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('app.status')}
                  </SortTh>
                )}
                <Th className="w-32 text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <Tr key={order.id}>
                  {columns.isVisible('code') && (
                    <Td>
                      <Link
                        href={detailHref(order)}
                        className="tabular font-semibold text-primary-ink underline-offset-2 hover:underline"
                      >
                        {order.orderCode}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatAge(order.createdAt)}
                      </div>
                    </Td>
                  )}

                  {columns.isVisible('customer') && (
                    <Td>
                      <div className="font-medium">{order.customer.name}</div>
                      <div className="tabular text-xs text-muted-foreground">
                        {order.customer.phoneE164}
                      </div>
                    </Td>
                  )}

                  {columns.isVisible('items') && (
                    <Td className="max-w-56 text-xs text-muted-foreground">
                      <span className="line-clamp-2">{itemSummary(order)}</span>
                    </Td>
                  )}

                  {columns.isVisible('total') && (
                    <Td className="tabular text-right font-semibold">
                      {formatMoney(order.totals.customerTotal)}
                    </Td>
                  )}

                  {columns.isVisible('margin') && (
                    <Td className="tabular text-right font-semibold text-success-ink">
                      {formatMoney(order.totals.resellerMargin)}
                    </Td>
                  )}

                  {columns.isVisible('status') && (
                    <Td>
                      <Badge tone={statusTone(order.status)} dot>
                        {tStatus(order.status)}
                      </Badge>
                    </Td>
                  )}

                  {/*
                   * Confirm stays a button rather than folding into the menu. It
                   * is the one action this page exists for, and burying the
                   * primary action behind a click is how a table stops being a
                   * work queue.
                   */}
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!readOnly && order.actions.includes('confirm') && (
                        <Button size="sm" onClick={() => setConfirming(order)}>
                          {t('app.confirm')}
                        </Button>
                      )}
                      <RowMenu
                        label={`${t('app.actions')} ${order.orderCode}`}
                        items={menuFor(order)}
                      />
                    </div>
                  </Td>
                </Tr>
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
        </div>
      )}

      {/* Mounted only while open, so nothing typed for one order carries into the next. */}
      {confirmTarget && (
        <ConfirmOrderModal
          key={confirmTarget.id}
          order={confirmTarget}
          onClose={() => {
            setConfirming(null);
            setAutoOpenDismissed(true);
          }}
        />
      )}
      {cancelling && (
        <CancelOrderModal
          key={cancelling.id}
          order={cancelling}
          scope="reseller"
          onClose={() => setCancelling(null)}
        />
      )}
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
  readOnly,
  href,
  onConfirm,
  onCancel,
}: {
  order: Order;
  readOnly: boolean;
  href: Route;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const canConfirm = !readOnly && order.actions.includes('confirm');
  const canCancel = !readOnly && order.actions.includes('cancel');

  return (
    <Card className="p-4">
      <Link href={href} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{order.customer.name}</p>
            <p className="tabular text-xs text-muted-foreground">{order.customer.phoneE164}</p>
          </div>
          <Badge tone={statusTone(order.status)} dot>
            {tStatus(order.status)}
          </Badge>
        </div>

        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {order.items
            .map((item) => `${item.productName} ${formatQuantity(item.quantity, item.unit)}`)
            .join(', ')}
        </p>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
          <div>
            <p className="tabular text-lg font-bold">
              {formatMoney(order.totals.customerTotal)}
            </p>
            <p className="tabular text-xs font-semibold text-success-ink">
              {t('order.yourProfit')} {formatMoney(order.totals.resellerMargin)}
            </p>
          </div>
          <p className="tabular shrink-0 text-right text-xs text-muted-foreground">
            {order.orderCode}
            <span className="block">{formatAge(order.createdAt)}</span>
          </p>
        </div>
      </Link>

      {(canConfirm || canCancel) && (
        <div className="mt-3 flex gap-2 [&>button]:flex-1">
          {canConfirm && <Button onClick={onConfirm}>{t('app.confirm')}</Button>}
          {canCancel && (
            <Button variant="outline" onClick={onCancel}>
              {t('order.cancelOrder')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
