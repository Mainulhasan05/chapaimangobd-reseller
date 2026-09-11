'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoneyPlain } from '@/lib/format';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PhoneField } from '@/components/ui/phone-field';
import { ImageField } from '@/components/ui/image-field';
import { useToast } from '@/components/ui/toast';

type Settings = {
  businessName: string;
  supportPhone?: string;
  poweredByText: string;
  defaultCreditLimit: number;
  orderAgingHours: number;
  reverseDeliveryChargeOnReturn: boolean;
  smsPricePerCredit: number;
  features: { sms: boolean; telegram: boolean; webPush: boolean };
  /** The public brand mark. Uploaded on its own, not through the form below. */
  brandLogoUrl?: string | null;
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
  const toast = useToast();
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

  /*
   * The picture is multipart and the rest of this page is JSON, so it cannot
   * ride along with `save`. Both invalidate the same query, which is what puts
   * the new logo on screen without a reload.
   */
  const uploadLogo = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData();
      data.set('image', file);
      return api.upload('/owner/settings/brand-logo', data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'settings'] });
      toast(t('file.uploaded'));
    },
  });

  const removeLogo = useMutation({
    mutationFn: () => api.del('/owner/settings/brand-logo'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'settings'] });
      toast(t('file.removed'));
    },
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

      {/*
       * Its own card, and its own request. Every other setting here is text the
       * owner edits and saves together; a picture is sent the moment it is
       * confirmed, and pretending otherwise would mean holding a five megabyte
       * file in the form state until someone remembers to press save.
       */}
      <Card className="mb-4">
        <CardHeader title={t('settings.brandLogo')} />
        <ImageField
          label={t('settings.brandLogo')}
          hint={t('settings.brandLogoHint')}
          currentUrl={initial.brandLogoUrl}
          uploading={uploadLogo.isPending}
          removing={removeLogo.isPending}
          onUpload={(file) => uploadLogo.mutate(file)}
          onRemove={() => removeLogo.mutate()}
          error={
            uploadLogo.error
              ? errorMessage(uploadLogo.error)
              : removeLogo.error
                ? errorMessage(removeLogo.error)
                : undefined
          }
        />
      </Card>

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

        <Switch
          checked={draft.reverseDeliveryChargeOnReturn}
          onChange={(checked) => set('reverseDeliveryChargeOnReturn', checked)}
          label="ফেরত এলে ডেলিভারি চার্জও ফেরত দিন"
          hint="বন্ধ রাখলে কুরিয়ার খরচ রিসেলারের কাছেই থাকবে"
        />
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
        <div className="mb-4 divide-y divide-border">
          <Switch
            checked={draft.features.sms}
            onChange={(checked) => set('features', { ...draft.features, sms: checked })}
            label="SMS"
            hint="চালু করলে রিসেলাররা SMS ক্রেডিট কিনতে পারবে"
          />
          <Switch
            checked={draft.features.telegram}
            onChange={(checked) => set('features', { ...draft.features, telegram: checked })}
            label="Telegram"
          />
          <Switch
            checked={draft.features.webPush}
            onChange={(checked) => set('features', { ...draft.features, webPush: checked })}
            label="Web push"
          />
        </div>

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
