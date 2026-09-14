'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoneyPlain, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { Alert, Card, CardHeader, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PhoneField } from '@/components/ui/phone-field';
import { ImageField } from '@/components/ui/image-field';
import { useToast } from '@/components/ui/toast';
import { CustomerSmsTemplates, type CustomerSmsSettings } from '@/components/customer-sms-templates';

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
} & CustomerSmsSettings;

export default function OwnerSettingsPage() {
  const settings = useQuery({
    queryKey: ['owner', 'settings'],
    queryFn: () => api.get<{ settings: Settings }>('/owner/settings'),
  });

  if (settings.isError) {
    return (
      <>
        <PageHeader title={t('nav.settings')} />
        <ErrorState
          onRetry={() => settings.refetch()}
          isRetrying={settings.isFetching}
          error={settings.error}
        />
      </>
    );
  }

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

/**
 * The two money settings are held as the text typed, not as numbers. A number
 * re-formatted on every keystroke cannot hold `12.` on its way to `12.50`.
 */
type Draft = Omit<Settings, 'defaultCreditLimit' | 'smsPricePerCredit'> & {
  defaultCreditLimit: string;
  smsPricePerCredit: string;
};

function SettingsForm({ initial }: { initial: Settings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => ({
    ...initial,
    defaultCreditLimit: formatMoneyPlain(initial.defaultCreditLimit),
    smsPricePerCredit: formatMoneyPlain(initial.smsPricePerCredit),
  }));

  const creditLimitCheck = checkMoney(draft.defaultCreditLimit, { allowZero: true });
  const smsPriceCheck = checkMoney(draft.smsPricePerCredit, { allowZero: true });

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
        defaultCreditLimit: creditLimitCheck.ok ? creditLimitCheck.value : undefined,
        orderAgingHours: Number(draft.orderAgingHours),
        reverseDeliveryChargeOnReturn: draft.reverseDeliveryChargeOnReturn,
        smsPricePerCredit: smsPriceCheck.ok ? smsPriceCheck.value : undefined,
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
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <PageHeader title={t('nav.settings')} />

      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}
      {save.isSuccess && <Alert tone="success">{t('app.saved')}</Alert>}

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
          label={t('settings.poweredBy')}
          htmlFor="poweredByText"
          hint={t('settings.poweredByHint')}
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
          hint={t('settings.defaultCreditLimitHint')}
          error={errors.defaultCreditLimit ?? moneyError(draft.defaultCreditLimit, { allowZero: true })}
        >
          <MoneyInput
            id="defaultCreditLimit"
            value={draft.defaultCreditLimit}
            onChange={(e) => set('defaultCreditLimit', e.target.value)}
          />
        </Field>

        <Field
          label={t('owner.agingOrders')}
          htmlFor="orderAgingHours"
          hint={t('settings.agingHoursHint')}
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
          label={t('settings.reverseDeliveryCharge')}
          hint={t('settings.reverseDeliveryChargeHint')}
        />
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={t('nav.notifications')}
          subtitle={
            smsBalance.data?.configured
              ? `${t('settings.smsBalance')}: ${
                  smsBalance.data.balance == null ? '—' : formatNumber(smsBalance.data.balance)
                }`
              : t('settings.smsNotConfigured')
          }
          /*
           * SMS has its own screen now, because it is the only channel that
           * spends money and the only one with a record worth reading. The
           * switch stays here as well: it belongs in a list of the three
           * channels, and someone turning notifications off across the board
           * should not have to visit two pages to do it.
           */
          href="/owner/sms"
          hrefLabel={t('sms.title')}
        />

        <div className="mb-4 divide-y divide-border">
          <Switch
            checked={draft.features.sms}
            onChange={(checked) => set('features', { ...draft.features, sms: checked })}
            label={t('settings.featureSms')}
            hint={t('settings.featureSmsHint')}
          />
          <Switch
            checked={draft.features.telegram}
            onChange={(checked) => set('features', { ...draft.features, telegram: checked })}
            label={t('settings.featureTelegram')}
          />
          <Switch
            checked={draft.features.webPush}
            onChange={(checked) => set('features', { ...draft.features, webPush: checked })}
            label={t('settings.featureWebPush')}
          />
        </div>

        <Field
          label={t('settings.smsPricePerCredit')}
          htmlFor="smsPricePerCredit"
          error={errors.smsPricePerCredit ?? moneyError(draft.smsPricePerCredit, { allowZero: true })}
        >
          <MoneyInput
            id="smsPricePerCredit"
            value={draft.smsPricePerCredit}
            onChange={(e) => set('smsPricePerCredit', e.target.value)}
          />
        </Field>
      </Card>

      <Button
        className="mb-6"
        loading={save.isPending}
        disabled={!creditLimitCheck.ok || !smsPriceCheck.ok}
        onClick={() => save.mutate()}
      >
        {t('app.save')}
      </Button>

      {/*
       * Its own card and its own save, below the form's button: the templates
       * are validated as a set and a refused template must not hold up a change
       * to the business name, or the other way round.
       */}
      <CustomerSmsTemplates initial={initial} />
    </>
  );
}
