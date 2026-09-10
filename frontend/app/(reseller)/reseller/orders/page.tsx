'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatQuantity, formatAge } from '@/lib/format';
import type { Order, Paged } from '@/lib/types';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  statusTone,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { ConfirmOrderModal } from '@/components/confirm-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { OrderDetail } from '@/components/order-detail';

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
    <Suspense fallback={<Spinner />}>
      <OrdersView />
    </Suspense>
  );
}

function OrdersView() {
  const params = useSearchParams();
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [viewing, setViewing] = useState<Order | null>(null);

  const orders = useQuery({
    queryKey: ['orders', status],
    queryFn: () =>
      api.get<Paged<'orders', Order>>(
        `/reseller/orders?limit=50${status ? `&status=${status}` : ''}`
      ),
    refetchInterval: 60_000,
  });

  // Arriving from the dashboard with a specific order to act on. Derived during
  // render rather than pushed into state by an effect, so opening the modal does
  // not cost a second render pass.
  const openId = params.get('open');
  const [autoOpenDismissed, setAutoOpenDismissed] = useState(false);

  const autoOpen =
    openId && !autoOpenDismissed
      ? (orders.data?.orders.find((o) => o.id === openId && o.status === 'pending') ?? null)
      : null;

  const confirmTarget = confirming ?? autoOpen;

  return (
    <>
      <PageHeader
        title={t('nav.orders')}
        subtitle={t('order.confirmHelp')}
        action={
          <div className="flex items-center gap-2">
            <Link href="/reseller/orders/new">
              <Button size="sm">{t('order.manualOrder')}</Button>
            </Link>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-40"
              aria-label={t('app.status')}
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {orders.isLoading && (
        <Card className="flex justify-center py-10 text-muted-foreground">
          <Spinner />
        </Card>
      )}

      {orders.data?.orders.length === 0 && <EmptyState title={t('order.noOrders')} />}

      {orders.data && orders.data.orders.length > 0 && (
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
            {orders.data.orders.map((order) => (
              <tr key={order.id} className="hover:bg-muted/50">
                <Td>
                  <button
                    type="button"
                    onClick={() => setViewing(order)}
                    className="tabular font-medium underline-offset-2 hover:underline"
                  >
                    {order.orderCode}
                  </button>
                  <div className="text-xs text-muted-foreground">{formatAge(order.createdAt)}</div>
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
      )}

      <ConfirmOrderModal
        order={confirmTarget}
        onClose={() => {
          setConfirming(null);
          setAutoOpenDismissed(true);
        }}
      />
      <CancelOrderModal
        order={cancelling}
        scope="reseller"
        onClose={() => setCancelling(null)}
      />
      <OrderDetail order={viewing} onClose={() => setViewing(null)} showCost />
    </>
  );
}
