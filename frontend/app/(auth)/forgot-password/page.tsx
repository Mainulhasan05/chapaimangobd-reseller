'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CircleCheck } from 'lucide-react';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { useForgotPasswordMutation, useResetPasswordMutation } from '@/lib/store/endpoints/public';
import { t } from '@/lib/i18n/bn';
import { Button, ButtonLink } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/phone-field';
import { PasswordField } from '@/components/ui/password-field';
import { OtpField, ResendCode, useResendCountdown } from '@/components/ui/otp-field';
import { Alert } from '@/components/ui/layout';

const generalErrorOf = (error: unknown) =>
  error instanceof ApiError && !error.fields ? errorMessage(error) : null;

/**
 * Forgot password: a code to the account's phone, then a new password.
 *
 * The first step answers the same whether or not the number is registered, so
 * the second step is worded "if it is registered, a code was sent" rather than
 * promising one. A reset ends every session, so it finishes at the login form
 * rather than signing in.
 */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<'phone' | 'code' | 'done'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const secondsLeft = useResendCountdown(sentAt);

  // Errors are read from each mutation's state and shown on the form.
  const [sendCodeTrigger, sendCode] = useForgotPasswordMutation();
  const [resetTrigger, reset] = useResetPasswordMutation();

  const requestCode = async () => {
    const answer = await sendCodeTrigger({ phone });
    if (!('data' in answer)) return;
    setSentAt(Date.now());
    setStep('code');
  };

  const submitReset = async () => {
    const answer = await resetTrigger({ phone, otp: code, newPassword });
    if ('data' in answer) setStep('done');
  };

  if (step === 'done') {
    return (
      <div className="text-center">
        <CircleCheck aria-hidden className="mx-auto mb-3 h-10 w-10 text-success" />
        <h1 className="mb-2 text-xl font-bold">{t('auth.forgotTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('auth.resetDone')}</p>
        <ButtonLink href="/login" size="lg" full>
          {t('auth.login')}
        </ButtonLink>
      </div>
    );
  }

  if (step === 'phone') {
    const errors = fieldErrors(sendCode.error);
    const generalError = generalErrorOf(sendCode.error);

    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void requestCode();
        }}
      >
        <h1 className="mb-1 text-xl font-bold">{t('auth.forgotTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('auth.forgotHelp')}</p>

        {generalError && <Alert tone="danger">{generalError}</Alert>}

        <PhoneField
          id="phone"
          label={t('auth.phone')}
          value={phone}
          onChange={setPhone}
          error={errors.phone}
          required
        />

        <Button type="submit" full size="lg" loading={sendCode.isLoading}>
          {t('auth.sendCode')}
        </Button>

        <p className="mt-5 text-center text-sm">
          <Link href="/login" className="font-semibold text-primary-ink hover:underline">
            {t('auth.backToLogin')}
          </Link>
        </p>
      </form>
    );
  }

  const errors = fieldErrors(reset.error);
  const generalError = generalErrorOf(reset.error) ?? (sendCode.error ? errorMessage(sendCode.error) : null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submitReset();
      }}
    >
      <h1 className="mb-1 text-xl font-bold">{t('auth.forgotTitle')}</h1>
      <p className="mb-2 text-sm text-muted-foreground">{t('auth.forgotCodeHelp')}</p>
      <p className="mb-6 text-sm">
        <span className="tabular font-medium">{phone}</span>{' '}
        <button
          type="button"
          onClick={() => {
            reset.reset();
            sendCode.reset();
            setStep('phone');
          }}
          className="font-semibold text-primary-ink hover:underline"
        >
          {t('auth.changeNumber')}
        </button>
      </p>

      {generalError && <Alert tone="danger">{generalError}</Alert>}

      <OtpField id="otp" value={code} onChange={setCode} error={errors.otp} className="mb-2" />
      <ResendCode
        secondsLeft={secondsLeft}
        pending={sendCode.isLoading}
        onResend={() => void requestCode()}
      />

      <PasswordField
        id="newPassword"
        label={t('auth.newPassword')}
        autoComplete="new-password"
        hint={t('auth.passwordHint')}
        minLength={6}
        value={newPassword}
        onChange={setNewPassword}
        error={errors.newPassword}
        required
      />

      <Button type="submit" full size="lg" loading={reset.isLoading}>
        {t('auth.resetSubmit')}
      </Button>
    </form>
  );
}
