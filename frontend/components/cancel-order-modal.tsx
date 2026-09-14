'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Order } from '@/lib/types';
import { primeOrder } from '@/components/order-page';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';
import { CustomerSmsField, useCustomerSms } from '@/components/customer-sms-field';

/**
 * A reason is required rather than optional. Cancelling a confirmed order posts
 * reversal entries, and the ledger note is what makes the reversal explicable
 * months later.
 */
export function CancelOrderModal({
  order,
  scope,
  onClose,
}: {
  order: Order | null;
  scope: 'reseller' | 'owner';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');

  // Only the owner may message the customer. The hook still runs for the
  // reseller, with no order, so hooks keep one order; it fetches nothing then.
  const sms = useCustomerSms(scope === 'owner' ? order : null, 'cancel', { reason });

  const cancel = useMutation({
    mutationFn: () =>
      api.post<{ order: Order }>(`/${scope}/orders/${order!.id}/cancel`, {
        reason,
        ...(scope === 'owner' ? { sendCustomerSms: sms.enabled } : {}),
      }),
    onSuccess: async (data) => {
      primeOrder(queryClient, scope, data.order);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setReason('');
      sms.reset();
      onClose();
      // The sheet closing is not, on its own, a confirmation that anything happened.
      toast(t('order.cancelledToast'));
    },
  });

  if (!order) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('order.cancelOrder')} · ${order.orderCode}`}
      dirty={reason.trim().length > 0}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.close')}
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            disabled={reason.trim().length < 3 || !sms.ready}
            onClick={() => cancel.mutate()}
          >
            {t('order.cancelOrder')}
          </Button>
        </>
      }
    >
      {cancel.error && <Alert tone="danger">{errorMessage(cancel.error)}</Alert>}

      <Field label={t('order.cancelReason')} htmlFor="reason" required>
        <Textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </Field>

      {scope === 'owner' && <CustomerSmsField state={sms} />}
    </Modal>
  );
}
