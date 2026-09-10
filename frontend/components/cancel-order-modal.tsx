'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Order } from '@/lib/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';

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
  const [reason, setReason] = useState('');

  const cancel = useMutation({
    mutationFn: () => api.post(`/${scope}/orders/${order!.id}/cancel`, { reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setReason('');
      onClose();
    },
  });

  if (!order) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('order.cancelOrder')} · ${order.orderCode}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.close')}
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            disabled={reason.trim().length < 3}
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
          autoFocus
        />
      </Field>
    </Modal>
  );
}
