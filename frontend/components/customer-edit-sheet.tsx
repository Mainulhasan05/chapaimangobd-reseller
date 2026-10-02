'use client';

import { useState } from 'react';
import { MapPinned } from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney } from '@/lib/format';
import { normalizeBdPhoneInput } from '@/lib/phone';
import type { CustomerEditResult, Order } from '@/lib/types';
import { useChangeDeliveryChargeMutation, useEditOrderCustomerMutation } from '@/lib/store/endpoints/orders';
import { useGetDeliveryZonesQuery } from '@/lib/store/endpoints/public';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { DistrictSelect } from '@/components/ui/district-field';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { PhoneField } from '@/components/ui/phone-field';
import { useToast } from '@/components/ui/toast';

type Scope = 'owner' | 'reseller';

type Draft = { name: string; phone: string; address: string; district: string };

const draftFrom = (order: Order): Draft => ({
  name: order.customer.name,
  phone: normalizeBdPhoneInput(order.customer.phoneE164),
  address: order.customer.address,
  district: order.customer.district,
});

/**
 * Correcting where an order goes, for the owner and the reseller alike.
 * PLAN-2 decision 9.
 *
 * Offered only while the order's `actions` carry `editCustomer`, which the API
 * derives from its state machine: until the parcel has left. Only the fields
 * that actually differ are sent, so an untouched field can never overwrite a
 * correction the other side saved a moment earlier.
 *
 * A new district can belong to another delivery zone. The API never changes
 * the charge on its own; it says so and names the zone. The owner gets a
 * one-tap way to apply that zone's charge, through the same endpoint as any
 * other charge change, so the ledger adjustment and the audit entry are the
 * usual ones. A reseller is told the owner may adjust it.
 *
 * The saved order is written into the cache by the endpoints themselves, so
 * the order screen underneath shows it at once without being told.
 */
export function CustomerEditSheet({
  scope,
  order,
  onClose,
  onSaved,
}: {
  scope: Scope;
  order: Order | null;
  onClose: () => void;
  /** Receives the order as the API returned it. Optional: the cache is already updated. */
  onSaved?: (order: Order) => void;
}) {
  if (!order) return null;
  // Keyed so the draft starts from this order's values every time it opens.
  return <CustomerEditForm key={order.id} scope={scope} order={order} onClose={onClose} onSaved={onSaved} />;
}

function CustomerEditForm({
  scope,
  order,
  onClose,
  onSaved,
}: {
  scope: Scope;
  order: Order;
  onClose: () => void;
  onSaved?: (order: Order) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(order));
  // Set once the save went through and moved the order into another zone.
  const [zoneResult, setZoneResult] = useState<CustomerEditResult | null>(null);

  const zones = useGetDeliveryZonesQuery();
  const [editCustomer, save] = useEditOrderCustomerMutation();
  const [changeCharge, applyCharge] = useChangeDeliveryChargeMutation();

  const districts = (zones.data?.zones ?? []).flatMap((zone) =>
    zone.districts.map((district) => ({ district, charge: zone.charge }))
  );
  /*
   * The order's own district stays selected even if its zone has since been
   * switched off: the picker lists all sixty-four and marks the undeliverable
   * ones rather than dropping them, so opening the sheet never silently blanks
   * the field.
   */

  const original = draftFrom(order);
  const changes: Partial<Draft> = {};
  (Object.keys(draft) as (keyof Draft)[]).forEach((key) => {
    const value = key === 'phone' ? draft[key] : draft[key].trim();
    if (value !== original[key]) changes[key] = value;
  });
  const dirty = Object.keys(changes).length > 0;

  const submit = async () => {
    if (!dirty) return;
    try {
      const result = await editCustomer({ role: scope, id: order.id, changes }).unwrap();
      onSaved?.(result.order);
      if (result.deliveryZoneChanged) {
        setZoneResult(result);
        return;
      }
      toast(t('customerEdit.saved'));
      onClose();
    } catch (error) {
      // Field errors land under their boxes; anything else is said here too.
      if (Object.keys(fieldErrors(error)).length === 0) toast(errorMessage(error), 'danger');
    }
  };

  const apply = async (charge: number) => {
    try {
      const result = await changeCharge({ id: order.id, deliveryCharge: charge }).unwrap();
      onSaved?.(result.order);
      toast(tf('customerEdit.chargeApplied', { amount: formatMoney(charge) }));
      onClose();
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  const errors = fieldErrors(save.error);
  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((prev) => ({ ...prev, [key]: event.target.value }));

  /* ---------------------------------------------- after a zone change -- */

  if (zoneResult) {
    const saved = zoneResult.order;
    const suggested = zoneResult.suggestedZone;
    const canApply =
      scope === 'owner' &&
      suggested != null &&
      saved.actions.includes('changeDeliveryCharge') &&
      suggested.charge !== saved.deliveryCharge;

    return (
      <Modal
        open
        onClose={onClose}
        title={`${t('customerEdit.title')} · ${order.orderCode}`}
        footer={
          canApply ? (
            <>
              <ModalCancel label={t('customerEdit.keepCharge')} />
              <Button loading={applyCharge.isLoading} onClick={() => apply(suggested.charge)}>
                {tf('customerEdit.applyCharge', { amount: formatMoney(suggested.charge) })}
              </Button>
            </>
          ) : (
            <Button full onClick={onClose}>
              {t('app.close')}
            </Button>
          )
        }
      >
        <Alert tone="success">{t('customerEdit.saved')}</Alert>
        {applyCharge.error && <Alert tone="danger">{errorMessage(applyCharge.error)}</Alert>}

        <Alert tone="warning" icon={MapPinned} title={t('customerEdit.zoneChangedTitle')} className="mb-0">
          {scope === 'owner' && suggested
            ? tf('customerEdit.zoneChangedOwner', {
                zone: suggested.name,
                amount: formatMoney(suggested.charge),
                current: formatMoney(saved.deliveryCharge),
              })
            : t('customerEdit.zoneChangedReseller')}
        </Alert>
      </Modal>
    );
  }

  /* ------------------------------------------------------------ the form -- */

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('customerEdit.title')} · ${order.orderCode}`}
      dirty={dirty}
      footerLead={
        !dirty ? <p className="text-xs text-muted-foreground">{t('customers.editNothingChanged')}</p> : undefined
      }
      footer={
        <>
          <ModalCancel />
          <Button type="submit" form="customer-edit-form" loading={save.isLoading} disabled={!dirty}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <form
        id="customer-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="mb-4 text-sm text-muted-foreground">{t('customerEdit.help')}</p>

        {save.error && Object.keys(errors).length === 0 && (
          <Alert tone="danger">{errorMessage(save.error)}</Alert>
        )}

        <Field label={t('customerEdit.name')} htmlFor="edit-customer-name" error={errors.name} required>
          <Input
            id="edit-customer-name"
            value={draft.name}
            onChange={set('name')}
            autoComplete="off"
            required
            minLength={2}
            maxLength={120}
          />
        </Field>

        <PhoneField
          id="edit-customer-phone"
          label={t('customerEdit.phone')}
          value={draft.phone}
          onChange={(phone) => setDraft((prev) => ({ ...prev, phone }))}
          error={errors.phone}
          autoComplete="off"
          required
        />

        {/*
         * All sixty-four, searchable. The order's own district stays selected
         * and is flagged rather than dropped when its zone has since been
         * retired, because it is where the parcel is actually going. While the
         * zones load the picker is held, and says so rather than looking broken.
         */}
        <Field
          label={t('order.district')}
          htmlFor="edit-customer-district"
          error={errors.district}
          hint={zones.isLoading ? t('customers.zonesLoading') : zones.isError ? t('customers.zonesFailed') : undefined}
          required
        >
          <DistrictSelect
            id="edit-customer-district"
            value={draft.district}
            onChange={(district) => setDraft((prev) => ({ ...prev, district }))}
            deliverable={zones.data ? districts.map((d) => d.district) : undefined}
            disabled={zones.isLoading}
            invalid={Boolean(errors.district)}
          />
        </Field>

        <Field
          label={t('order.address')}
          htmlFor="edit-customer-address"
          error={errors.address}
          required
          className="mb-0"
        >
          <Textarea
            id="edit-customer-address"
            rows={3}
            value={draft.address}
            onChange={set('address')}
            required
            minLength={5}
            maxLength={500}
          />
        </Field>
      </form>
    </Modal>
  );
}
