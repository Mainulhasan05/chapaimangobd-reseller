'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatAge } from '@/lib/format';
import type { Order, Paged } from '@/lib/types';
import {
  Alert,
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
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { OrderDetail } from '@/components/order-detail';

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
  const [status, setStatus] = useState('confirmed');
  const [aging, setAging] = useState(false);
  const [viewing, setViewing] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [shipping, setShipping] = useState<Order | null>(null);

  const orders = useQuery({
    queryKey: ['owner', 'orders', status, aging],
    queryFn: () =>
      api.get<Paged<'orders', Order>>(
        `/owner/orders?limit=50${status ? `&status=${status}` : ''}${aging ? '&aging=true' : ''}`
      ),
    refetchInterval: 60_000,
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api.post(`/owner/orders/${id}/${action}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner'] }),
  });

  return (
    <>
      <PageHeader
        title={t('nav.orders')}
        action={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={aging}
                onChange={(e) => setAging(e.target.checked)}
              />
              {t('order.aging')}
            </label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {transition.error && <Alert tone="danger">{errorMessage(transition.error)}</Alert>}

      {orders.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {orders.data?.orders.length === 0 && <EmptyState title={t('order.noOrders')} />}

      {orders.data && orders.data.orders.length > 0 && (
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
                    {order.actions
                      .filter((action) => action in ACTION_LABELS)
                      .map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === 'return' ? 'outline' : 'primary'}
                          loading={
                            transition.isPending && transition.variables?.id === order.id
                          }
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
      )}

      <OrderDetail order={viewing} onClose={() => setViewing(null)} showCost />
      <CancelOrderModal order={cancelling} scope="owner" onClose={() => setCancelling(null)} />
      <ShipModal order={shipping} onClose={() => setShipping(null)} />
    </>
  );
}

function ShipModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [courierName, setCourierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  const ship = useMutation({
    mutationFn: () =>
      api.post(`/owner/orders/${order!.id}/ship`, { courierName, trackingNumber }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setCourierName('');
      setTrackingNumber('');
      onClose();
    },
  });

  if (!order) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('order.ship')} · ${order.orderCode}`}
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
        <Input
          id="courierName"
          value={courierName}
          onChange={(e) => setCourierName(e.target.value)}
          autoFocus
        />
      </Field>

      <Field label={t('order.trackingNumber')} htmlFor="trackingNumber" hint={t('app.optional')}>
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
