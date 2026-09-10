'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { sessionKey } from '@/lib/session';
import type { Session } from '@/lib/types';
import { t } from '@/lib/i18n/bn';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({ name: '', shopName: '', phone: '', password: '' });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const register = useMutation({
    mutationFn: () =>
      api.post<Session>('/auth/register', {
        name: form.name,
        phone: form.phone,
        password: form.password,
        ...(form.shopName ? { shopName: form.shopName } : {}),
      }),
    onSuccess: async () => {
      // The register response omits the features block, so refetch rather than
      // seeding the cache with a partial session.
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      router.replace('/reseller/kyc');
    },
  });

  const errors = fieldErrors(register.error);
  const generalError =
    register.error instanceof ApiError && !register.error.fields ? register.error.message : null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        register.mutate();
      }}
    >
      <h1 className="mb-1 text-xl font-semibold">{t('auth.registerTitle')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('kyc.gateHelp')}</p>

      {generalError && <Alert tone="danger">{generalError}</Alert>}

      <Field label={t('auth.name')} htmlFor="name" error={errors.name} required>
        <Input id="name" value={form.name} onChange={set('name')} autoComplete="name" required />
      </Field>

      <Field label={t('auth.shopName')} htmlFor="shopName" hint={t('app.optional')} error={errors.shopName}>
        <Input id="shopName" value={form.shopName} onChange={set('shopName')} />
      </Field>

      <Field label={t('auth.phone')} htmlFor="phone" hint={t('auth.phoneHint')} error={errors.phone} required>
        <Input
          id="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={form.phone}
          onChange={set('phone')}
          required
        />
      </Field>

      <Field
        label={t('auth.password')}
        htmlFor="password"
        hint={t('auth.passwordHint')}
        error={errors.password}
        required
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          required
          minLength={8}
        />
      </Field>

      <Button type="submit" full size="lg" loading={register.isPending}>
        {t('auth.register')}
      </Button>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {t('auth.hasAccount')}{' '}
        <Link href="/login" className="font-medium text-foreground underline">
          {t('auth.login')}
        </Link>
      </p>
    </form>
  );
}
