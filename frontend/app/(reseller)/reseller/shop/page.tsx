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
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch('/reseller/profile', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKey });
      toast(t('shop.savedToast'));
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

      <Card>
        <CardHeader title={t('nav.settings')} />

        {save.error && !Object.keys(errors).length && (
          <Alert tone="danger">{errorMessage(save.error)}</Alert>
        )}

        <Field label={t('auth.shopName')} htmlFor="shopName" error={errors.shopName}>
          <Input
            id="shopName"
            value={form.shopName}
            onChange={(e) => setForm((p) => ({ ...p, shopName: e.target.value }))}
          />
        </Field>

        <Field
          label={t('shop.yourLink')}
          htmlFor="slug"
          error={errors.slug}
          hint={approved ? 'a-z, 0-9 এবং হাইফেন' : t('kyc.gateHelp')}
        >
          <Input
            id="slug"
            value={form.slug}
            disabled={!approved}
            onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
          />
        </Field>

        <Field label={t('order.address')} htmlFor="address" error={errors.address}>
          <Textarea
            id="address"
            rows={2}
            value={form.address}
            onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
          />
        </Field>

        <Button
          full
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              shopName: form.shopName,
              address: form.address,
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
