'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { sessionKey } from '@/lib/session';
import type { OtpSent, Session } from '@/lib/types';
import { t } from '@/lib/i18n/bn';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { PhoneField } from '@/components/ui/phone-field';
import { PasswordField } from '@/components/ui/password-field';
import { OtpField, ResendCode, useResendCountdown } from '@/components/ui/otp-field';
import { Alert } from '@/components/ui/layout';

/**
 * Registration in two steps: the phone proves itself by SMS before the account
 * exists (docs/adr/0014), then the code, name and password create it.
 *
 * The phone comes first because it is the step that can fail for reasons
 * outside the form, a number already registered or an SMS that cannot go out,
 * and finding that out after typing a name and a password is finding it out late.
 */
export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'phone' | 'details'>('phone');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', shopName: '', phone: '', password: '', otp: '' });
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const secondsLeft = useResendCountdown(sentAt);

  const sendCode = useMutation({
    mutationFn: () => api.post<OtpSent>('/auth/register/otp', { phone: form.phone }),
    onSuccess: () => {
      setSentAt(Date.now());
      setStep('details');
    },
  });

  const register = useMutation({
    mutationFn: () =>
      api.post<Session>('/auth/register', {
        name: form.name,
        phone: form.phone,
        password: form.password,
        otp: form.otp,
        ...(form.shopName ? { shopName: form.shopName } : {}),
      }),
    onSuccess: async () => {
      // The register response omits the features block, so refetch rather than
      // seeding the cache with a partial session.
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      router.replace('/reseller/kyc');
    },
  });

  if (step === 'phone') {
    const errors = fieldErrors(sendCode.error);
    const generalError =
      sendCode.error instanceof ApiError && !sendCode.error.fields ? errorMessage(sendCode.error) : null;

    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sendCode.mutate();
        }}
      >
        <h1 className="mb-1 text-xl font-bold">{t('auth.registerTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('auth.registerStepPhone')}</p>

        {generalError && <Alert tone="danger">{generalError}</Alert>}

        <PhoneField
          id="phone"
          label={t('auth.phone')}
          value={form.phone}
          onChange={set('phone')}
          error={errors.phone}
          required
        />

        <Button type="submit" full size="lg" loading={sendCode.isPending}>
          {t('auth.sendCode')}
        </Button>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {t('auth.hasAccount')}{' '}
          <Link href="/login" className="font-semibold text-primary-ink hover:underline">
            {t('auth.login')}
          </Link>
        </p>
      </form>
    );
  }

  const errors = fieldErrors(register.error);
  const generalError =
    register.error instanceof ApiError && (!register.error.fields || register.error.code === 'PHONE_TAKEN')
      ? errorMessage(register.error)
      : null;
  const resendError = sendCode.error ? errorMessage(sendCode.error) : null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        register.mutate();
      }}
    >
      <h1 className="mb-1 text-xl font-bold">{t('auth.registerTitle')}</h1>
      <p className="mb-2 text-sm text-muted-foreground">{t('auth.registerStepDetails')}</p>
      <p className="mb-6 text-sm">
        <span className="tabular font-medium">{t('auth.otpSentTo').replace('{phone}', form.phone)}</span>{' '}
        <button
          type="button"
          onClick={() => {
            register.reset();
            sendCode.reset();
            setStep('phone');
          }}
          className="font-semibold text-primary-ink hover:underline"
        >
          {t('auth.changeNumber')}
        </button>
      </p>

      {generalError && <Alert tone="danger">{generalError}</Alert>}
      {resendError && <Alert tone="danger">{resendError}</Alert>}

      <OtpField id="otp" value={form.otp} onChange={set('otp')} error={errors.otp} className="mb-2" />
      <ResendCode
        secondsLeft={secondsLeft}
        pending={sendCode.isPending}
        onResend={() => sendCode.mutate()}
      />

      <Field label={t('auth.name')} htmlFor="name" error={errors.name} required>
        <Input
          id="name"
          value={form.name}
          onChange={(event) => set('name')(event.target.value)}
          autoComplete="name"
          required
        />
      </Field>

      <Field label={t('auth.shopName')} htmlFor="shopName" hint={t('app.optional')} error={errors.shopName}>
        <Input id="shopName" value={form.shopName} onChange={(event) => set('shopName')(event.target.value)} />
      </Field>

      <PasswordField
        id="password"
        label={t('auth.password')}
        autoComplete="new-password"
        hint={t('auth.passwordHint')}
        minLength={6}
        value={form.password}
        onChange={set('password')}
        error={errors.password}
        required
      />

      <Button type="submit" full size="lg" loading={register.isPending}>
        {t('auth.register')}
      </Button>
    </form>
  );
}
