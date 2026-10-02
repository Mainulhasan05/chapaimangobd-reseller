'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatSignedMoney } from '@/lib/format';
import { checkMoney, moneyError, type MoneyCheck } from '@/lib/money';
import { useChangeDeliveryChargeMutation } from '@/lib/store/endpoints/orders';
import type { DeliveryChargeChange, Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Field, MoneyInput } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

/**
 * Whether the owner may still change the delivery charge.
 *
 * Read from the order's `actions`, which the API derives from
 * `DELIVERY_CHARGE_EDITABLE` in its state machine. The server stays the
 * authority and answers 409 DELIVERY_CHARGE_LOCKED if the order moved on
 * since this copy was fetched.
 */
export const canEditDeliveryCharge = (order: Order): boolean =>
  Boolean(order.actions?.includes('changeDeliveryCharge'));

/** Pending never debited the wallet; every later status did. See docs/adr/0010. */
const isCharged = (order: Order): boolean => order.status !== 'pending';

/** Compared in poisha, so 80 and 80.00 are the same charge. */
const toPoisha = (taka: number): number => Math.round(taka * 100);

export type DeliveryChargeState = {
  value: string;
  setValue: (value: string) => void;
  check: MoneyCheck;
  /** Valid and different from what the order carries now. */
  changed: boolean;
  /** What the wallet adjustment will be, signed taka, or null when none posts. */
  adjustment: number | null;
  /**
   * Sends the change if there is one. Resolves to null when there was nothing to
   * send. `bulk` leaves the refresh to the transition sent straight after it
   * (`chargeChanged`), so accepting with a new charge is one refresh, not two.
   */
  apply: (options?: { bulk?: boolean }) => Promise<DeliveryChargeChange | null>;
  reset: () => void;
};

/**
 * The delivery charge as an editable value, for one order.
 *
 * Shared by the accept and ship sheets and the order page, each of which is
 * mounted only while open, so a figure typed for one parcel is never offered,
 * prefilled, for the next. The draft is still keyed by order id, because the
 * order under an open sheet can be refetched with a new charge from elsewhere.
 */
export function useDeliveryCharge(order: Order | null): DeliveryChargeState {
  const [draft, setDraft] = useState<{ orderId: string; value: string } | null>(null);
  const [change] = useChangeDeliveryChargeMutation();

  const current = order ? formatMoneyPlain(order.deliveryCharge) : '';
  const value = order && draft?.orderId === order.id ? draft.value : current;
  const check = checkMoney(value, { allowZero: true });

  const changed =
    Boolean(order) && check.ok && toPoisha(check.value) !== toPoisha(order!.deliveryCharge);

  // The wallet moves by the opposite of the charge: a raise is a debit.
  const adjustment =
    order && changed && check.ok && isCharged(order)
      ? (toPoisha(order.deliveryCharge) - toPoisha(check.value)) / 100
      : null;

  return {
    value,
    setValue: (next) => order && setDraft({ orderId: order.id, value: next }),
    check,
    changed,
    adjustment,
    apply: async (options) => {
      if (!order || !changed || !check.ok) return null;
      return change({ id: order.id, deliveryCharge: check.value, bulk: options?.bulk }).unwrap();
    },
    reset: () => setDraft(null),
  };
}

/**
 * The field itself, with the consequence spelled out under it.
 *
 * Changing the charge on a confirmed order does not rewrite the original debit;
 * it posts a separate adjustment to the reseller's wallet. That is worth saying
 * before the button is pressed, not discovered afterwards in a statement.
 *
 * The hint says whose money this is. It read "change it once you know the
 * courier's real cost", which invited typing the courier's bill here; but this
 * is what the reseller is billed, and what the courier is paid is an expense on
 * the order (CONTEXT.md: courier cost is never the delivery charge).
 */
export function DeliveryChargeField({
  order,
  state,
  id = 'deliveryCharge',
  className,
}: {
  order: Order;
  state: DeliveryChargeState;
  id?: string;
  className?: string;
}) {
  return (
    <>
      <Field
        label={t('order.deliveryCharge')}
        htmlFor={id}
        hint={t('orders.deliveryChargeHint').replace('{amount}', formatMoney(order.deliveryCharge))}
        error={moneyError(state.value, { allowZero: true })}
        className={state.adjustment != null ? 'mb-2' : 'mb-1'}
      >
        <MoneyInput
          id={id}
          value={state.value}
          onChange={(event) => state.setValue(event.target.value)}
        />
      </Field>

      {/* Words, not a link: following one from inside a sheet would drop what was typed. */}
      <p
        className={cn(
          'text-xs text-muted-foreground',
          state.adjustment != null ? 'mb-2' : (className ?? 'mb-4')
        )}
      >
        {t('orders.courierCostHint')}
      </p>

      {state.adjustment != null && (
        <p className={cn('mb-4 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink', className)}>
          {t('order.deliveryAdjustNotice').replace('{amount}', formatSignedMoney(state.adjustment))}
        </p>
      )}
    </>
  );
}

/**
 * Changing the charge on its own, from the order page. Mount only while open.
 *
 * The toast names the adjustment that actually posted, from the API's answer
 * rather than from the estimate under the field: if a second tab changed the
 * charge in between, the figure the reseller's wallet moved by is the true one.
 */
export function DeliveryChargeModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const toast = useToast();
  const charge = useDeliveryCharge(order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const save = async () => {
    setTried(true);
    if (!charge.changed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await charge.apply();
      onClose();
      toast(
        result?.adjustment
          ? t('order.deliveryAdjustPosted').replace(
              '{amount}',
              formatSignedMoney(result.adjustment.amount)
            )
          : t('order.deliveryChargeSaved')
      );
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
      title={`${t('order.deliveryChargeEdit')} · ${order.orderCode}`}
      dirty={charge.changed}
      footerLead={
        error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
            {error}
          </p>
        ) : tried && !charge.changed && charge.check.ok ? (
          <p className="text-xs text-muted-foreground">{t('orders.chargeUnchanged')}</p>
        ) : undefined
      }
      footer={
        <>
          <ModalCancel disabled={busy} />
          <Button loading={busy} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <DeliveryChargeField order={order} state={charge} id="edit-delivery-charge" className="mb-0" />
    </Modal>
  );
}
