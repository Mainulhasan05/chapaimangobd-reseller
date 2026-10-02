'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { useDeliverOrderMutation, usePackOrderMutation } from '@/lib/store/endpoints/orders';
import type { Order } from '@/lib/types';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { useToast } from '@/components/ui/toast';
import { AcceptOrderModal } from '@/components/accept-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { CourierEditModal, ShipModal } from '@/components/ship-order-modal';
import { ReturnOrderModal } from '@/components/return-order-modal';
import { DeliveryChargeModal } from '@/components/delivery-charge-field';
import { ComplaintModal } from '@/components/complaint-modal';
import { ownerStatusLabel } from '@/components/orders-panel';

/**
 * Everything the owner can do to one order, shared by the list and the order
 * page so the two cannot drift apart.
 *
 * One sheet at a time, mounted only while open and keyed by the order, so what
 * was typed for one parcel can never be sent for the next one. Every sheet
 * closes the moment its request answers; the toast says which order moved and
 * where to, because a row quietly leaving the list is not a confirmation, and
 * a failure is a danger toast rather than a banner at the top of a long list.
 */

export type SheetKind =
  | 'accept'
  | 'ship'
  | 'deliver'
  | 'cancel'
  | 'return'
  | 'charge'
  | 'courier'
  | 'complaint';

/** The one thing an order is most likely waiting for, in fulfilment order. */
export type PrimaryAction = { action: 'accept' | 'pack' | 'ship' | 'deliver'; label: string };

export function primaryActionOf(order: Order): PrimaryAction | null {
  if (order.actions.includes('accept')) return { action: 'accept', label: t('order.accept') };
  if (order.actions.includes('pack')) return { action: 'pack', label: t('order.pack') };
  if (order.actions.includes('ship')) return { action: 'ship', label: t('order.ship') };
  if (order.actions.includes('deliver')) return { action: 'deliver', label: t('orders.deliverShort') };
  return null;
}

export function useOrderActions({
  onDone,
}: {
  /** After a transition went through: the list moves focus to the next row. */
  onDone?: (order: Order) => void;
} = {}) {
  const toast = useToast();
  const [sheet, setSheet] = useState<{ kind: SheetKind; order: Order } | null>(null);
  const [pack, packState] = usePackOrderMutation();
  const [deliver] = useDeliverOrderMutation();

  const close = () => setSheet(null);

  const done = (order: Order) => {
    toast(tf('orders.movedTo', { code: order.orderCode, status: ownerStatusLabel(order.status) }));
    onDone?.(order);
  };

  /** Pack needs no question, so it runs straight from the button. */
  const runPack = async (order: Order) => {
    try {
      const { order: packed } = await pack({ id: order.id }).unwrap();
      done(packed);
    } catch (failure) {
      toast(`${order.orderCode}: ${errorMessage(failure)}`, 'danger');
    }
  };

  const run = (action: PrimaryAction['action'], order: Order) => {
    if (action === 'pack') void runPack(order);
    else setSheet({ kind: action, order });
  };

  const open = (kind: SheetKind, order: Order) => setSheet({ kind, order });

  const target = sheet?.order;
  const sheets = target ? (
    <>
      {sheet.kind === 'accept' && (
        <AcceptOrderModal key={target.id} order={target} onClose={close} onDone={done} />
      )}
      {sheet.kind === 'ship' && <ShipModal key={target.id} order={target} onClose={close} onDone={done} />}
      {sheet.kind === 'deliver' && (
        <DeliverSheet
          key={target.id}
          order={target}
          onClose={close}
          onConfirm={async () => {
            const { order: delivered } = await deliver({ id: target.id }).unwrap();
            done(delivered);
          }}
        />
      )}
      {sheet.kind === 'cancel' && (
        <CancelOrderModal
          key={target.id}
          order={target}
          scope="owner"
          onClose={close}
          onDone={done}
        />
      )}
      {sheet.kind === 'return' && (
        <ReturnOrderModal key={target.id} order={target} onClose={close} onDone={done} />
      )}
      {sheet.kind === 'charge' && <DeliveryChargeModal key={target.id} order={target} onClose={close} />}
      {sheet.kind === 'courier' && <CourierEditModal key={target.id} order={target} onClose={close} />}
      {sheet.kind === 'complaint' && <ComplaintModal key={target.id} order={target} onClose={close} />}
    </>
  ) : null;

  return {
    open,
    run,
    /** The order whose pack request is in flight, for its button's spinner. */
    packingId: packState.isLoading ? packState.originalArgs?.id : undefined,
    sheets,
  };
}

/**
 * Marking a parcel delivered, which is not undoable and moves money: on cash
 * on delivery the courier's collection is credited to the reseller, and either
 * way the parcel's packaging is taken off the shelf (docs/adr/0026). It used to
 * happen on one tap beside "ship".
 */
function DeliverSheet({
  order,
  onClose,
  onConfirm,
}: {
  order: Order;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const isCod = order.paymentMode === 'cod';
  return (
    <ConfirmSheet
      title={`${t('orders.markDelivered')} · ${order.orderCode}`}
      tone="success"
      confirmLabel={t('orders.markDelivered')}
      summary={
        <>
          <p className="font-semibold">{order.customer.name}</p>
          <p className="text-muted-foreground">
            {order.courier?.name}
            {order.courier?.trackingNumber ? ` · ${order.courier.trackingNumber}` : ''}
          </p>
        </>
      }
      rows={
        isCod
          ? [
              {
                label: t('orders.courierCollects'),
                value: formatMoney(order.totals.customerTotal),
                tone: 'warning',
                strong: true,
              },
            ]
          : [{ label: t('order.paymentMode'), value: t('order.prepaid') }]
      }
      consequences={[
        isCod
          ? tf('orders.deliverCodCredit', { amount: formatMoney(order.totals.customerTotal) })
          : t('orders.deliverPrepaid'),
        t('orders.deliverPackaging'),
        t('orders.deliverFinal'),
      ]}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

/** The same question for several parcels at once: how many, and what the couriers bring back. */
export function BulkDeliverSheet({
  orders,
  onClose,
  onConfirm,
}: {
  orders: Order[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const cod = orders.filter((order) => order.paymentMode === 'cod');
  const codTotal = cod.reduce((sum, order) => sum + order.totals.customerTotal, 0);
  return (
    <ConfirmSheet
      title={tf('orders.bulkDeliverTitle', { count: formatNumber(orders.length) })}
      tone="success"
      confirmLabel={tf('orders.bulkDeliverConfirm', { count: formatNumber(orders.length) })}
      rows={[
        { label: t('orders.codOrders'), value: tf('orders.countOf', { count: formatNumber(cod.length) }) },
        { label: t('orders.courierCollects'), value: formatMoney(codTotal), tone: 'warning', strong: true },
      ]}
      consequences={[t('orders.bulkDeliverCredit'), t('orders.deliverPackaging'), t('orders.deliverFinal')]}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
