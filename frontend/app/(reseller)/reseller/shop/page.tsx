'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useSession, sessionKey } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import type { ResellerProfile } from '@/lib/types';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
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

  const approved = profile.kycStatus === 'approved';
  const errors = fieldErrors(save.error);

  return (
    <>
      <PageHeader title={t('nav.myShop')} subtitle={t('shop.shareHelp')} />

      {!approved && (
        <Alert tone="warning" title={t('kyc.pending')} icon={ShieldAlert}>
          {t('kyc.gateHelp')}
        </Alert>
      )}

      <div className="mb-4">
        <ShareShopCard url={shopUrl} shopName={profile.shopName} />
      </div>

      <Card className="mb-4">
        {/*
         * Whether the shop takes orders at all was a sixteen pixel checkbox. It
         * is now a row-wide switch, because a mis-tap here closes the storefront.
         */}
        <Switch
          checked={profile.formActive}
          disabled={!approved || save.isPending}
          onChange={(checked) => save.mutate({ formActive: checked })}
          label={profile.formActive ? t('shop.open') : t('shop.closed')}
          hint={approved ? undefined : t('kyc.gateHelp')}
        />
      </Card>

      {/*
       * Above the name and the link, because this is the first thing a customer
       * sees on the form and the last thing a reseller thinks to set.
       */}
      <Card className="mb-4">
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
          hint={approved ? t('shop.slugHint') : t('kyc.gateHelp')}
        >
          <Input
            id="slug"
            value={form.slug}
            disabled={!approved}
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
          hint="https://facebook.com/..."
          error={errors.facebookUrl}
        >
          <Input
            id="facebookUrl"
            type="url"
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
              ...(approved && form.slug !== profile.slug ? { slug: form.slug } : {}),
            })
          }
        >
          {t('app.save')}
        </Button>
      </Card>
    </>
  );
}
