'use client';

import { useRef, useState } from 'react';
import { ApiError, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { districtLabel } from '@/lib/districts';
import { formatMoney, formatMoneyPlain } from '@/lib/format';
import { useConfirmResellerOrderMutation } from '@/lib/store/endpoints/reseller';
import type { Order, PaymentMode } from '@/lib/types';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Field,
  FormErrorSummary,
  Input,
  MoneyInput,
  Select,
  focusFirstInvalid,
} from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';

/** One line being corrected: which box, how many, and at what price. */
type Draft = { product: string; variant: string | null; quantity: string; sellPrice: string };

/**
 * Confirming is the moment money moves, so the screen shows the three numbers
 * that matter before the reseller commits: what the customer pays, what leaves
 * the wallet, and what is left over as profit.
 *
 * The wallet figure and the profit are estimates from the prices snapshotted on
 * the order. The server reprices the confirm from the live catalog and ignores
 * any total the client sends, so both are labelled "আনুমানিক" and say why.
 */
export function ConfirmOrderModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  if (!order) return null;
  // Keyed so opening a different order mounts a fresh form. Seeding the drafts
  // from props inside an effect instead would cascade an extra render on open.
  return <ConfirmForm key={order.id} order={order} onClose={onClose} />;
}

/**
 * What is wrong with one line, before the server is asked.
 *
 * A count of boxes is a whole number of at least one (the field used to step
 * by a quarter and was labelled in kilos); a price below the cost price is
 * refused by the server anyway, so it is said here, next to the price.
 */
function lineErrors(draft: Draft, costPrice: number): { quantity?: string; sellPrice?: string } {
  const quantity = Number(draft.quantity);
  const price = Number(draft.sellPrice);
  return {
    quantity:
      draft.quantity.trim() === '' || !Number.isInteger(quantity) || quantity < 1
        ? t('orders.boxesWhole')
        : undefined,
    sellPrice:
      draft.sellPrice.trim() === '' || !Number.isFinite(price)
        ? t('orders.priceRequired')
        : price < costPrice
          ? t('catalog.priceFloorHelp')
          : undefined,
  };
}

function ConfirmForm({ order, onClose }: { order: Order; onClose: () => void }) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [confirm, confirmState] = useConfirmResellerOrderMutation();
  const [tried, setTried] = useState(false);

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    order.items.map((item) => ({
      product: item.product,
      // Which box this correction is for. A line is a box. docs/adr/0021.
      variant: item.variant,
      // A count of boxes, not a weight.
      quantity: String(item.boxes ?? item.quantity),
      // Latin digits: this value is parsed back on submit.
      sellPrice: formatMoneyPlain(item.sellPrice),
    }))
  );
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(order.paymentMode);
  // While a field has the keyboard up, the pinned totals shrink to one line so
  // the field being typed in is not squeezed out of a 360px screen.
  const [typing, setTyping] = useState(false);

  // Anything changed from the order as placed is worth asking about before a
  // swipe or a tap on the backdrop throws it away.
  const dirty =
    paymentMode !== order.paymentMode ||
    drafts.some(
      (draft, index) =>
        draft.quantity !== String(order.items[index].boxes ?? order.items[index].quantity) ||
        draft.sellPrice !== formatMoneyPlain(order.items[index].sellPrice)
    );

  const serverErrors = fieldErrors(confirmState.error);
  const generalError =
    confirmState.error instanceof ApiError && !confirmState.error.fields
      ? confirmState.error.message
      : null;

  const checks = order.items.map((item, index) => lineErrors(drafts[index], item.costPrice));
  const problemCount = checks.reduce(
    (sum, check) => sum + (check.quantity ? 1 : 0) + (check.sellPrice ? 1 : 0),
    0
  );

  // Cost prices per box as snapshotted on the order; the confirm reprices from the live catalog.
  const costSubtotal = order.items.reduce((sum, item, index) => {
    const boxes = Number(drafts[index]?.quantity) || 0;
    return sum + item.costPrice * boxes;
  }, 0);

  const sellSubtotal = drafts.reduce((sum, draft) => {
    return sum + (Number(draft.sellPrice) || 0) * (Number(draft.quantity) || 0);
  }, 0);

  const walletDebit = costSubtotal + order.deliveryCharge;
  const customerTotal = sellSubtotal + order.deliveryCharge;
  const profit = sellSubtotal - costSubtotal;

  const update = (index: number, key: keyof Draft, value: string) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, [key]: value } : d)));

  const submit = async () => {
    setTried(true);
    if (problemCount > 0) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    try {
      await confirm({
        id: order.id,
        paymentMode,
        items: drafts.map((d) => ({
          product: d.product,
          variant: d.variant,
          quantity: Number(d.quantity),
          sellPrice: Number(d.sellPrice),
        })),
      }).unwrap();
      onClose();
      // The sheet closing is not, by itself, a confirmation that money moved.
      toast(`${order.orderCode} · ${t('order.confirmedToast')}`);
    } catch {
      // Shown in the sheet, beside the field or above the buttons.
    }
  };

  return (
    <Modal
      open
      wide
      onClose={confirmState.isLoading ? () => {} : onClose}
      title={`${t('order.confirmOrder')} · ${order.orderCode}`}
      dirty={dirty}
      /*
       * This is the moment money moves, so the numbers behind the decision are
       * pinned above the button rather than left at the end of the scroll. On a
       * phone the wallet debit was previously never on screen with Confirm.
       */
      footerLead={
        <>
          {tried && problemCount > 0 && <FormErrorSummary message={t('app.fixFields')} />}
          {typing ? (
            <p className="tabular flex justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
              <span>
                {t('order.customerTotal')} {formatMoney(customerTotal)}
              </span>
              <span className={profit < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>
                {t('order.yourProfit')} {formatMoney(profit)}
              </span>
            </p>
          ) : (
            <dl className="space-y-1 rounded-lg bg-muted p-3 text-sm">
              <Row label={t('order.customerTotal')} value={formatMoney(customerTotal)} strong />
              <Row
                label={`${t('order.walletDebit')} (${t('orders.estimate')})`}
                value={formatMoney(walletDebit)}
                tone="danger"
              />
              <Row
                label={`${t('order.yourProfit')} (${t('orders.estimate')})`}
                value={formatMoney(profit)}
                tone={profit < 0 ? 'danger' : 'success'}
                strong
              />
            </dl>
          )}
        </>
      }
      footer={
        <>
          <ModalCancel disabled={confirmState.isLoading} />
          <Button onClick={submit} loading={confirmState.isLoading}>
            {t('app.confirm')}
          </Button>
        </>
      }
    >
      <div
        ref={bodyRef}
        onFocusCapture={(event) => setTyping(event.target instanceof HTMLInputElement)}
        onBlurCapture={() => setTyping(false)}
      >
        {generalError && <Alert tone="danger">{generalError}</Alert>}
        {/* A loss is allowed only if somebody means it; it should never be a typo. */}
        {profit < 0 && <Alert tone="warning">{t('orders.negativeProfit')}</Alert>}

        <div className="mb-4 rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">{order.customer.name}</p>
          <p className="tabular text-muted-foreground">{order.customer.phoneE164}</p>
          <p className="text-muted-foreground">
            {order.customer.address}, {districtLabel(order.customer.district)}
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
          {order.items.map((item, index) => {
            const check = checks[index];
            const quantityError =
              serverErrors[`items.${index}.quantity`] ?? (tried ? check.quantity : undefined);
            const priceError =
              serverErrors[`items.${index}.sellPrice`] ??
              (tried || drafts[index].sellPrice !== formatMoneyPlain(item.sellPrice)
                ? check.sellPrice
                : undefined);
            return (
              <div key={item.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="font-medium">
                    {item.productName}
                    {item.variantLabel && (
                      <span className="font-normal text-muted-foreground"> · {item.variantLabel}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('catalog.costPrice')} {formatMoney(item.costPrice)} / {t('orders.box')}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t('order.boxes')}
                    htmlFor={`qty-${index}`}
                    hint={item.variantLabel ?? undefined}
                    error={quantityError}
                    className="mb-0"
                  >
                    <Input
                      id={`qty-${index}`}
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="1"
                      className="tabular"
                      invalid={Boolean(quantityError)}
                      value={drafts[index]?.quantity ?? ''}
                      onChange={(e) => update(index, 'quantity', e.target.value)}
                    />
                  </Field>

                  <Field
                    label={`${t('catalog.sellPrice')} / ${t('orders.box')}`}
                    htmlFor={`price-${index}`}
                    hint={t('catalog.priceFloorHelp')}
                    error={priceError}
                    className="mb-0"
                  >
                    <MoneyInput
                      id={`price-${index}`}
                      invalid={Boolean(priceError)}
                      value={drafts[index]?.sellPrice ?? ''}
                      onChange={(e) => update(index, 'sellPrice', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">{t('order.confirmHelp')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('orders.confirmEstimateHint')}</p>
      </div>
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
