'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, ClipboardList, Eye, PackageCheck, Truck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatAge } from '@/lib/format';
import type { Order, Paged } from '@/lib/types';
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
import { Field, Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { AcceptOrderModal } from '@/components/accept-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { OrderDetail } from '@/components/order-detail';

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

type SortKey = 'code' | 'reseller' | 'customer' | 'amount' | 'status';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'code', label: t('order.code'), locked: true },
  { key: 'reseller', label: t('nav.resellers') },
  { key: 'customer', label: t('order.customer') },
  { key: 'amount', label: t('order.walletDebit') },
  { key: 'status', label: t('app.status') },
];

export default function OwnerOrdersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [status, setStatus] = useState<string>('confirmed');
  const [aging, setAging] = useState(false);
  const [term, setTerm] = useState('');
  const [viewing, setViewing] = useState<Order | null>(null);
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

  const loaded = orders.data?.pages.flatMap((page) => page.orders) ?? [];
  const total = orders.data?.pages[0]?.total ?? 0;

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
    { label: t('order.viewDetail'), icon: Eye, onSelect: () => setViewing(order) },
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

  const visibleCols = 2 + COLUMNS.filter((column) => columns.isVisible(column.key)).length;

  return (
    <>
      <PageHeader title={t('nav.orders')} subtitle={`${total} ${t('nav.orders')}`} />

      <Toolbar>
        <Segmented
          label={t('app.status')}
          value={status}
          onChange={setStatus}
          options={FILTERS.map((filter) => ({ value: filter.value, label: filter.label }))}
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

      <div className="mb-4 sm:max-w-xs">
        <Switch checked={aging} onChange={setAging} label={t('order.aging')} />
      </div>

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
          {/* Phones get cards. The table below is hidden there entirely. */}
          <ul className="space-y-3 sm:hidden">
            {rows.map((order) => (
              <li key={order.id}>
                <Card className="p-4">
                  <button
                    type="button"
                    onClick={() => setViewing(order)}
                    className="block w-full text-left"
                  >
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
                      </div>
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
                  </button>

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

          <TableWrap>
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
                <Th className="w-12 text-right">
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
                      <button
                        type="button"
                        onClick={() => setViewing(order)}
                        className="tabular font-semibold text-primary-ink underline-offset-2 hover:underline"
                      >
                        {order.orderCode}
                      </button>
                      <div className="text-xs text-muted-foreground">
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

                  {columns.isVisible('amount') && (
                    <Td className="tabular text-right font-semibold">
                      {formatMoney(order.totals.walletDebit)}
                    </Td>
                  )}

                  {columns.isVisible('status') && (
                    <Td>
                      <Badge tone={statusTone(order.status)} dot>
                        {tStatus(order.status)}
                      </Badge>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {order.paymentMode === 'cod' ? t('order.cod') : t('order.prepaid')}
                      </div>
                    </Td>
                  )}

                  <Td className="text-right">
                    <RowMenu label={`${t('app.actions')} ${order.orderCode}`} items={menuFor(order)} />
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

      <OrderDetail order={viewing} onClose={() => setViewing(null)} showCost />
      <AcceptOrderModal order={accepting} onClose={() => setAccepting(null)} />
      <CancelOrderModal order={cancelling} scope="owner" onClose={() => setCancelling(null)} />
      <ShipModal order={shipping} onClose={() => setShipping(null)} />
    </>
  );
}

function ShipModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [courierName, setCourierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  const ship = useMutation({
    mutationFn: () => api.post(`/owner/orders/${order!.id}/ship`, { courierName, trackingNumber }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setCourierName('');
      setTrackingNumber('');
      onClose();
      toast(t('order.shippedToast'));
    },
  });

  if (!order) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('order.ship')} · ${order.orderCode}`}
      dirty={courierName.trim().length > 0 || trackingNumber.trim().length > 0}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={ship.isPending}
            disabled={courierName.trim().length < 2}
            onClick={() => ship.mutate()}
          >
            {t('order.ship')}
          </Button>
        </>
      }
    >
      {ship.error && <Alert tone="danger">{errorMessage(ship.error)}</Alert>}

      <Field label={t('order.courier')} htmlFor="courierName" required>
        <Input id="courierName" value={courierName} onChange={(e) => setCourierName(e.target.value)} />
      </Field>

      <Field
        label={t('order.trackingNumber')}
        htmlFor="trackingNumber"
        hint={t('app.optional')}
        className="mb-0"
      >
        <Input
          id="trackingNumber"
          className="tabular"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
