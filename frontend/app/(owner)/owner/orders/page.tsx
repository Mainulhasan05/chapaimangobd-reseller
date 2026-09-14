'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ClipboardList, Eye, PackageCheck, Truck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatAge, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Order, OwnerDashboard, Paged } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  Checkbox,
  ColumnToggle,
  EmptyState,
  ErrorState,
  PageHeader,
  Person,
  RowMenu,
  SelectionBar,
  SortTh,
  statusTone,
  TableWrap,
  Td,
  Th,
  Tr,
  useColumns,
  useSelection,
  useSort,
  type ColumnDef,
  type MenuItem,
} from '@/components/ui/layout';
import { Segmented, SearchInput, SortSelect, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button } from '@/components/ui/button';
import { ListSkeleton, TableSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { AcceptOrderModal } from '@/components/accept-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { ShipModal } from '@/components/ship-order-modal';
import {
  firstProduct,
  OrderItems,
  OrderItemsInline,
  OrderTiles,
  StageTrack,
} from '@/components/orders-panel';

const PAGE_SIZE = 20;

const FILTERS = [
  { value: '', label: t('app.all') },
  { value: 'confirmed', label: t('order.confirmed') },
  { value: 'accepted', label: t('order.accepted') },
  { value: 'packed', label: t('order.packed') },
  { value: 'shipped', label: t('order.shipped') },
  { value: 'delivered', label: t('order.delivered') },
  { value: 'returned', label: t('order.returned') },
] as const;

/**
 * Only actions the API will accept appear, driven by the server transition table.
 *
 * These are the ones that need nothing but a click. Accept, ship and cancel each
 * ask a question first, so they open a form instead and are listed separately.
 */
const ACTION_LABELS: Record<string, string> = {
  pack: t('order.pack'),
  deliver: t('order.deliver'),
  return: t('order.return'),
};

type SortKey = 'code' | 'reseller' | 'customer' | 'items' | 'amount' | 'status';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'code', label: t('order.code'), locked: true },
  { key: 'reseller', label: t('nav.resellers') },
  { key: 'customer', label: t('order.customer') },
  { key: 'items', label: t('order.items') },
  { key: 'amount', label: t('order.walletDebit') },
  { key: 'status', label: t('app.status') },
];

export default function OwnerOrdersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const router = useRouter();

  const [status, setStatus] = useState<string>('confirmed');
  const [aging, setAging] = useState(false);
  const [term, setTerm] = useState('');
  const [accepting, setAccepting] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [shipping, setShipping] = useState<Order | null>(null);

  const search = useDebounced(term);

  const orders = useInfiniteQuery({
    queryKey: ['owner', 'orders', status, aging, search],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'orders', Order>>(
        `/owner/orders?limit=${PAGE_SIZE}&page=${pageParam}` +
          `${status ? `&status=${status}` : ''}` +
          `${aging ? '&aging=true' : ''}` +
          `${search ? `&q=${encodeURIComponent(search)}` : ''}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.orders.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
    refetchInterval: 60_000,
  });

  /*
   * Counts for the tiles and the filter chips.
   *
   * The dashboard report already groups every order by status, so this needs no
   * endpoint of its own. It shares that query's cache key, which means opening
   * this page after the dashboard costs nothing at all.
   */
  const summary = useQuery({
    queryKey: ['owner', 'dashboard'],
    queryFn: () => api.get<OwnerDashboard>('/owner/reports/dashboard'),
    staleTime: 60_000,
  });

  const counts = summary.data?.byStatus ?? {};

  const loaded = orders.data?.pages.flatMap((page) => page.orders) ?? [];
  const total = orders.data?.pages[0]?.total ?? 0;

  /** The order's own page, which is also where a notification lands. */
  const detailHref = (order: Order) => `/owner/orders/${order.id}` as Route;

  const shopName = (order: Order) =>
    typeof order.reseller === 'object' ? order.reseller.shopName : '';

  /*
   * Sorting reorders what is loaded, not what exists. Every list here is paged,
   * and the alternative, asking the API to sort, would mean the "load more"
   * button could insert rows above the ones already read.
   */
  const sorting = useSort<Order, SortKey>(loaded, {
    code: (order) => order.orderCode,
    reseller: shopName,
    customer: (order) => order.customer.name,
    items: firstProduct,
    amount: (order) => order.totals.walletDebit,
    status: (order) => tStatus(order.status),
  });

  const rows = sorting.rows;
  const selection = useSelection(rows.map((order) => order.id));
  const columns = useColumns(COLUMNS, 'owner-orders');

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api.post(`/owner/orders/${id}/${action}`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      // A row quietly leaving the current filter is not a confirmation.
      toast(t('order.statusUpdated'));
    },
  });

  /*
   * A bulk transition, one request at a time rather than in parallel.
   *
   * Each of these posts to the ledger, so they are serialised deliberately: a
   * burst of concurrent writes against the same reseller's balance is exactly
   * the contention the ledger's atomic update is there to survive, and there is
   * no reason to generate it from the client. Stopping on the first failure
   * leaves a partial result, which the toast reports honestly rather than
   * claiming the whole batch went through.
   */
  const bulk = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: string }) => {
      let done = 0;
      for (const id of ids) {
        await api.post(`/owner/orders/${id}/${action}`, {});
        done += 1;
      }
      return done;
    },
    onSuccess: async (done) => {
      selection.clear();
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      toast(`${done} ${t('order.statusUpdated')}`);
    },
  });

  const actionsFor = (order: Order) => order.actions.filter((action) => action in ACTION_LABELS);

  /*
   * Only offer a bulk button for a transition every selected order can actually
   * make. Orders in different stages are routinely selected together, and a
   * button that half-works is worse than one that is not there.
   *
   * Accept is absent by construction: it is not in ACTION_LABELS, because it now
   * asks which orchard each line comes from and that is a decision per order,
   * not something to apply to twenty of them at once.
   */
  const selectedOrders = rows.filter((order) => selection.isSelected(order.id));
  const commonActions =
    selectedOrders.length > 0
      ? selectedOrders
          .map(actionsFor)
          .reduce((shared, next) => shared.filter((action) => next.includes(action)))
      : [];

  /** The row overflow menu. Everything in it is also a button on the phone card. */
  const menuFor = (order: Order): MenuItem[] => [
    { label: t('order.viewDetail'), icon: Eye, onSelect: () => router.push(detailHref(order)) },
    ...(order.actions.includes('accept')
      ? [{ label: t('order.accept'), icon: PackageCheck, onSelect: () => setAccepting(order) }]
      : []),
    ...actionsFor(order).map((action) => ({
      label: ACTION_LABELS[action],
      onSelect: () => transition.mutate({ id: order.id, action }),
    })),
    ...(order.actions.includes('ship')
      ? [{ label: t('order.ship'), icon: Truck, onSelect: () => setShipping(order) }]
      : []),
    ...(order.actions.includes('cancel')
      ? [
          {
            label: t('app.cancel'),
            icon: Ban,
            tone: 'danger' as const,
            onSelect: () => setCancelling(order),
          },
        ]
      : []),
  ];

  /**
   * The single action an order is most likely waiting for.
   *
   * Follows the fulfilment order, so a confirmed order offers accept, an
   * accepted one offers pack, and so on. Returns nothing once an order is
   * finished or when the server says none of these are allowed, in which case
   * the row simply has no button and the menu still has everything.
   */
  const primaryAction = (order: Order): { label: string; run: () => void } | null => {
    if (order.actions.includes('accept')) {
      return { label: t('order.accept'), run: () => setAccepting(order) };
    }
    if (order.actions.includes('pack')) {
      return {
        label: t('order.pack'),
        run: () => transition.mutate({ id: order.id, action: 'pack' }),
      };
    }
    if (order.actions.includes('ship')) {
      return { label: t('order.ship'), run: () => setShipping(order) };
    }
    if (order.actions.includes('deliver')) {
      return {
        label: t('order.deliver'),
        run: () => transition.mutate({ id: order.id, action: 'deliver' }),
      };
    }
    return null;
  };

  const visibleCols = 2 + COLUMNS.filter((column) => columns.isVisible(column.key)).length;

  return (
    <>
      <PageHeader
        title={t('nav.orders')}
        subtitle={`${formatNumber(total)} ${t('nav.orders')}`}
      />

      {/*
       * The four numbers worth looking at before touching anything, each one a
       * filter. The list below used to open on a status with nothing to say how
       * many were waiting anywhere else.
       */}
      <OrderTiles
        counts={counts}
        aging={summary.data?.agingOrders ?? 0}
        active={status}
        agingActive={aging}
        onPick={(next) => {
          setAging(false);
          setStatus(next);
        }}
        onPickAging={() => {
          // Aging is only meaningful against confirmed orders, which is what
          // the server filters, so the status follows the toggle.
          setStatus('confirmed');
          setAging((current) => !current);
        }}
      />

      <Toolbar>
        <Segmented
          label={t('app.status')}
          value={status}
          onChange={(next) => {
            setAging(false);
            setStatus(next);
          }}
          options={FILTERS.map((filter) => ({
            value: filter.value,
            label: filter.label,
            // A chip on the tab, so the cost of looking somewhere else is
            // visible without going there.
            count: filter.value ? counts[filter.value] : undefined,
          }))}
        />
        <ToolbarSpacer />
        <SearchInput value={term} onChange={setTerm} placeholder={t('app.searchOrders')} />
        <SortSelect
          value={sorting.sort?.key ?? ''}
          onChange={(key) => sorting.setSort(key ? { key, direction: 'asc' } : null)}
          options={COLUMNS.map((column) => ({ value: column.key, label: column.label }))}
        />
        <div className="hidden sm:block">
          <ColumnToggle
            columns={COLUMNS}
            isVisible={columns.isVisible}
            onToggle={columns.toggle}
          />
        </div>
      </Toolbar>

      {transition.error && <Alert tone="danger">{errorMessage(transition.error)}</Alert>}
      {bulk.error && <Alert tone="danger">{errorMessage(bulk.error)}</Alert>}

      <SelectionBar count={selection.count} onClear={selection.clear}>
        {commonActions.map((action) => (
          <Button
            key={action}
            size="sm"
            loading={bulk.isPending && bulk.variables?.action === action}
            onClick={() => bulk.mutate({ ids: [...selection.selected], action })}
          >
            {ACTION_LABELS[action]}
          </Button>
        ))}
      </SelectionBar>

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
          icon={ClipboardList}
          title={search ? t('app.noResults') : t('order.noOrders')}
        />
      )}

      {rows.length > 0 && (
        <>
          {/*
           * Cards everywhere below `xl`, two across once there is room.
           *
           * This table carries eight columns and wants about 930px. From `lg`
           * the sidebar takes 17rem of the window, so a 1024px screen leaves the
           * content column under 700px: the table would still have been a
           * sideways scroller there, truncating the product name to one letter
           * and pushing the action button off the right edge. It only genuinely
           * fits from `xl`.
           */}
          <ul className="grid gap-3 sm:grid-cols-2 xl:hidden">
            {rows.map((order) => (
              <li key={order.id}>
                <Card className="p-4">
                  <Link href={detailHref(order)} className="block w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{order.customer.name}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {order.customer.phoneE164}
                        </p>
                        <p className="text-xs text-muted-foreground">{order.customer.district}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={statusTone(order.status)} dot>
                          {tStatus(order.status)}
                        </Badge>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.paymentMode === 'cod' ? t('order.cod') : t('order.prepaid')}
                        </p>
                        <span className="flex justify-end">
                          <StageTrack status={order.status} />
                        </span>
                      </div>
                    </div>

                    {/*
                     * What was ordered, above the money. A card that showed a
                     * total and no mangoes told the owner nothing they could act
                     * on without opening it.
                     */}
                    <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2">
                      <OrderItemsInline items={order.items} />
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                      <div>
                        <p className="tabular text-lg font-bold">
                          {formatMoney(order.totals.walletDebit)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {shopName(order) || '—'}
                        </p>
                      </div>
                      <p className="tabular shrink-0 text-right text-xs text-muted-foreground">
                        {order.orderCode}
                        <span className="block">
                          {formatAge(order.confirmedAt ?? order.createdAt)}
                        </span>
                      </p>
                    </div>
                  </Link>

                  <div className="mt-3 flex flex-wrap gap-2 [&>button]:flex-1">
                    {order.actions.includes('accept') && (
                      <Button onClick={() => setAccepting(order)}>{t('order.accept')}</Button>
                    )}
                    {actionsFor(order).map((action) => (
                      <Button
                        key={action}
                        variant={action === 'return' ? 'outline' : 'primary'}
                        loading={transition.isPending && transition.variables?.id === order.id}
                        onClick={() => transition.mutate({ id: order.id, action })}
                      >
                        {ACTION_LABELS[action]}
                      </Button>
                    ))}
                    {order.actions.includes('ship') && (
                      <Button onClick={() => setShipping(order)}>{t('order.ship')}</Button>
                    )}
                    {order.actions.includes('cancel') && (
                      <Button variant="outline" onClick={() => setCancelling(order)}>
                        {t('app.cancel')}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap from="xl" minWidth="58rem">
            <thead>
              <tr>
                <Th className="w-10 pr-0">
                  <Checkbox
                    label={t('app.selectAll')}
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    onChange={selection.toggleAll}
                  />
                </Th>
                {columns.isVisible('code') && (
                  <SortTh column="code" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('order.code')}
                  </SortTh>
                )}
                {columns.isVisible('reseller') && (
                  <SortTh column="reseller" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('nav.resellers')}
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
                {columns.isVisible('amount') && (
                  <SortTh column="amount" sort={sorting.sort} onSort={sorting.toggle} align="right">
                    {t('order.walletDebit')}
                  </SortTh>
                )}
                {columns.isVisible('status') && (
                  <SortTh column="status" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('app.status')}
                  </SortTh>
                )}
                <Th className="w-40 text-right">
                  <span className="sr-only">{t('app.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {orders.isFetching && rows.length === 0 && <TableSkeleton cols={visibleCols} />}

              {rows.map((order) => (
                <Tr key={order.id} selected={selection.isSelected(order.id)}>
                  <Td className="pr-0">
                    <Checkbox
                      label={`${t('app.selectRow')} ${order.orderCode}`}
                      checked={selection.isSelected(order.id)}
                      onChange={() => selection.toggle(order.id)}
                    />
                  </Td>

                  {columns.isVisible('code') && (
                    <Td>
                      <Link
                        href={detailHref(order)}
                        className="tabular rounded-md bg-subtle px-1.5 py-0.5 font-semibold text-primary-ink transition-colors hover:bg-primary-softer"
                      >
                        {order.orderCode}
                      </Link>
                      {/*
                       * Cash on delivery is the owner's exposure on this parcel,
                       * so it sits with the code rather than three columns away
                       * under the status.
                       */}
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            'rounded px-1 py-0.5 text-[0.625rem] font-semibold',
                            order.paymentMode === 'cod'
                              ? 'bg-warning-soft text-warning-ink'
                              : 'bg-success-soft text-success'
                          )}
                        >
                          {order.paymentMode === 'cod' ? t('order.cod') : t('order.prepaid')}
                        </span>
                        {formatAge(order.confirmedAt ?? order.createdAt)}
                      </div>
                    </Td>
                  )}

                  {columns.isVisible('reseller') && (
                    <Td>
                      {shopName(order) ? (
                        <Person name={shopName(order)} size="sm" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                  )}

                  {columns.isVisible('customer') && (
                    <Td>
                      <div className="text-sm font-medium">{order.customer.name}</div>
                      <div className="tabular text-xs text-muted-foreground">
                        {order.customer.phoneE164}
                      </div>
                      <div className="text-xs text-muted-foreground">{order.customer.district}</div>
                    </Td>
                  )}

                  {/*
                   * The reason this column exists: the row never said what had
                   * been ordered, so deciding anything about it meant opening it.
                   */}
                  {columns.isVisible('items') && (
                    <Td>
                      <OrderItems items={order.items} />
                    </Td>
                  )}

                  {columns.isVisible('amount') && (
                    <Td className="text-right">
                      <div className="tabular text-base font-bold leading-tight">
                        {formatMoney(order.totals.walletDebit)}
                      </div>
                      {/* What the customer pays, which is the other number in
                        * every conversation about an order. */}
                      <div className="tabular text-xs text-muted-foreground">
                        {formatMoney(order.totals.customerTotal)}
                      </div>
                    </Td>
                  )}

                  {columns.isVisible('status') && (
                    <Td>
                      <Badge tone={statusTone(order.status)} dot>
                        {tStatus(order.status)}
                      </Badge>
                      {/*
                       * The pill says where the order is; the track says how much
                       * is left. Without it every row looked the same weight and
                       * a nearly finished order was indistinguishable from an
                       * untouched one.
                       */}
                      <StageTrack status={order.status} />
                    </Td>
                  )}

                  <Td className="text-right">
                    {/*
                     * The one thing this order most likely needs, as a button.
                     *
                     * Every action lived behind the overflow menu, which meant
                     * accepting forty confirmed orders was forty clicks to open
                     * a menu and forty more to choose the only item anyone ever
                     * chooses. The rest stay in the menu.
                     */}
                    <div className="flex items-center justify-end gap-1">
                      {primaryAction(order) && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={transition.isPending && transition.variables?.id === order.id}
                          onClick={() => primaryAction(order)!.run()}
                        >
                          {primaryAction(order)!.label}
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
        </>
      )}

      <AcceptOrderModal order={accepting} onClose={() => setAccepting(null)} />
      <CancelOrderModal order={cancelling} scope="owner" onClose={() => setCancelling(null)} />
      <ShipModal order={shipping} onClose={() => setShipping(null)} />
    </>
  );
}
