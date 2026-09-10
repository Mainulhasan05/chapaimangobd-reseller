'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoneyPlain } from '@/lib/format';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput } from '@/components/ui/form';
import { PhoneField } from '@/components/ui/phone-field';

type Settings = {
  businessName: string;
  supportPhone?: string;
  poweredByText: string;
  defaultCreditLimit: number;
  orderAgingHours: number;
  reverseDeliveryChargeOnReturn: boolean;
  smsPricePerCredit: number;
  features: { sms: boolean; telegram: boolean; webPush: boolean };
};

export default function OwnerSettingsPage() {
  const settings = useQuery({
    queryKey: ['owner', 'settings'],
    queryFn: () => api.get<{ settings: Settings }>('/owner/settings'),
  });

  if (!settings.data) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  // Rendered only once the settings have arrived, so the form seeds its draft
  // from props on mount rather than being filled in later by an effect.
  return <SettingsForm initial={settings.data.settings} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings>(initial);

  const smsBalance = useQuery({
    queryKey: ['owner', 'sms-balance'],
    queryFn: () =>
      api.get<{ configured: boolean; balance: number | null }>('/owner/settings/sms-balance'),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch('/owner/settings', {
        businessName: draft.businessName,
        poweredByText: draft.poweredByText,
        supportPhone: draft.supportPhone ?? '',
        defaultCreditLimit: Number(draft.defaultCreditLimit),
        orderAgingHours: Number(draft.orderAgingHours),
        reverseDeliveryChargeOnReturn: draft.reverseDeliveryChargeOnReturn,
        smsPricePerCredit: Number(draft.smsPricePerCredit),
        features: draft.features,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'settings'] }),
  });

  const errors = fieldErrors(save.error);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <PageHeader title={t('nav.settings')} />

      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}
      {save.isSuccess && <Alert tone="success">{t('app.save')}</Alert>}

      <Card className="mb-4">
        <CardHeader title={t('app.name')} />

        <Field label={t('auth.shopName')} htmlFor="businessName" error={errors.businessName}>
          <Input
            id="businessName"
            value={draft.businessName}
            onChange={(e) => set('businessName', e.target.value)}
          />
        </Field>

        <PhoneField
          id="supportPhone"
          label={t('auth.phone')}
          value={draft.supportPhone ?? ''}
          onChange={(supportPhone: string) => set('supportPhone', supportPhone)}
          error={errors.supportPhone}
          autoComplete="off"
        />

        <Field
          label="Powered by"
          htmlFor="poweredByText"
          hint="ক্রেতার ফর্মের নিচে দেখানো হবে"
          error={errors.poweredByText}
        >
          <Input
            id="poweredByText"
            value={draft.poweredByText}
            onChange={(e) => set('poweredByText', e.target.value)}
          />
        </Field>
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('nav.orders')} />

        <Field
          label={t('wallet.creditLimit')}
          htmlFor="defaultCreditLimit"
          hint="নতুন রিসেলারের জন্য শুরুতে যত"
          error={errors.defaultCreditLimit}
        >
          <MoneyInput
            id="defaultCreditLimit"
            value={formatMoneyPlain(draft.defaultCreditLimit)}
            onChange={(e) => set('defaultCreditLimit', Number(e.target.value))}
          />
        </Field>

        <Field
          label={t('owner.agingOrders')}
          htmlFor="orderAgingHours"
          hint="কত ঘণ্টা পর অর্ডার পুরনো ধরা হবে"
          error={errors.orderAgingHours}
        >
          <Input
            id="orderAgingHours"
            type="number"
            min={1}
            className="tabular"
            value={draft.orderAgingHours}
            onChange={(e) => set('orderAgingHours', Number(e.target.value))}
          />
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={draft.reverseDeliveryChargeOnReturn}
            onChange={(e) => set('reverseDeliveryChargeOnReturn', e.target.checked)}
          />
          <span>
            ফেরত এলে ডেলিভারি চার্জও ফেরত দিন
            <span className="block text-xs text-muted-foreground">
              বন্ধ রাখলে কুরিয়ার খরচ রিসেলারের কাছেই থাকবে
            </span>
          </span>
        </label>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={t('nav.notifications')}
          subtitle={
            smsBalance.data?.configured
              ? `SMS ব্যালেন্স: ${smsBalance.data.balance ?? '—'}`
              : 'SMS গেটওয়ে যুক্ত করা হয়নি'
          }
        />

        {/*
          SMS costs money per message and Bengali halves the characters per
          segment, so it stays off until the credit purchase flow has been tested
          against the live gateway.
        */}
        <label className="mb-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={draft.features.sms}
            onChange={(e) => set('features', { ...draft.features, sms: e.target.checked })}
          />
          <span>
            SMS
            <span className="block text-xs text-muted-foreground">
              চালু করলে রিসেলাররা SMS ক্রেডিট কিনতে পারবে
            </span>
          </span>
        </label>

        <label className="mb-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={draft.features.telegram}
            onChange={(e) => set('features', { ...draft.features, telegram: e.target.checked })}
          />
          <span>Telegram</span>
        </label>

        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={draft.features.webPush}
            onChange={(e) => set('features', { ...draft.features, webPush: e.target.checked })}
          />
          <span>Web push</span>
        </label>

        <Field
          label="প্রতি SMS ক্রেডিটের দাম"
          htmlFor="smsPricePerCredit"
          error={errors.smsPricePerCredit}
        >
          <MoneyInput
            id="smsPricePerCredit"
            value={formatMoneyPlain(draft.smsPricePerCredit)}
            onChange={(e) => set('smsPricePerCredit', Number(e.target.value))}
          />
        </Field>
      </Card>

      <Button loading={save.isPending} onClick={() => save.mutate()}>
        {t('app.save')}
      </Button>
    </>
  );
}
