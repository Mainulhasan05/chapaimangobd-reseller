'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { sessionKey, homeFor, useSession } from '@/lib/session';
import { safeNext } from '@/lib/safe-next';
import type { Session } from '@/lib/types';
import { t } from '@/lib/i18n/bn';
import { Button } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/phone-field';
import { PasswordField } from '@/components/ui/password-field';
import { Alert } from '@/components/ui/layout';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  /*
   * Somebody who is already signed in has no business looking at this form. It
   * was unreachable while `/` redirected here; now that `/` is a public landing
   * page with a Login link in its header, a signed-in visitor can tap through to
   * it and be asked to do something they have already done.
   */
  const { data: session } = useSession();

  useEffect(() => {
    if (session) router.replace((safeNext(params.get('next')) ?? homeFor(session)) as never);
  }, [session, router, params]);

  const login = useMutation({
    mutationFn: () => api.post<Session>('/auth/login', { phone, password }),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey, session);
      // Only follow a same-origin path, so the parameter cannot become an open redirect.
      const target = safeNext(params.get('next')) ?? homeFor(session);
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
      <h1 className="mb-1 text-xl font-bold">{t('auth.loginTitle')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('auth.loginHelp')}</p>

      {generalError && <Alert tone="danger">{generalError}</Alert>}

      <PhoneField
        id="phone"
        label={t('auth.phone')}
        value={phone}
        onChange={setPhone}
        error={errors.phone}
        required
      />

      <PasswordField
        id="password"
        label={t('auth.password')}
        value={password}
        onChange={setPassword}
        error={errors.password}
        required
      />

      <Button type="submit" full size="lg" loading={login.isPending}>
        {t('auth.login')}
      </Button>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link href="/register" className="font-semibold text-primary-ink hover:underline">
          {t('auth.register')}
        </Link>
      </p>
    </form>
  );
}
