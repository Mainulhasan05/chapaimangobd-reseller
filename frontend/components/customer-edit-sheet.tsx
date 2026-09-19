'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPinned } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney } from '@/lib/format';
import { normalizeBdPhoneInput } from '@/lib/phone';
import type { CustomerEditResult, DeliveryChargeChange, DeliveryZone, Order } from '@/lib/types';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { DistrictSelect } from '@/components/ui/district-field';
import { Modal } from '@/components/ui/modal';
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
  /** Receives the order as the API returned it, in the GET shape. */
  onSaved: (order: Order) => void;
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
  onSaved: (order: Order) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(order));
  // Set once the save went through and moved the order into another zone.
  const [zoneResult, setZoneResult] = useState<CustomerEditResult | null>(null);

  const zones = useQuery({
    queryKey: ['zones'],
    queryFn: () => api.get<{ zones: DeliveryZone[] }>('/public/delivery-zones'),
    staleTime: 5 * 60_000,
  });

  const districts = (zones.data?.zones ?? []).flatMap((zone) =>
    zone.districts.map((district) => ({ district, charge: zone.charge }))
  );
  /*
   * The order's own district stays selected even if its zone has since been
   * switched off: the picker lists all sixty-four and marks the undeliverable
   * ones rather than dropping them, so opening the sheet never silently blanks
   * the field. It used to need a synthetic <option> for exactly this case.
   */

  const original = draftFrom(order);
  const changes: Partial<Draft> = {};
  (Object.keys(draft) as (keyof Draft)[]).forEach((key) => {
    const value = key === 'phone' ? draft[key] : draft[key].trim();
    if (value !== original[key]) changes[key] = value;
  });
  const dirty = Object.keys(changes).length > 0;

  const refresh = async (next: Order) => {
    onSaved(next);
    await queryClient.invalidateQueries({ queryKey: scope === 'owner' ? ['owner'] : ['orders'] });
  };

  const save = useMutation({
    mutationFn: () => api.patch<CustomerEditResult>(`/${scope}/orders/${order.id}/customer`, changes),
    onSuccess: async (result) => {
      await refresh(result.order);
      if (result.deliveryZoneChanged) {
        setZoneResult(result);
        return;
      }
      toast(t('customerEdit.saved'));
      onClose();
    },
  });

  const applyCharge = useMutation({
    mutationFn: (charge: number) =>
      api.patch<DeliveryChargeChange>(`/owner/orders/${order.id}/delivery-charge`, {
        deliveryCharge: charge,
      }),
    onSuccess: async (result, charge) => {
      await refresh(result.order);
      toast(t('customerEdit.chargeApplied').replace('{amount}', formatMoney(charge)));
      onClose();
    },
  });

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
              <Button variant="outline" onClick={onClose}>
                {t('customerEdit.keepCharge')}
              </Button>
              <Button loading={applyCharge.isPending} onClick={() => applyCharge.mutate(suggested.charge)}>
                {t('customerEdit.applyCharge').replace('{amount}', formatMoney(suggested.charge))}
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
            ? t('customerEdit.zoneChangedOwner')
                .replace('{zone}', suggested.name)
                .replace('{amount}', formatMoney(suggested.charge))
                .replace('{current}', formatMoney(saved.deliveryCharge))
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
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            type="submit"
            form="customer-edit-form"
            loading={save.isPending}
            disabled={!dirty}
          >
            {t('app.save')}
          </Button>
        </>
      }
    >
      <form
        id="customer-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) save.mutate();
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
         * retired, because it is where the parcel is actually going.
         */}
        <Field
          label={t('order.district')}
          htmlFor="edit-customer-district"
          error={errors.district}
          required
        >
          <DistrictSelect
            id="edit-customer-district"
            value={draft.district}
            onChange={(district) => setDraft((prev) => ({ ...prev, district }))}
            deliverable={zones.isLoading ? undefined : districts.map((d) => d.district)}
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
