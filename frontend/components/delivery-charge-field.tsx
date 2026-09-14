'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatSignedMoney } from '@/lib/format';
import { checkMoney, moneyError, type MoneyCheck } from '@/lib/money';
import type { DeliveryChargeChange, Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Field, MoneyInput } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
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
  /** Sends the change if there is one. Resolves to null when there was nothing to send. */
  apply: () => Promise<DeliveryChargeChange | null>;
  reset: () => void;
};

/**
 * The delivery charge as an editable value, for one order.
 *
 * Shared by the accept and ship modals and the order page. The typed value is
 * keyed by order id: the modals stay mounted between orders, and a figure typed
 * for one parcel must never be offered, prefilled, for the next one.
 */
export function useDeliveryCharge(order: Order | null): DeliveryChargeState {
  const [draft, setDraft] = useState<{ orderId: string; value: string } | null>(null);

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
    apply: async () => {
      if (!order || !changed || !check.ok) return null;
      return api.patch<DeliveryChargeChange>(`/owner/orders/${order.id}/delivery-charge`, {
        deliveryCharge: check.value,
      });
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
        hint={t('order.deliveryChargeHint').replace('{amount}', formatMoney(order.deliveryCharge))}
        error={moneyError(state.value, { allowZero: true })}
        className={state.adjustment != null ? 'mb-2' : className}
      >
        <MoneyInput
          id={id}
          value={state.value}
          onChange={(event) => state.setValue(event.target.value)}
        />
      </Field>

      {state.adjustment != null && (
        <p className={cn('mb-4 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink', className)}>
          {t('order.deliveryAdjustNotice').replace('{amount}', formatSignedMoney(state.adjustment))}
        </p>
      )}
    </>
  );
}

/**
 * Changing the charge on its own, from the order page.
 *
 * The toast names the adjustment that actually posted, from the API's answer
 * rather than from the estimate under the field: if a second tab changed the
 * charge in between, the figure the reseller's wallet moved by is the true one.
 */
export function DeliveryChargeModal({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const charge = useDeliveryCharge(order);

  const close = () => {
    charge.reset();
    onClose();
  };

  const save = useMutation({
    mutationFn: () => charge.apply(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      close();
      toast(
        result?.adjustment
          ? t('order.deliveryAdjustPosted').replace(
              '{amount}',
              formatSignedMoney(result.adjustment.amount)
            )
          : t('order.deliveryChargeSaved')
      );
    },
  });

  if (!order) return null;

  return (
    <Modal
      open
      onClose={close}
      title={`${t('order.deliveryChargeEdit')} · ${order.orderCode}`}
      dirty={charge.changed}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!charge.changed}
            onClick={() => save.mutate()}
          >
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <DeliveryChargeField order={order} state={charge} id="edit-delivery-charge" className="mb-0" />
    </Modal>
  );
}
