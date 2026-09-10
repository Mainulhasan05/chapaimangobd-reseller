'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { sessionKey, homeFor } from '@/lib/session';
import type { Session } from '@/lib/types';
import { t } from '@/lib/i18n/bn';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => api.post<Session>('/auth/login', { phone, password }),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey, session);
      const next = params.get('next');
      // Only follow an internal path, so the parameter cannot become an open redirect.
      const target = next && next.startsWith('/') ? next : homeFor(session);
      router.replace(target as never);
    },
  });

  const errors = fieldErrors(login.error);
  const generalError =
    login.error instanceof ApiError && !login.error.fields ? login.error.message : null;

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        login.mutate();
      }}
    >
      <h1 className="mb-1 text-xl font-semibold">{t('auth.loginTitle')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('app.name')}</p>

      {generalError && <Alert tone="danger">{generalError}</Alert>}

      <Field label={t('auth.phone')} htmlFor="phone" hint={t('auth.phoneHint')} error={errors.phone} required>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </Field>

      <Field label={t('auth.password')} htmlFor="password" error={errors.password} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>

      <Button type="submit" full size="lg" loading={login.isPending}>
        {t('auth.login')}
      </Button>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link href="/register" className="font-medium text-foreground underline">
          {t('auth.register')}
        </Link>
      </p>
    </form>
  );
}
