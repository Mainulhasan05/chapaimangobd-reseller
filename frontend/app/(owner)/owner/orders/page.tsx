'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatAge } from '@/lib/format';
import type { Order, Paged } from '@/lib/types';
import {
  Alert,
  Badge,
  EmptyState,
  ErrorState,
  Card,
  PageHeader,
  statusTone,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Field, Input, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
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
];

/** Only actions the API will accept appear, driven by the server transition table. */
const ACTION_LABELS: Record<string, string> = {
  accept: t('order.accept'),
  pack: t('order.pack'),
  deliver: t('order.deliver'),
  return: t('order.return'),
};

export default function OwnerOrdersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [status, setStatus] = useState('confirmed');
  const [aging, setAging] = useState(false);
  const [term, setTerm] = useState('');
  const [viewing, setViewing] = useState<Order | null>(null);
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

  const rows = orders.data?.pages.flatMap((page) => page.orders) ?? [];
  const total = orders.data?.pages[0]?.total ?? 0;

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api.post(`/owner/orders/${id}/${action}`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      // A row quietly leaving the current filter is not a confirmation.
      toast(t('order.statusUpdated'));
    },
  });

  const actionsFor = (order: Order) => order.actions.filter((a) => a in ACTION_LABELS);

  return (
    <>
      <PageHeader title={t('nav.orders')} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
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

      <div className="mb-4 sm:max-w-xs">
        <Switch checked={aging} onChange={setAging} label={t('order.aging')} />
      </div>

      {transition.error && <Alert tone="danger">{errorMessage(transition.error)}</Alert>}

      {orders.isLoading && <ListSkeleton />}

      {orders.isError && (
        <ErrorState
          onRetry={() => orders.refetch()}
          isRetrying={orders.isFetching}
          error={orders.error}
        />
      )}

      {orders.isSuccess && rows.length === 0 && (
        <EmptyState title={search ? t('app.noResults') : t('order.noOrders')} />
      )}

      {rows.length > 0 && (
        <>
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
                        <p className="truncate font-medium">{order.customer.name}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {order.customer.phoneE164}
                        </p>
                        <p className="text-xs text-muted-foreground">{order.customer.district}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={statusTone(order.status)}>{tStatus(order.status)}</Badge>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.paymentMode === 'cod' ? t('order.cod') : t('order.prepaid')}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                      <div>
                        <p className="tabular text-lg font-semibold">
                          {formatMoney(order.totals.walletDebit)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {typeof order.reseller === 'object' ? order.reseller.shopName : '—'}
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
                <Th>{t('order.code')}</Th>
                <Th>{t('nav.resellers')}</Th>
                <Th>{t('order.customer')}</Th>
                <Th className="text-right">{t('order.walletDebit')}</Th>
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
                      {formatAge(order.confirmedAt ?? order.createdAt)}
                    </div>
                  </Td>
                  <Td className="text-sm">
                    {typeof order.reseller === 'object' ? order.reseller.shopName : '—'}
                  </Td>
                  <Td>
                    <div className="text-sm">{order.customer.name}</div>
                    <div className="tabular text-xs text-muted-foreground">
                      {order.customer.phoneE164}
                    </div>
                    <div className="text-xs text-muted-foreground">{order.customer.district}</div>
                  </Td>
                  <Td className="tabular text-right">{formatMoney(order.totals.walletDebit)}</Td>
                  <Td>
                    <Badge tone={statusTone(order.status)}>{tStatus(order.status)}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {order.paymentMode === 'cod' ? t('order.cod') : t('order.prepaid')}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {actionsFor(order).map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === 'return' ? 'outline' : 'primary'}
                          loading={transition.isPending && transition.variables?.id === order.id}
                          onClick={() => transition.mutate({ id: order.id, action })}
                        >
                          {ACTION_LABELS[action]}
                        </Button>
                      ))}

                      {/* Shipping needs a courier name, so it gets a form. */}
                      {order.actions.includes('ship') && (
                        <Button size="sm" onClick={() => setShipping(order)}>
                          {t('order.ship')}
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

      <OrderDetail order={viewing} onClose={() => setViewing(null)} showCost />
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
