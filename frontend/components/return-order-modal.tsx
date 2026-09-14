'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Order } from '@/lib/types';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';
import { Switch } from '@/components/ui/switch';

/**
 * The owner records that a shipped parcel came back.
 *
 * A return is whole-order and posts reversals, so it asks before it acts, the
 * same way cancelling does. The one real decision is stock: mangoes that have
 * spent days with a courier are usually not fit to sell again, so "put back in
 * stock" starts off and only the owner, looking at the crate, turns it on. The
 * API records the choice on the order and in the audit log. See docs/adr/0008.
 */
export function ReturnOrderModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);

  const reset = () => {
    setReason('');
    setRestock(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const markReturned = useMutation({
    mutationFn: () =>
      api.post(`/owner/orders/${order!.id}/return`, {
        restock,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      close();
      toast(t('order.returnedToast'));
    },
  });

  if (!order) return null;

  return (
    <Modal
      open
      onClose={close}
      title={`${t('order.returnTitle')} · ${order.orderCode}`}
      dirty={reason.trim().length > 0 || restock}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {t('app.close')}
          </Button>
          <Button
            variant="danger"
            loading={markReturned.isPending}
            onClick={() => markReturned.mutate()}
          >
            {t('order.return')}
          </Button>
        </>
      }
    >
      {markReturned.error && <Alert tone="danger">{errorMessage(markReturned.error)}</Alert>}

      <p className="mb-4 text-sm text-muted-foreground">{t('order.returnHelp')}</p>

      <Field label={t('order.returnReason')} htmlFor="return-reason" hint={t('app.optional')}>
        <Textarea
          id="return-reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
        />
      </Field>

      <div className="rounded-xl bg-muted/60 px-3">
        <Switch
          checked={restock}
          onChange={setRestock}
          label={t('order.restock')}
          hint={t('order.restockHint')}
        />
      </div>
    </Modal>
  );
}
