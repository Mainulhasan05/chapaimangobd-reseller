'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import type { Order, PaymentMode } from '@/lib/types';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Field, MoneyInput, Input, Select } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';

type Draft = { product: string; quantity: string; sellPrice: string };

/**
 * Confirming is the moment money moves, so the screen shows the three numbers
 * that matter before the reseller commits: what the customer pays, what leaves
 * the wallet, and what is left over as profit.
 *
 * The wallet figure is computed here for reassurance only. The server recomputes
 * every total from live catalog data and ignores anything the client sends.
 */
export function ConfirmOrderModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  if (!order) return null;
  // Keyed so opening a different order mounts a fresh form. Seeding the drafts
  // from props inside an effect instead would cascade an extra render on open.
  return <ConfirmForm key={order.id} order={order} onClose={onClose} />;
}

function ConfirmForm({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    order.items.map((item) => ({
      product: item.product,
      quantity: String(item.quantity),
      // Latin digits: this value is parsed back on submit.
      sellPrice: formatMoneyPlain(item.sellPrice),
    }))
  );
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(order.paymentMode);

  const confirm = useMutation({
    mutationFn: () =>
      api.post(`/reseller/orders/${order.id}/confirm`, {
        paymentMode,
        items: drafts.map((d) => ({
          product: d.product,
          quantity: Number(d.quantity),
          sellPrice: Number(d.sellPrice),
        })),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      onClose();
      // The sheet closing is not, by itself, a confirmation that money moved.
      toast(t('order.confirmedToast'));
    },
  });

  const errors = fieldErrors(confirm.error);
  const generalError =
    confirm.error instanceof ApiError && !confirm.error.fields ? confirm.error.message : null;

  // Cost prices are snapshots on the order, so this preview matches the server.
  const costSubtotal = order.items.reduce((sum, item, index) => {
    const qty = Number(drafts[index]?.quantity ?? item.quantity) || 0;
    return sum + item.costPrice * qty;
  }, 0);

  const sellSubtotal = drafts.reduce((sum, draft) => {
    return sum + (Number(draft.sellPrice) || 0) * (Number(draft.quantity) || 0);
  }, 0);

  const walletDebit = costSubtotal + order.deliveryCharge;
  const customerTotal = sellSubtotal + order.deliveryCharge;
  const profit = sellSubtotal - costSubtotal;

  const update = (index: number, key: keyof Draft, value: string) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, [key]: value } : d)));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${t('order.confirmOrder')} · ${order.orderCode}`}
      /*
       * This is the moment money moves, so the numbers behind the decision are
       * pinned above the button rather than left at the end of the scroll. On a
       * phone the wallet debit was previously never on screen with Confirm.
       */
      footerLead={
        <dl className="space-y-1 rounded-lg bg-muted p-3 text-sm">
          <Row label={t('order.customerTotal')} value={formatMoney(customerTotal)} strong />
          <Row label={t('order.walletDebit')} value={formatMoney(walletDebit)} tone="danger" />
          <Row label={t('order.yourProfit')} value={formatMoney(profit)} tone="success" strong />
        </dl>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button onClick={() => confirm.mutate()} loading={confirm.isPending}>
            {t('app.confirm')}
          </Button>
        </>
      }
    >
      {generalError && <Alert tone="danger">{generalError}</Alert>}

      <div className="mb-4 rounded-lg bg-muted p-3 text-sm">
        <p className="font-medium">{order.customer.name}</p>
        <p className="tabular text-muted-foreground">{order.customer.phoneE164}</p>
        <p className="text-muted-foreground">
          {order.customer.address}, {order.customer.district}
        </p>
        {order.customer.note && <p className="mt-1 text-muted-foreground">{order.customer.note}</p>}
      </div>

      <Field label={t('order.paymentMode')} htmlFor="paymentMode">
        <Select
          id="paymentMode"
          value={paymentMode}
          onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
        >
          <option value="prepaid">{t('order.prepaid')}</option>
          <option value="cod">{t('order.cod')}</option>
        </Select>
      </Field>

      <div className="mb-4 flex justify-between rounded-lg bg-muted p-3 text-sm">
        <span className="text-muted-foreground">{t('order.deliveryCharge')}</span>
        <span className="tabular">{formatMoney(order.deliveryCharge)}</span>
      </div>

      <div className="mb-4 space-y-3">
        {order.items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="font-medium">{item.productName}</p>
              <p className="text-xs text-muted-foreground">
                {t('catalog.costPrice')} {formatMoney(item.costPrice)} / {tUnit(item.unit)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={`${t('order.quantity')} (${tUnit(item.unit)})`}
                htmlFor={`qty-${index}`}
                hint={`${t('catalog.minOrderQty')} ${formatNumber(item.quantity)}`}
                error={errors[`items.${index}.quantity`]}
                className="mb-0"
              >
                <Input
                  id={`qty-${index}`}
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  min="0"
                  className="tabular"
                  value={drafts[index]?.quantity ?? ''}
                  onChange={(e) => update(index, 'quantity', e.target.value)}
                />
              </Field>

              <Field
                label={t('catalog.sellPrice')}
                htmlFor={`price-${index}`}
                hint={t('catalog.priceFloorHelp')}
                error={errors[`items.${index}.sellPrice`]}
                className="mb-0"
              >
                <MoneyInput
                  id={`price-${index}`}
                  value={drafts[index]?.sellPrice ?? ''}
                  onChange={(e) => update(index, 'sellPrice', e.target.value)}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t('order.confirmHelp')}</p>
    </Modal>
  );
}

function Row({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'success';
  strong?: boolean;
}) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : '';
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular ${strong ? 'font-semibold' : ''} ${color}`}>{value}</dd>
    </div>
  );
}
