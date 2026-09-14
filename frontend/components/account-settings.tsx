'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldAlert, Smartphone } from 'lucide-react';
import { api, ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { sessionKey, useSession } from '@/lib/session';
import type { OtpSent, User } from '@/lib/types';
import { t } from '@/lib/i18n/bn';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { PasswordField } from '@/components/ui/password-field';
import { PhoneField } from '@/components/ui/phone-field';
import { OtpField, ResendCode, useResendCountdown } from '@/components/ui/otp-field';
import { useToast } from '@/components/ui/toast';

const generalErrorOf = (error: unknown) =>
  error instanceof ApiError && !error.fields ? errorMessage(error) : null;

/** 01712345678 from +8801712345678, the form a person recognises as theirs. */
const localPhone = (e164: string) => e164.replace(/^\+880/, '0');

/**
 * The signed-in person's own account: password and login phone. The same for
 * the owner and a reseller, because both are one person with one phone.
 */
export function AccountSettings() {
  const { data: session } = useSession();
  if (!session) return null;

  return (
    <>
      <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />

      {session.user.mustChangePassword && (
        <Alert tone="warning" title={t('account.mustChangeTitle')} icon={ShieldAlert}>
          {t('account.mustChangeHelp')}
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <PasswordCard mustChange={Boolean(session.user.mustChangePassword)} />
        <PhoneCard current={session.user.phoneE164} />
      </div>
    </>
  );
}

function PasswordCard({ mustChange }: { mustChange: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });

  const change = useMutation({
    mutationFn: () => api.post<{ user: User }>('/auth/password/change', form),
    onSuccess: async () => {
      setForm({ currentPassword: '', newPassword: '' });
      // Clears mustChangePassword, which is what lets the shell stop redirecting here.
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      toast(t('account.passwordChanged'));
    },
  });

  const errors = fieldErrors(change.error);
  const generalError = generalErrorOf(change.error);

  return (
    <Card>
      <CardHeader title={t('account.passwordTitle')} subtitle={t('account.passwordHelp')} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          change.mutate();
        }}
      >
        {generalError && <Alert tone="danger">{generalError}</Alert>}

        <PasswordField
          id="currentPassword"
          label={mustChange ? t('account.temporaryPassword') : t('auth.currentPassword')}
          value={form.currentPassword}
          onChange={(currentPassword) => setForm((prev) => ({ ...prev, currentPassword }))}
          error={errors.currentPassword}
          required
        />
        <PasswordField
          id="newPassword"
          label={t('auth.newPassword')}
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
          minLength={6}
          value={form.newPassword}
          onChange={(newPassword) => setForm((prev) => ({ ...prev, newPassword }))}
          error={errors.newPassword}
          required
        />

        <Button type="submit" full loading={change.isPending}>
          <KeyRound className="h-4 w-4" />
          {t('account.passwordSubmit')}
        </Button>
      </form>
    </Card>
  );
}

/**
 * Two steps, like registration: the new number receives a code, then the code
 * and the password move the account. Every session ends, this one included,
 * because the phone is the login identity.
 */
function PhoneCard({ current }: { current: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [newPhone, setNewPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const secondsLeft = useResendCountdown(sentAt);

  const sendCode = useMutation({
    mutationFn: () => api.post<OtpSent>('/auth/phone/otp', { newPhone }),
    onSuccess: () => {
      setSentAt(Date.now());
      setStep('code');
    },
  });

  const change = useMutation({
    mutationFn: () => api.post('/auth/phone/change', { newPhone, otp: code, password }),
    onSuccess: () => {
      // Signed out on the server already. Nothing from this session may linger.
      queryClient.clear();
      toast(t('account.phoneChanged'));
      router.replace('/login');
    },
  });

  const sendErrors = fieldErrors(sendCode.error);
  const changeErrors = fieldErrors(change.error);
  const generalError =
    step === 'phone'
      ? generalErrorOf(sendCode.error)
      : (generalErrorOf(change.error) ?? (sendCode.error ? errorMessage(sendCode.error) : null));

  return (
    <Card>
      <CardHeader title={t('account.phoneTitle')} subtitle={t('account.phoneHelp')} />

      <Field label={t('account.phoneCurrent')} htmlFor="currentPhone">
        <Input id="currentPhone" value={localPhone(current)} readOnly disabled className="tabular" />
      </Field>

      {generalError && <Alert tone="danger">{generalError}</Alert>}

      {step === 'phone' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sendCode.mutate();
          }}
        >
          <PhoneField
            id="newPhone"
            label={t('account.newPhone')}
            value={newPhone}
            onChange={setNewPhone}
            error={sendErrors.newPhone}
            autoComplete="off"
            required
          />
          <Button type="submit" full variant="outline" loading={sendCode.isPending}>
            <Smartphone className="h-4 w-4" />
            {t('auth.sendCode')}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate();
          }}
        >
          <p className="mb-4 text-sm">
            <span className="tabular font-medium">{t('auth.otpSentTo').replace('{phone}', newPhone)}</span>{' '}
            <button
              type="button"
              onClick={() => {
                change.reset();
                sendCode.reset();
                setStep('phone');
              }}
              className="font-semibold text-primary-ink hover:underline"
            >
              {t('auth.changeNumber')}
            </button>
          </p>

          <OtpField id="phoneOtp" value={code} onChange={setCode} error={changeErrors.otp} className="mb-2" />
          <ResendCode secondsLeft={secondsLeft} pending={sendCode.isPending} onResend={() => sendCode.mutate()} />

          <PasswordField
            id="phonePassword"
            label={t('account.passwordForPhone')}
            value={password}
            onChange={setPassword}
            error={changeErrors.password ?? changeErrors.newPhone}
            required
          />

          <Button type="submit" full loading={change.isPending}>
            {t('account.phoneSubmit')}
          </Button>
        </form>
      )}
    </Card>
  );
}
