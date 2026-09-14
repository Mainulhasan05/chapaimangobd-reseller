'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { sessionKey, homeFor, useSession } from '@/lib/session';
import { safeNext } from '@/lib/safe-next';
import type { LoginChallenge, LoginResult } from '@/lib/types';
import { t } from '@/lib/i18n/bn';
import { Button } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/phone-field';
import { PasswordField } from '@/components/ui/password-field';
import { OtpField, ResendCode, useResendCountdown } from '@/components/ui/otp-field';
import { Alert } from '@/components/ui/layout';

/**
 * What a failed sign-in says. A 401 here is a wrong number or password, which
 * the server words in English and deliberately the same either way.
 */
function loginErrorText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.fields) return null;
  if (error.status === 401) {
    return /suspended/i.test(error.message) ? t('auth.suspended') : t('auth.invalidCredentials');
  }
  return errorMessage(error);
}

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /** Set when the owner signs in from a device not trusted yet. */
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const secondsLeft = useResendCountdown(sentAt);

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

  /*
   * The login response carries the user but not the features block, so the
   * session is refetched rather than seeded with half of itself.
   */
  const enter = async () => {
    const fresh = await queryClient.fetchQuery({
      queryKey: sessionKey,
      queryFn: () => api.get<NonNullable<typeof session>>('/auth/me'),
      // The cache still holds the signed-out answer from a moment ago.
      staleTime: 0,
    });
    // Only follow a same-origin path, so the parameter cannot become an open redirect.
    const target = safeNext(params.get('next')) ?? homeFor(fresh);
    router.replace(target as never);
  };

  const login = useMutation({
    mutationFn: () => api.post<LoginResult>('/auth/login', { phone, password }),
    onSuccess: async (result) => {
      if (result.requiresOtp) {
        setChallenge(result);
        setCode('');
        setSentAt(Date.now());
        return;
      }
      await enter();
    },
  });

  const verify = useMutation({
    mutationFn: () =>
      api.post<LoginResult>('/auth/login/verify', { challengeId: challenge?.challengeId, otp: code }),
    onSuccess: enter,
  });

  if (challenge) {
    const errors = fieldErrors(verify.error);
    const generalError =
      verify.error instanceof ApiError && !verify.error.fields ? errorMessage(verify.error) : null;
    const resendError = login.error ? loginErrorText(login.error) : null;

    return (
      <form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          verify.mutate();
        }}
      >
        <h1 className="mb-1 text-xl font-bold">{t('auth.deviceTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('auth.deviceHelp').replace('{phone}', challenge.phoneHint)}
        </p>

        {generalError && <Alert tone="danger">{generalError}</Alert>}
        {resendError && <Alert tone="danger">{resendError}</Alert>}

        <OtpField id="otp" value={code} onChange={setCode} error={errors.otp} className="mb-2" />
        {/* A new code is a new password check, which issues a new challenge. */}
        <ResendCode
          secondsLeft={secondsLeft}
          pending={login.isPending}
          onResend={() => {
            verify.reset();
            login.mutate();
          }}
        />

        <Button type="submit" full size="lg" loading={verify.isPending}>
          {t('auth.verify')}
        </Button>

        <p className="mt-5 text-center text-sm">
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              verify.reset();
              login.reset();
            }}
            className="font-semibold text-primary-ink hover:underline"
          >
            {t('auth.backToLogin')}
          </button>
        </p>
      </form>
    );
  }

  const errors = fieldErrors(login.error);
  const generalError = loginErrorText(login.error);

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
        className="mb-2"
      />

      <p className="mb-5 text-right text-sm">
        <Link href="/forgot-password" className="font-semibold text-primary-ink hover:underline">
          {t('auth.forgotPassword')}
        </Link>
      </p>

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
