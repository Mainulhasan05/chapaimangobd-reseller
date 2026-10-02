'use client';

import { useRef, useState } from 'react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoneyPlain, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import {
  useGetSettingsQuery,
  useGetSmsBalanceQuery,
  useRemoveBrandLogoMutation,
  useUpdateSettingsMutation,
  useUploadBrandLogoMutation,
  type Settings,
} from '@/lib/store/endpoints/settings';
import { useGetSmsOverviewQuery } from '@/lib/store/endpoints/people';
import { Card, CardHeader, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, FormErrorSummary, Input, MoneyInput, focusFirstInvalid } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PhoneField } from '@/components/ui/phone-field';
import { ImageField } from '@/components/ui/image-field';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { CustomerSmsTemplates } from '@/components/customer-sms-templates';

export default function OwnerSettingsPage() {
  const settings = useGetSettingsQuery();

  if (settings.isError && !settings.data) {
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
      <>
        <PageHeader title={t('nav.settings')} />
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </>
    );
  }

  // Rendered only once the settings have arrived, so the form seeds its draft
  // from props on mount rather than being filled in later by an effect.
  return <SettingsForm initial={settings.data.settings} />;
}

/**
 * The money settings and the aging hours are held as the text typed, not as
 * numbers. A number re-formatted on every keystroke cannot hold `12.` on its way
 * to `12.50`, and an hours box held as a number turned a cleared field into 0
 * and sent it.
 */
type Draft = {
  businessName: string;
  supportPhone: string;
  poweredByText: string;
  defaultCreditLimit: string;
  orderAgingHours: string;
  reverseDeliveryChargeOnReturn: boolean;
  smsPricePerCredit: string;
  features: Settings['features'];
};

const draftOf = (settings: Settings): Draft => ({
  businessName: settings.businessName,
  supportPhone: settings.supportPhone ?? '',
  poweredByText: settings.poweredByText,
  defaultCreditLimit: formatMoneyPlain(settings.defaultCreditLimit),
  orderAgingHours: String(settings.orderAgingHours),
  reverseDeliveryChargeOnReturn: settings.reverseDeliveryChargeOnReturn,
  smsPricePerCredit: formatMoneyPlain(settings.smsPricePerCredit),
  features: { ...settings.features },
});

/** A whole number of hours, one or more, or null. */
function agingHours(text: string): number | null {
  const value = Number(text);
  return text.trim() !== '' && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * One form, one Save, kept where the thumb is.
 *
 * The page used to end in a Save button below four cards, with a success banner
 * at the top that stayed there through every later edit and an error banner the
 * owner could not see from the bottom. Now an edit raises a bar pinned above
 * the bottom navigation that says something is unsaved and holds the Save; a
 * save answers with a toast and the bar goes away; a refusal marks the fields,
 * moves to the first one and says so in the bar. Leaving with unsaved edits
 * asks first.
 *
 * Two things save on their own and say so: the logo (sent the moment a picture
 * is picked) and the customer SMS templates, which are validated as a set.
 */
function SettingsForm({ initial }: { initial: Settings }) {
  const toast = useToast();
  const formRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<Draft>(() => draftOf(initial));
  const [draft, setDraft] = useState<Draft>(saved);
  const [tried, setTried] = useState(false);
  const [confirmingSmsOff, setConfirmingSmsOff] = useState(false);
  const [confirmingLogoRemoval, setConfirmingLogoRemoval] = useState(false);

  const [save, saveState] = useUpdateSettingsMutation();
  const [uploadLogo, uploadState] = useUploadBrandLogoMutation();
  const [removeLogo, removeState] = useRemoveBrandLogoMutation();
  const smsBalance = useGetSmsBalanceQuery();
  // Only to warn before switching reseller SMS off while they hold credits.
  const smsOverview = useGetSmsOverviewQuery(undefined, { skip: !draft.features.sms });

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);

  const creditLimitCheck = checkMoney(draft.defaultCreditLimit, { allowZero: true });
  const smsPriceCheck = checkMoney(draft.smsPricePerCredit, { allowZero: true });
  const hours = agingHours(draft.orderAgingHours);
  const valid = creditLimitCheck.ok && smsPriceCheck.ok && hours !== null;

  const errors = fieldErrors(saveState.error);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    setTried(true);
    if (!valid) {
      // After the render that marks them.
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    try {
      await save({
        businessName: draft.businessName,
        poweredByText: draft.poweredByText,
        supportPhone: draft.supportPhone,
        defaultCreditLimit: creditLimitCheck.ok ? creditLimitCheck.value : undefined,
        orderAgingHours: hours ?? undefined,
        reverseDeliveryChargeOnReturn: draft.reverseDeliveryChargeOnReturn,
        smsPricePerCredit: smsPriceCheck.ok ? smsPriceCheck.value : undefined,
        features: draft.features,
      }).unwrap();
      setSaved(draft);
      setTried(false);
      toast(t('app.saved'));
    } catch (error) {
      toast(errorMessage(error), 'danger');
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
    }
  };

  // Unknown while the overview loads or if it failed; the confirm still shows, just without the count.
  const credits = smsOverview.data?.stats.resellerCredits;
  const setResellerSms = (on: boolean) => {
    // Credits already bought stop working while it is off; say so before it happens.
    if (!on && saved.features.sms && credits !== 0) {
      setConfirmingSmsOff(true);
      return;
    }
    set('features', { ...draft.features, sms: on });
  };

  const agingError =
    errors.orderAgingHours ?? (tried && hours === null ? t('settings.agingHoursInvalid') : undefined);
  const creditError =
    errors.defaultCreditLimit ?? moneyError(draft.defaultCreditLimit, { allowZero: true });
  const priceError =
    errors.smsPricePerCredit ?? moneyError(draft.smsPricePerCredit, { allowZero: true });

  return (
    <>
      <PageHeader title={t('nav.settings')} />

      <div ref={formRef}>
        {/*
         * The logo is its own request. Every other setting here is text the owner
         * edits and saves together; a picture is sent the moment it is chosen,
         * and holding a five megabyte file in the form until Save would only
         * risk losing it.
         */}
        <Card className="mb-4">
          <CardHeader title={t('settings.brandLogo')} subtitle={t('settings.logoInstant')} />
          <ImageField
            label={t('settings.brandLogo')}
            hint={t('settings.brandLogoHint')}
            currentUrl={initial.brandLogoUrl}
            uploading={uploadState.isLoading}
            removing={removeState.isLoading}
            onUpload={async (file) => {
              const formData = new FormData();
              formData.set('image', file);
              try {
                await uploadLogo({ formData }).unwrap();
                toast(t('file.uploaded'));
              } catch (error) {
                toast(errorMessage(error), 'danger');
              }
            }}
            onRemove={() => setConfirmingLogoRemoval(true)}
            error={uploadState.error ? errorMessage(uploadState.error) : undefined}
          />
        </Card>

        <Card className="mb-4">
          <CardHeader title={t('settings.groupBusiness')} />

          <Field label={t('settings.businessName')} htmlFor="businessName" error={errors.businessName}>
            <Input
              id="businessName"
              value={draft.businessName}
              invalid={Boolean(errors.businessName)}
              onChange={(e) => set('businessName', e.target.value)}
            />
          </Field>

          <PhoneField
            id="supportPhone"
            label={t('settings.supportPhone')}
            hint={t('settings.supportPhoneHint')}
            value={draft.supportPhone}
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
              invalid={Boolean(errors.poweredByText)}
              onChange={(e) => set('poweredByText', e.target.value)}
            />
          </Field>

          <Field
            label={t('settings.agingHours')}
            htmlFor="orderAgingHours"
            hint={t('settings.agingHoursHelp')}
            error={agingError}
            className="mb-0"
          >
            <Input
              id="orderAgingHours"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className="tabular max-w-48"
              invalid={Boolean(agingError)}
              aria-invalid={agingError ? true : undefined}
              trailing={<span className="text-sm text-muted-foreground">{t('settings.agingHoursUnit')}</span>}
              value={draft.orderAgingHours}
              onChange={(e) => set('orderAgingHours', e.target.value)}
            />
          </Field>
        </Card>

        <Card className="mb-4">
          <CardHeader title={t('settings.groupResellerAccount')} />

          <Field
            label={t('settings.defaultCreditLimit')}
            htmlFor="defaultCreditLimit"
            hint={t('settings.defaultCreditLimitHint')}
            error={creditError}
          >
            <MoneyInput
              id="defaultCreditLimit"
              value={draft.defaultCreditLimit}
              invalid={Boolean(creditError)}
              aria-invalid={creditError ? true : undefined}
              onChange={(e) => set('defaultCreditLimit', e.target.value)}
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
            title={t('settings.groupSms')}
            subtitle={
              smsBalance.isError
                ? t('settings.smsBalanceFailed')
                : smsBalance.data
                  ? smsBalance.data.configured
                    ? smsBalance.data.balance == null
                      ? t('settings.smsBalanceFailed')
                      : tf('settings.smsBalanceCount', { count: formatNumber(smsBalance.data.balance) })
                    : t('settings.smsNotConfigured')
                  : undefined
            }
            /*
             * SMS has its own screen, because it is the only channel that spends
             * money and the only one with a record worth reading. The switch
             * stays here as well, among the other channels.
             */
            href="/owner/sms"
            hrefLabel={t('sms.title')}
          />

          <Switch
            checked={draft.features.sms}
            onChange={setResellerSms}
            label={t('settings.featureSmsResellers')}
            hint={t('settings.featureSmsHonest')}
          />

          <Field
            label={t('settings.smsPricePerCredit')}
            htmlFor="smsPricePerCredit"
            error={priceError}
            className="mb-0 mt-3"
          >
            <MoneyInput
              id="smsPricePerCredit"
              value={draft.smsPricePerCredit}
              invalid={Boolean(priceError)}
              aria-invalid={priceError ? true : undefined}
              onChange={(e) => set('smsPricePerCredit', e.target.value)}
            />
          </Field>
        </Card>

        <Card className="mb-4">
          <CardHeader title={t('settings.groupChannels')} />
          <div className="divide-y divide-border">
            <Switch
              checked={draft.features.telegram}
              onChange={(checked) => set('features', { ...draft.features, telegram: checked })}
              label={t('settings.featureTelegram')}
            />
            <Switch
              checked={draft.features.webPush}
              onChange={(checked) => set('features', { ...draft.features, webPush: checked })}
              label={t('settings.featurePush')}
            />
          </div>
        </Card>

        {/*
         * The one Save, pinned above the bottom navigation while there is
         * something to save. Sticky rather than fixed, so it never covers the
         * navigation or the templates card below the form.
         */}
        {dirty && (
          <div className="above-nav sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mb-4 lg:bottom-4">
            <div className="card elev-3 flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <FormErrorSummary message={tried && !valid ? t('app.fixFields') : null} />
                {!(tried && !valid) && (
                  <p className="text-sm font-medium">{t('app.unsavedBar')}</p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setDraft(saved)} disabled={saveState.isLoading}>
                {t('app.cancel')}
              </Button>
              <Button size="sm" loading={saveState.isLoading} onClick={submit}>
                {t('settings.saveAll')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/*
       * Its own card and its own save, below the form: the templates are
       * validated as a set, and a refused template must not hold up a change to
       * the business name, or the other way round.
       */}
      <p className="mb-2 mt-6 text-xs font-medium text-muted-foreground">{t('settings.templatesSeparate')}</p>
      <CustomerSmsTemplates initial={initial} />

      {confirmingSmsOff && (
        <ConfirmSheet
          title={t('settings.smsOffTitle')}
          tone="danger"
          confirmLabel={t('settings.smsOffConfirm')}
          consequences={[
            credits === undefined
              ? t('settings.smsOffCreditsUnknown')
              : tf('settings.smsOffCredits', { count: formatNumber(credits) }),
            t('settings.smsOffConsequence'),
          ]}
          onClose={() => setConfirmingSmsOff(false)}
          onConfirm={async () => {
            set('features', { ...draft.features, sms: false });
          }}
        />
      )}

      {confirmingLogoRemoval && (
        <ConfirmSheet
          title={t('settings.logoRemoveTitle')}
          tone="danger"
          confirmLabel={t('app.remove')}
          consequences={[t('settings.logoRemoveConsequence')]}
          onClose={() => setConfirmingLogoRemoval(false)}
          onConfirm={async () => {
            await removeLogo().unwrap();
            toast(t('file.removed'));
          }}
        />
      )}
    </>
  );
}
