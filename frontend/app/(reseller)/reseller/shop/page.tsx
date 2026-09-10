'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useSession, sessionKey } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import type { ResellerProfile } from '@/lib/types';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';

export default function ShopSettingsPage() {
  const { data: session, isLoading } = useSession();
  const profile = session?.profile;

  if (isLoading || !profile) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  // Rendered only once the profile has arrived, so the form below can seed its
  // state from props on mount rather than being filled in later by an effect.
  return <ShopSettings profile={profile} />;
}

function ShopSettings({ profile }: { profile: ResellerProfile }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    shopName: profile.shopName ?? '',
    slug: profile.slug ?? '',
    address: profile.address ?? '',
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch('/reseller/profile', patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKey }),
  });

  const approved = profile.kycStatus === 'approved';
  // Built in the browser so it matches whatever host the reseller is actually on.
  const shopUrl =
    typeof window === 'undefined'
      ? `/r/${profile.slug}`
      : `${window.location.origin}/r/${profile.slug}`;
  const errors = fieldErrors(save.error);

  return (
    <>
      <PageHeader title={t('nav.myShop')} subtitle={t('shop.shareHelp')} />

      {!approved && (
        <Alert tone="warning" title={t('kyc.pending')}>
          {t('kyc.gateHelp')}
        </Alert>
      )}

      <Card className="mb-4">
        <CardHeader
          title={t('shop.yourLink')}
          action={
            <span className={profile.formActive ? 'text-success' : 'text-muted-foreground'}>
              {profile.formActive ? t('shop.open') : t('shop.closed')}
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <code className="scroll-x flex-1 rounded-lg bg-muted px-3 py-2 text-sm">{shopUrl}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(shopUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? t('app.copied') : t('app.copy')}
          </Button>
          <a href={shopUrl} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm">
              {t('shop.orderNow')}
            </Button>
          </a>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={profile.formActive}
            disabled={!approved || save.isPending}
            onChange={(e) => save.mutate({ formActive: e.target.checked })}
          />
          <span>{t('shop.open')}</span>
        </label>
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
