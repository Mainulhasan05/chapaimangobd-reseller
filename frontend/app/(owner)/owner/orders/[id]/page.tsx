'use client';

import { use, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Order } from '@/lib/types';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { OrderPage } from '@/components/order-page';
import { AcceptOrderModal } from '@/components/accept-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { ShipModal } from '@/components/ship-order-modal';
import { ReturnOrderModal } from '@/components/return-order-modal';
import { DeliveryChargeModal } from '@/components/delivery-charge-field';

/**
 * The transitions that need nothing but a click. The rest ask a question first:
 * accept (sources), ship (courier), cancel (reason) and return (stock).
 */
const CLICK_ACTIONS: Record<string, string> = {
  pack: t('order.pack'),
  deliver: t('order.deliver'),
};

/** One order, as the owner sees it. Addressed by the order id. */
export default function OwnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 16; `use` unwraps it in a client component.
  const { id } = use(params);

  const queryClient = useQueryClient();
  const toast = useToast();
  const [accepting, setAccepting] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [shipping, setShipping] = useState<Order | null>(null);
  const [returning, setReturning] = useState<Order | null>(null);
  const [editingCharge, setEditingCharge] = useState<Order | null>(null);

  const transition = useMutation({
    mutationFn: ({ action }: { action: string }) => api.post(`/owner/orders/${id}/${action}`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      toast(t('order.statusUpdated'));
    },
  });

  const actionsFor = (order: Order) => {
    const clicks = order.actions.filter((action) => action in CLICK_ACTIONS);
    const any =
      clicks.length > 0 ||
      ['accept', 'ship', 'cancel', 'return'].some((action) => order.actions.includes(action));
    if (!any) return null;

    return (
      <>
        {order.actions.includes('accept') && (
          <Button onClick={() => setAccepting(order)}>{t('order.accept')}</Button>
        )}
        {clicks.map((action) => (
          <Button
            key={action}
            loading={transition.isPending && transition.variables?.action === action}
            disabled={transition.isPending}
            onClick={() => transition.mutate({ action })}
          >
            {CLICK_ACTIONS[action]}
          </Button>
        ))}
        {order.actions.includes('ship') && (
          <Button onClick={() => setShipping(order)}>{t('order.ship')}</Button>
        )}
        {order.actions.includes('return') && (
          <Button variant="outline" onClick={() => setReturning(order)}>
            {t('order.return')}
          </Button>
        )}
        {order.actions.includes('cancel') && (
          <Button variant="outline" onClick={() => setCancelling(order)}>
            {t('app.cancel')}
          </Button>
        )}
      </>
    );
  };

  return (
    <>
      {transition.error && <Alert tone="danger">{errorMessage(transition.error)}</Alert>}

      <OrderPage
        scope="owner"
        id={id}
        backHref="/owner/orders"
        actions={actionsFor}
        onEditDeliveryCharge={setEditingCharge}
      />

      <AcceptOrderModal order={accepting} onClose={() => setAccepting(null)} />
      <CancelOrderModal order={cancelling} scope="owner" onClose={() => setCancelling(null)} />
      <ShipModal order={shipping} onClose={() => setShipping(null)} />
      <ReturnOrderModal order={returning} onClose={() => setReturning(null)} />
      <DeliveryChargeModal order={editingCharge} onClose={() => setEditingCharge(null)} />
    </>
  );
}
