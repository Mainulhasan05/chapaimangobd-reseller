'use client';

import { use, useState } from 'react';
import { t } from '@/lib/i18n/bn';
import type { Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { OrderPage } from '@/components/order-page';
import { ConfirmOrderModal } from '@/components/confirm-order-modal';
import { CancelOrderModal } from '@/components/cancel-order-modal';

/** One order, as its reseller sees it. Addressed by the order id. */
export default function ResellerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a Promise in Next 16; `use` unwraps it in a client component.
  const { id } = use(params);

  const [confirming, setConfirming] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  const actionsFor = (order: Order) => {
    const canConfirm = order.actions.includes('confirm');
    const canCancel = order.actions.includes('cancel');
    if (!canConfirm && !canCancel) return null;

    return (
      <>
        {canConfirm && <Button onClick={() => setConfirming(order)}>{t('app.confirm')}</Button>}
        {canCancel && (
          <Button variant="outline" onClick={() => setCancelling(order)}>
            {t('app.cancel')}
          </Button>
        )}
      </>
    );
  };

  return (
    <>
      <OrderPage scope="reseller" id={id} backHref="/reseller/orders" actions={actionsFor} />

      <ConfirmOrderModal order={confirming} onClose={() => setConfirming(null)} />
      <CancelOrderModal order={cancelling} scope="reseller" onClose={() => setCancelling(null)} />
    </>
  );
}
