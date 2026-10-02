'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import {
  useEditCourierMutation,
  useGetRecentCouriersQuery,
  useShipOrderMutation,
} from '@/lib/store/endpoints/orders';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, FormErrorSummary, Input } from '@/components/ui/form';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { DeliveryChargeField, useDeliveryCharge } from '@/components/delivery-charge-field';
import { CustomerSmsField, useCustomerSms } from '@/components/customer-sms-field';

/** The API's floor for a courier name. */
const MIN_COURIER = 2;

/**
 * The couriers written on recent parcels, most recent first.
 *
 * A blank box on every one of fifty parcels a day meant typing "Steadfast"
 * fifty times, with fifty chances of a spelling that later splits one courier
 * into two in every report. The first one is the default, because the courier
 * used for the last parcel is almost always the one used for this one.
 */
function useRecentCouriers() {
  const recent = useGetRecentCouriersQuery();
  return recent.data?.couriers ?? [];
}

/**
 * The courier name, typed or picked. A datalist offers the recent names as the
 * keyboard opens, and the chips under it do the same in one tap without it.
 */
function CourierField({
  value,
  onChange,
  couriers,
  error,
  id = 'courierName',
}: {
  value: string;
  onChange: (value: string) => void;
  couriers: string[];
  error?: string;
  id?: string;
}) {
  return (
    <Field label={t('order.courier')} htmlFor={id} required error={error}>
      <Input
        id={id}
        list={`${id}-recent`}
        autoComplete="off"
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={`${id}-recent`}>
        {couriers.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {couriers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t('orders.recentCouriers')}>
          {couriers.slice(0, 4).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              aria-pressed={value.trim() === name}
              className={cn(
                'min-h-11 rounded-full border px-3 text-sm transition-colors sm:min-h-9',
                value.trim() === name
                  ? 'border-primary bg-primary-softer font-semibold text-primary-ink'
                  : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

/**
 * The owner hands an order to a courier. Shared by the orders list and the
 * order page, and mounted only while open, so a tracking number typed for one
 * parcel can never be sent for the next.
 */
export function ShipModal({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone?: (order: Order) => void;
}) {
  const [ship] = useShipOrderMutation();
  const couriers = useRecentCouriers();
  // Null until typed, so the most recent courier fills in once the list arrives.
  const [typed, setTyped] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const courierName = typed ?? couriers[0] ?? '';

  // Ship is the last moment the charge can change: once shipped it is locked.
  const charge = useDeliveryCharge(order);

  // Re-previewed as the courier and tracking number are typed, because both are in the text.
  const sms = useCustomerSms(order, 'ship', { courier: courierName, trackingId: trackingNumber });

  const courierError =
    tried && courierName.trim().length < MIN_COURIER ? t('orders.courierRequired') : undefined;

  const submit = async () => {
    setTried(true);
    if (courierName.trim().length < MIN_COURIER || !charge.check.ok || !sms.ready) return;
    setBusy(true);
    setError(null);
    try {
      // Before the transition, because after it the API refuses the change.
      await charge.apply();
      const { order: shipped } = await ship({
        id: order.id,
        courierName: courierName.trim(),
        trackingNumber: trackingNumber.trim() || undefined,
        sendCustomerSms: sms.enabled,
      }).unwrap();
      onClose();
      onDone?.(shipped);
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
      title={`${t('order.ship')} · ${order.orderCode}`}
      dirty={typed !== null || trackingNumber.trim().length > 0 || charge.changed}
      footerLead={
        error ? (
          <FormErrorSummary message={error} />
        ) : !sms.ready ? (
          <p className="text-xs text-muted-foreground">{t('orders.smsPreparing')}</p>
        ) : undefined
      }
      footer={
        <>
          <ModalCancel disabled={busy} />
          <Button loading={busy || !sms.ready} onClick={submit}>
            {t('order.ship')}
          </Button>
        </>
      }
    >
      <CourierField value={courierName} onChange={setTyped} couriers={couriers} error={courierError} />

      <Field label={t('order.trackingNumber')} htmlFor="trackingNumber" hint={t('app.optional')}>
        <Input
          id="trackingNumber"
          className="tabular"
          autoComplete="off"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
        />
      </Field>

      <DeliveryChargeField order={order} state={charge} id="ship-delivery-charge" className="mb-0" />

      <CustomerSmsField state={sms} />
    </Modal>
  );
}

/**
 * Correcting the courier or tracking number of a parcel already out. Shipped
 * only: a wrong tracking number is found when the customer rings asking where
 * the parcel is, which is after it left.
 */
export function CourierEditModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [edit] = useEditCourierMutation();
  const couriers = useRecentCouriers();
  const [courierName, setCourierName] = useState(order.courier?.name ?? '');
  const [trackingNumber, setTrackingNumber] = useState(order.courier?.trackingNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const nameChanged = courierName.trim() !== (order.courier?.name ?? '');
  const trackingChanged = trackingNumber.trim() !== (order.courier?.trackingNumber ?? '');
  const courierError =
    tried && courierName.trim().length < MIN_COURIER ? t('orders.courierRequired') : undefined;

  const submit = async () => {
    setTried(true);
    if (courierName.trim().length < MIN_COURIER) return;
    if (!nameChanged && !trackingChanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await edit({
        id: order.id,
        ...(nameChanged ? { courierName: courierName.trim() } : {}),
        ...(trackingChanged ? { trackingNumber: trackingNumber.trim() } : {}),
      }).unwrap();
      onClose();
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
      title={`${t('orders.courierEdit')} · ${order.orderCode}`}
      dirty={nameChanged || trackingChanged}
      footerLead={error ? <FormErrorSummary message={error} /> : undefined}
      footer={
        <>
          <ModalCancel disabled={busy} />
          <Button loading={busy} onClick={submit}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <CourierField
        id="edit-courier"
        value={courierName}
        onChange={setCourierName}
        couriers={couriers}
        error={courierError}
      />
      <Field label={t('order.trackingNumber')} htmlFor="edit-tracking" hint={t('orders.trackingClearHint')}>
        <Input
          id="edit-tracking"
          className="tabular"
          autoComplete="off"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

/**
 * Shipping several packed orders with one courier. Collects the courier and
 * hands it back; the list runs the orders one at a time and shows the progress.
 * Tracking numbers differ per parcel, so they are left for the order page.
 */
export function BulkShipModal({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (courierName: string) => void;
}) {
  const couriers = useRecentCouriers();
  const [typed, setTyped] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const courierName = typed ?? couriers[0] ?? '';
  const courierError =
    tried && courierName.trim().length < MIN_COURIER ? t('orders.courierRequired') : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={tf('orders.bulkShipTitle', { count: formatNumber(count) })}
      dirty={typed !== null}
      footer={
        <>
          <ModalCancel />
          <Button
            onClick={() => {
              setTried(true);
              if (courierName.trim().length < MIN_COURIER) return;
              onConfirm(courierName.trim());
            }}
          >
            {tf('orders.bulkShipConfirm', { count: formatNumber(count) })}
          </Button>
        </>
      }
    >
      <CourierField id="bulk-courier" value={courierName} onChange={setTyped} couriers={couriers} error={courierError} />
      <p className="text-xs text-muted-foreground">{t('orders.bulkShipHint')}</p>
    </Modal>
  );
}
