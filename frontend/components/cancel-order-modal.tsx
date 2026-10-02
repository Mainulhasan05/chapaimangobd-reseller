'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney } from '@/lib/format';
import { useCancelOrderMutation } from '@/lib/store/endpoints/orders';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FormErrorSummary, Textarea } from '@/components/ui/form';
import { CustomerSmsField, useCustomerSms } from '@/components/customer-sms-field';

/** The reasons an order is called off, one tap each. The text below adds detail. */
export const CANCEL_PRESETS = [
  'orders.cancelPreset.customer',
  'orders.cancelPreset.noAnswer',
  'orders.cancelPreset.stock',
  'orders.cancelPreset.address',
  'orders.cancelPreset.duplicate',
] as const;

/** Reason chips: one tap fills the reason, the text box under them adds to it. */
export function ReasonChips({
  presets,
  value,
  onPick,
  label,
}: {
  presets: readonly string[];
  value: string;
  onPick: (preset: string) => void;
  label: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={label}>
      {presets.map((preset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={value === preset}
          onClick={() => onPick(value === preset ? '' : preset)}
          className={cn(
            'min-h-11 rounded-full border px-3 text-sm transition-colors sm:min-h-9',
            value === preset
              ? 'border-primary bg-primary-softer font-semibold text-primary-ink'
              : 'border-border text-muted-foreground hover:bg-muted'
          )}
        >
          {preset}
        </button>
      ))}
    </div>
  );
}

/**
 * Calling an order off, for the owner or its reseller. Mount only while open.
 *
 * A reason is required. Cancelling a confirmed order posts reversal entries,
 * and the ledger note is what makes the reversal explicable months later. A
 * chip is enough of a reason on its own; the text adds to it.
 *
 * What the cancel undoes is said before the button is pressed: the stock goes
 * back and the reseller's debit is reversed. A pending order never took either,
 * so it says that instead.
 */
export function CancelOrderModal({
  order,
  scope,
  onClose,
  onDone,
}: {
  order: Order;
  scope: 'reseller' | 'owner';
  onClose: () => void;
  onDone?: (order: Order) => void;
}) {
  const [cancel] = useCancelOrderMutation();
  const [preset, setPreset] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const presets = CANCEL_PRESETS.map((key) => t(key));
  const reason = [preset, detail.trim()].filter(Boolean).join(' — ');
  const reasonMissing = reason.length < 3;

  // Only the owner may message the customer. The hook still runs for the
  // reseller, with no order, so hooks keep one order; it fetches nothing then.
  const sms = useCustomerSms(scope === 'owner' ? order : null, 'cancel', { reason });

  const committed = order.status !== 'pending';
  const consequences = committed
    ? [
        t('orders.cancelStockBack'),
        scope === 'owner'
          ? tf('orders.cancelWalletBack', { amount: formatMoney(order.totals.walletDebit) })
          : tf('orders.cancelWalletBackMine', { amount: formatMoney(order.totals.walletDebit) }),
      ]
    : [t('orders.cancelNothingMoved')];

  const submit = async () => {
    setTried(true);
    if (reasonMissing || sms.preparing) return;
    setBusy(true);
    setError(null);
    try {
      const { order: cancelled } = await cancel({
        role: scope,
        id: order.id,
        reason,
        ...(scope === 'owner' ? { sendCustomerSms: sms.enabled } : {}),
      }).unwrap();
      onClose();
      onDone?.(cancelled);
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
      title={`${t('order.cancelOrder')} · ${order.orderCode}`}
      dirty={reason.length > 0}
      footerLead={
        error ? (
          <FormErrorSummary message={error} />
        ) : sms.preparing ? (
          <p className="text-xs text-muted-foreground">{t('orders.smsPreparing')}</p>
        ) : undefined
      }
      footer={
        <>
          <ModalCancel label={t('app.dismiss')} disabled={busy} />
          <Button variant="danger" loading={busy} disabled={sms.preparing} onClick={submit}>
            {t('order.cancelOrder')}
          </Button>
        </>
      }
    >
      <ul className="mb-4 list-disc space-y-1 rounded-xl bg-muted px-4 py-3 pl-8 text-sm text-muted-foreground">
        {consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <Field
        label={t('order.cancelReason')}
        htmlFor="cancel-detail"
        required
        error={tried && reasonMissing ? t('orders.reasonPick') : undefined}
      >
        <ReasonChips presets={presets} value={preset} onPick={setPreset} label={t('order.cancelReason')} />
        <Textarea
          id="cancel-detail"
          value={detail}
          rows={2}
          maxLength={400}
          invalid={tried && reasonMissing}
          placeholder={t('orders.reasonDetail')}
          onChange={(e) => setDetail(e.target.value)}
        />
      </Field>

      {scope === 'owner' && <CustomerSmsField state={sms} />}
    </Modal>
  );
}
