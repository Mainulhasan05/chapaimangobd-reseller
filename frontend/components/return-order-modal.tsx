'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { useReturnOrderMutation } from '@/lib/store/endpoints/orders';
import type { Order } from '@/lib/types';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FormErrorSummary, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { ReasonChips } from '@/components/cancel-order-modal';

const RETURN_PRESETS = [
  'orders.returnPreset.refused',
  'orders.returnPreset.unreachable',
  'orders.returnPreset.damaged',
  'orders.returnPreset.late',
] as const;

/**
 * The owner records that a shipped parcel came back. Mount only while open.
 *
 * A return is whole-order and posts reversals, so it asks before it acts, the
 * same way cancelling does, and it asks why: "returned" with no reason is the
 * one record nobody can learn from when the same courier keeps losing parcels.
 * The other real decision is stock: mangoes that have spent days with a courier
 * are usually not fit to sell again, so "put back in stock" starts off and only
 * the owner, looking at the crate, turns it on. See docs/adr/0008.
 */
export function ReturnOrderModal({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone?: (order: Order) => void;
}) {
  const [markReturned] = useReturnOrderMutation();
  const [preset, setPreset] = useState('');
  const [detail, setDetail] = useState('');
  const [restock, setRestock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const presets = RETURN_PRESETS.map((key) => t(key));
  const reason = [preset, detail.trim()].filter(Boolean).join(' — ');
  const reasonMissing = reason.length < 3;

  const submit = async () => {
    setTried(true);
    if (reasonMissing) return;
    setBusy(true);
    setError(null);
    try {
      const { order: returned } = await markReturned({ id: order.id, restock, reason }).unwrap();
      onClose();
      onDone?.(returned);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`${t('order.returnTitle')} · ${order.orderCode}`}
      dirty={reason.length > 0 || restock}
      footerLead={error ? <FormErrorSummary message={error} /> : undefined}
      footer={
        <>
          <ModalCancel label={t('app.dismiss')} disabled={busy} />
          <Button variant="danger" loading={busy} onClick={submit}>
            {t('orders.markReturned')}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">{t('order.returnHelp')}</p>

      <Field
        label={t('order.returnReason')}
        htmlFor="return-detail"
        required
        error={tried && reasonMissing ? t('orders.reasonPick') : undefined}
      >
        <ReasonChips presets={presets} value={preset} onPick={setPreset} label={t('order.returnReason')} />
        <Textarea
          id="return-detail"
          value={detail}
          maxLength={400}
          rows={2}
          invalid={tried && reasonMissing}
          placeholder={t('orders.reasonDetail')}
          onChange={(e) => setDetail(e.target.value)}
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
