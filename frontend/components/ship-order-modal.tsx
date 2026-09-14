'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Order } from '@/lib/types';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { DeliveryChargeField, useDeliveryCharge } from '@/components/delivery-charge-field';

/** The owner hands an order to a courier. Shared by the orders list and the order page. */
export function ShipModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [courierName, setCourierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  // Ship is the last moment the charge can change: once shipped it is locked.
  const charge = useDeliveryCharge(order);

  const ship = useMutation({
    mutationFn: async () => {
      // Before the transition, because after it the API refuses the change.
      await charge.apply();
      return api.post(`/owner/orders/${order!.id}/ship`, { courierName, trackingNumber });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setCourierName('');
      setTrackingNumber('');
      charge.reset();
      onClose();
      toast(t('order.shippedToast'));
    },
    // A failure after the charge went through still changed the order.
    onError: () => queryClient.invalidateQueries({ queryKey: ['owner'] }),
  });

  if (!order) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('order.ship')} · ${order.orderCode}`}
      dirty={courierName.trim().length > 0 || trackingNumber.trim().length > 0 || charge.changed}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={ship.isPending}
            disabled={courierName.trim().length < 2 || !charge.check.ok}
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
      >
        <Input
          id="trackingNumber"
          className="tabular"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
        />
      </Field>

      <DeliveryChargeField order={order} state={charge} id="ship-delivery-charge" className="mb-0" />
    </Modal>
  );
}
