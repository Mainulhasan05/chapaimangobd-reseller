'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useReadOnlyAccount, useSession, sessionKey } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { kycBlocks } from '@/lib/kyc';
import { LANDING_TEMPLATES } from '@/lib/landing';
import { cn } from '@/lib/utils';
import type { LandingTemplate, ResellerProfile } from '@/lib/types';
import { Alert, Badge, Card, CardHeader, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { ShareShopCard, useShopUrl } from '@/components/share-shop';
import { Field, Input, Textarea } from '@/components/ui/form';
import { ImageField } from '@/components/ui/image-field';

export default function ShopSettingsPage() {
  const { data: session, isLoading } = useSession();
  const profile = session?.profile;

  if (isLoading || !profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Rendered only once the profile has arrived, so the form below can seed its
  // state from props on mount rather than being filled in later by an effect.
  return <ShopSettings profile={profile} />;
}

function ShopSettings({ profile }: { profile: ResellerProfile }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const shopUrl = useShopUrl(profile.slug);
  // Deactivated: the owner closed the shop, and every field here is read only.
  const readOnly = useReadOnlyAccount();

  const [form, setForm] = useState({
    shopName: profile.shopName ?? '',
    slug: profile.slug ?? '',
    address: profile.address ?? '',
    about: profile.about ?? '',
    publicPhone: profile.publicPhone ?? '',
    whatsappNumber: profile.whatsappNumber ?? '',
    facebookUrl: profile.facebookUrl ?? '',
    bkashNumber: profile.payment?.bkash ?? '',
    nagadNumber: profile.payment?.nagad ?? '',
  });

  const field = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch('/reseller/profile', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKey });
      toast(t('shop.savedToast'));
    },
  });

  /*
   * The picture is multipart and the rest of this page is JSON, so it cannot
   * ride along with `save`. It invalidates the session, because the profile the
   * whole dashboard reads is the one the session carries.
   */
  const uploadLogo = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData();
      data.set('logo', file);
      return api.upload('/reseller/profile/logo', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKey });
      toast(t('file.uploaded'));
    },
  });

  const removeLogo = useMutation({
    mutationFn: () => api.del('/reseller/profile/logo'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKey });
      toast(t('file.removed'));
    },
  });

  /*
   * Not "is KYC approved" but "is anything held shut by KYC". For the reseller
   * the owner never asked, which is the default, nothing here is gated and the
   * screen says nothing about verification at all. See docs/adr/0017.
   */
  const blocked = kycBlocks(profile);
  const errors = fieldErrors(save.error);

  return (
    <>
      <PageHeader title={t('nav.myShop')} subtitle={t('shop.shareHelp')} />

      {blocked && (
        <Alert tone="warning" title={t('kyc.pending')} icon={ShieldAlert}>
          {t('kyc.gateHelp')}
        </Alert>
      )}

      <div className="mb-4">
        <ShareShopCard url={shopUrl} shopName={profile.shopName} />
      </div>

      <DesignPicker profile={profile} readOnly={readOnly} />

      <Card className="mb-4">
        {/*
         * Whether the shop takes orders at all was a sixteen pixel checkbox. It
         * is now a row-wide switch, because a mis-tap here closes the storefront.
         */}
        <Switch
          checked={profile.formActive}
          disabled={readOnly || blocked || save.isPending}
          onChange={(checked) => save.mutate({ formActive: checked })}
          label={profile.formActive ? t('shop.open') : t('shop.closed')}
          hint={blocked ? t('kyc.gateHelp') : undefined}
        />
      </Card>

      {/*
       * Above the name and the link, because this is the first thing a customer
       * sees on the form and the last thing a reseller thinks to set.
       */}
      <Card className={readOnly ? 'hidden' : 'mb-4'}>
        <CardHeader title={t('shop.logo')} />
        <ImageField
          label={t('shop.logo')}
          hint={t('shop.logoHint')}
          shape="circle"
          currentUrl={profile.logoUrl}
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

      <Card>
        <CardHeader title={t('nav.settings')} />

        {save.error && !Object.keys(errors).length && (
          <Alert tone="danger">{errorMessage(save.error)}</Alert>
        )}

        <Field label={t('auth.shopName')} htmlFor="shopName" error={errors.shopName}>
          <Input
            id="shopName"
            value={form.shopName}
            onChange={field('shopName')}
          />
        </Field>

        <Field
          label={t('shop.yourLink')}
          htmlFor="slug"
          error={errors.slug}
          hint={blocked ? t('kyc.gateHelp') : t('shop.slugHint')}
        >
          <Input
            id="slug"
            value={form.slug}
            disabled={blocked}
            onChange={field('slug')}
          />
        </Field>

        <Field label={t('order.address')} htmlFor="address" error={errors.address}>
          <Textarea id="address" rows={2} value={form.address} onChange={field('address')} />
        </Field>

        <Field
          label={t('shop.about')}
          htmlFor="about"
          hint={t('shop.aboutHint')}
          error={errors.about}
        >
          <Textarea id="about" rows={2} value={form.about} onChange={field('about')} />
        </Field>
      </Card>

      {/*
       * How a customer reaches a person.
       *
       * An order form carrying only a price list gives a buyer no way to ask
       * whether the mangoes are ripe, and nothing to judge who is taking their
       * money. Every field is optional and simply left off the public page when
       * it is blank.
       */}
      <Card className="mb-4">
        <CardHeader title={t('shop.contact')} subtitle={t('shop.contactHelp')} />

        {/*
         * Not the login phone. That one is an account credential; this one is
         * printed on a page anyone can open, and a reseller may well want the
         * two to be different numbers.
         */}
        <Field
          label={t('shop.publicPhone')}
          htmlFor="publicPhone"
          error={errors.publicPhone}
        >
          <Input
            id="publicPhone"
            type="tel"
            inputMode="numeric"
            value={form.publicPhone}
            onChange={field('publicPhone')}
          />
        </Field>

        <Field label={t('shop.whatsapp')} htmlFor="whatsappNumber" error={errors.whatsappNumber}>
          <Input
            id="whatsappNumber"
            type="tel"
            inputMode="numeric"
            value={form.whatsappNumber}
            onChange={field('whatsappNumber')}
          />
        </Field>

        <Field
          label={t('shop.facebook')}
          htmlFor="facebookUrl"
          hint={t('shop.facebookHint')}
          error={errors.facebookUrl}
        >
          {/*
           * `type="text"`, not `type="url"`: the browser's own constraint
           * checking refuses anything without a scheme, which would put back
           * exactly the rejection the field no longer does. docs/adr/0020.
           */}
          <Input
            id="facebookUrl"
            inputMode="url"
            value={form.facebookUrl}
            onChange={field('facebookUrl')}
          />
        </Field>
      </Card>

      {/*
       * Where a prepaid customer sends the money. On a prepaid order the
       * customer pays the reseller directly, and without these on the page that
       * conversation happens over the phone every single time.
       */}
      <Card className="mb-4">
        <CardHeader title={t('shop.payment')} subtitle={t('shop.paymentHelp')} />

        <Field label={t('shop.bkash')} htmlFor="bkashNumber" error={errors.bkashNumber}>
          <Input
            id="bkashNumber"
            type="tel"
            inputMode="numeric"
            value={form.bkashNumber}
            onChange={field('bkashNumber')}
          />
        </Field>

        <Field label={t('shop.nagad')} htmlFor="nagadNumber" error={errors.nagadNumber}>
          <Input
            id="nagadNumber"
            type="tel"
            inputMode="numeric"
            value={form.nagadNumber}
            onChange={field('nagadNumber')}
          />
        </Field>

        <Button
          full
          hidden={readOnly}
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              shopName: form.shopName,
              address: form.address,
              about: form.about,
              publicPhone: form.publicPhone,
              whatsappNumber: form.whatsappNumber,
              facebookUrl: form.facebookUrl,
              bkashNumber: form.bkashNumber,
              nagadNumber: form.nagadNumber,
              ...(!blocked && form.slug !== profile.slug ? { slug: form.slug } : {}),
            })
          }
        >
          {t('app.save')}
        </Button>
      </Card>
    </>
  );
}

/**
 * Which landing design customers see. Choosing saves at once, like the open
 * switch, because there is nothing else to fill in; each design can be looked
 * at first in a new tab, with the reseller's own products and contact details.
 */
function DesignPicker({ profile, readOnly }: { profile: ResellerProfile; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const current = profile.landingTemplate ?? 'bagan';

  const choose = useMutation({
    mutationFn: (landingTemplate: LandingTemplate) =>
      api.patch('/reseller/profile', { landingTemplate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKey });
      toast(t('shop.designSaved'));
    },
  });

  return (
    <Card className="mb-4">
      <CardHeader title={t('shop.design')} subtitle={t('shop.designHelp')} />

      {choose.error && <Alert tone="danger">{errorMessage(choose.error)}</Alert>}

      <div role="radiogroup" aria-label={t('shop.design')} className="grid gap-3 sm:grid-cols-3">
        {LANDING_TEMPLATES.map((design) => {
          const selected = design.id === current;
          const pending = choose.isPending && choose.variables === design.id;
          return (
            <div
              key={design.id}
              className={cn(
                'flex flex-col overflow-hidden rounded-xl border bg-surface transition-shadow',
                selected ? 'border-primary ring-2 ring-primary' : 'border-border'
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={readOnly || choose.isPending}
                onClick={() => !selected && choose.mutate(design.id)}
                className="tap flex flex-1 flex-col text-left disabled:cursor-default"
              >
                {/* A miniature of the design: its header colour, a headline bar, its button. */}
                <span aria-hidden className="block p-3" style={{ background: design.swatch[0] }}>
                  <span className="mb-1.5 block h-2 w-2/3 rounded-full bg-white/80" />
                  <span className="mb-3 block h-2 w-1/2 rounded-full bg-white/50" />
                  <span className="block h-5 w-20 rounded-md" style={{ background: design.swatch[1] }} />
                </span>
                <span className="block p-3">
                  <span className="flex items-center justify-between gap-2 font-semibold">
                    {t(design.labelKey)}
                    {selected && (
                      <Badge tone="success" dot>
                        {t('shop.designChosen')}
                      </Badge>
                    )}
                    {pending && <Spinner />}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {t(design.helpKey)}
                  </span>
                </span>
              </button>
              <a
                href={`/r/${profile.slug}?template=${design.id}`}
                target="_blank"
                rel="noreferrer"
                className="tap flex items-center justify-center gap-1.5 border-t border-border px-3 py-2.5 text-sm font-semibold text-primary-ink hover:bg-muted"
              >
                <ExternalLink aria-hidden className="h-4 w-4" />
                {t('shop.designPreview')}
              </a>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
