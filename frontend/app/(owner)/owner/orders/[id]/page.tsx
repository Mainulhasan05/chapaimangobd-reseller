'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareWarning } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Complaint, Order } from '@/lib/types';
import { Alert, Card, CardHeader } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { OrderPage, primeOrder } from '@/components/order-page';
import { AcceptOrderModal } from '@/components/accept-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';
import { ShipModal } from '@/components/ship-order-modal';
import { ReturnOrderModal } from '@/components/return-order-modal';
import { DeliveryChargeModal } from '@/components/delivery-charge-field';
import { ComplaintModal } from '@/components/complaint-modal';
import { ComplaintList } from '@/components/complaints-panel';

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
  const [complaining, setComplaining] = useState<Order | null>(null);

  /*
   * What was said about this order. Its own query rather than a field on the
   * order, because a complaint is not part of the order: it does not change its
   * status, it does not move money, and the reseller never sees it.
   */
  const complaints = useQuery({
    queryKey: ['complaints', 'order', id],
    queryFn: () => api.get<{ complaints: Complaint[] }>(`/owner/orders/${id}/complaints`),
  });

  const transition = useMutation({
    mutationFn: ({ action }: { action: string }) =>
      api.post<{ order: Order }>(`/owner/orders/${id}/${action}`, {}),
    onSuccess: async (data) => {
      primeOrder(queryClient, 'owner', data.order);
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
        /*
         * Complaints under the order, on the owner's copy only. This is the
         * screen somebody lands on when a customer rings about a bad parcel,
         * so it is where it has to be possible to write that down — and where
         * the orchard behind each line is already named.
         */
        below={(order) => (
          <Card>
            <CardHeader
              title={t('complaint.title')}
              subtitle={t('complaint.addHint')}
              action={
                <Button variant="outline" size="sm" onClick={() => setComplaining(order)}>
                  <MessageSquareWarning className="h-4 w-4" />
                  {t('complaint.add')}
                </Button>
              }
            />
            {complaints.isLoading && <ListSkeleton rows={2} />}
            {complaints.isSuccess && <ComplaintList complaints={complaints.data.complaints} />}
          </Card>
        )}
      />

      <AcceptOrderModal order={accepting} onClose={() => setAccepting(null)} />
      <CancelOrderModal order={cancelling} scope="owner" onClose={() => setCancelling(null)} />
      <ShipModal order={shipping} onClose={() => setShipping(null)} />
      <ReturnOrderModal order={returning} onClose={() => setReturning(null)} />
      <DeliveryChargeModal order={editingCharge} onClose={() => setEditingCharge(null)} />
      <ComplaintModal order={complaining} onClose={() => setComplaining(null)} />
    </>
  );
}
