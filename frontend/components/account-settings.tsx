'use client';

import { useState } from 'react';
import { KeyRound, LogOut, MonitorSmartphone, ShieldAlert, Smartphone } from 'lucide-react';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { leaveToLogin, useSession } from '@/lib/session';
import {
  useChangePasswordMutation,
  useChangePhoneMutation,
  useSendPhoneChangeOtpMutation,
} from '@/lib/store/endpoints/public';
import {
  useGetDevicesQuery,
  useRevokeDeviceMutation,
  type TrustedDevice,
} from '@/lib/store/endpoints/shell';
import { t, tf } from '@/lib/i18n/bn';
import { formatDateTime } from '@/lib/format';
import { Alert, Badge, Card, CardHeader, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { PasswordField } from '@/components/ui/password-field';
import { PhoneField } from '@/components/ui/phone-field';
import { OtpField, ResendCode, useResendCountdown } from '@/components/ui/otp-field';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { ListSkeleton, Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

const generalErrorOf = (error: unknown) =>
  error instanceof ApiError && !error.fields ? errorMessage(error) : null;

/** 01712345678 from +8801712345678, the form a person recognises as theirs. */
const localPhone = (e164: string) => e164.replace(/^\+880/, '0');

/**
 * The signed-in person's own account: password and login phone, and for the
 * owner the browsers trusted to sign in without a code. Password and phone are
 * the same for the owner and a reseller, because both are one person with one
 * phone.
 */
export function AccountSettings() {
  const { data: session } = useSession();

  // The heading straight away, so the page never opens blank on a slow line.
  if (!session) {
    return (
      <>
        <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </>
    );
  }

  const owner = session.user.role === 'owner';

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
        {/* Resellers have no trusted devices; the API refuses them. */}
        {owner && !session.user.mustChangePassword && <DevicesCard />}
      </div>
    </>
  );
}

function PasswordCard({ mustChange }: { mustChange: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  // Clears mustChangePassword through the session tag, which stops the shell redirecting here.
  const [change, state] = useChangePasswordMutation();

  const errors = fieldErrors(state.error);
  const generalError = generalErrorOf(state.error);

  return (
    <Card>
      <CardHeader title={t('account.passwordTitle')} subtitle={t('account.passwordHelp')} />
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await change(form).unwrap();
            setForm({ currentPassword: '', newPassword: '' });
            toast(t('account.passwordChanged'));
          } catch {
            // Shown beside the fields below.
          }
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

        <Button type="submit" full loading={state.isLoading}>
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
 * because the phone is the login identity, and the final button says so again:
 * the warning at the top of the card is a scroll away by then.
 *
 * Each step shows its own errors inside its own form. A refused number used to
 * appear above both, which after the step changed read as a problem with the
 * code.
 */
function PhoneCard({ current }: { current: string }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [newPhone, setNewPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const secondsLeft = useResendCountdown(sentAt);

  const [sendCode, sendState] = useSendPhoneChangeOtpMutation();
  const [change, changeState] = useChangePhoneMutation();

  const send = async () => {
    try {
      await sendCode({ newPhone }).unwrap();
      setSentAt(Date.now());
      setStep('code');
    } catch {
      // Shown in the step that asked.
    }
  };

  const sendErrors = fieldErrors(sendState.error);
  const changeErrors = fieldErrors(changeState.error);
  // On the code step a failed resend is the code step's problem.
  const sendGeneral = !sendState.error
    ? null
    : (generalErrorOf(sendState.error) ?? (step === 'code' ? errorMessage(sendState.error) : null));
  const changeGeneral = generalErrorOf(changeState.error);

  return (
    <Card>
      <CardHeader title={t('account.phoneTitle')} subtitle={t('account.phoneHelp')} />

      <Field label={t('account.phoneCurrent')} htmlFor="currentPhone">
        <Input id="currentPhone" value={localPhone(current)} readOnly disabled className="tabular" />
      </Field>

      {step === 'phone' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
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
          {sendGeneral && <Alert tone="danger">{sendGeneral}</Alert>}
          <Button type="submit" full variant="outline" loading={sendState.isLoading}>
            <Smartphone className="h-4 w-4" />
            {t('auth.sendCode')}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await change({ newPhone, otp: code, password }).unwrap();
              // Signed out on the server already. A full page load leaves nothing
              // from this session in memory and fires no requests on the way out.
              leaveToLogin();
            } catch {
              // Shown beside the fields below.
            }
          }}
        >
          <p className="mb-4 text-sm">
            <span className="tabular font-medium">{t('auth.otpSentTo').replace('{phone}', newPhone)}</span>{' '}
            <button
              type="button"
              onClick={() => {
                changeState.reset();
                sendState.reset();
                setStep('phone');
              }}
              className="tap font-semibold text-primary-ink hover:underline"
            >
              {t('auth.changeNumber')}
            </button>
          </p>
          {/* A refused number belongs with the number, not under the password. */}
          {changeErrors.newPhone && (
            <p role="alert" className="-mt-3 mb-4 text-xs font-medium text-danger">
              {changeErrors.newPhone}
            </p>
          )}

          <OtpField id="phoneOtp" value={code} onChange={setCode} error={changeErrors.otp} className="mb-2" />
          <ResendCode secondsLeft={secondsLeft} pending={sendState.isLoading} onResend={() => void send()} />

          <PasswordField
            id="phonePassword"
            label={t('account.passwordForPhone')}
            value={password}
            onChange={setPassword}
            error={changeErrors.password}
            required
          />

          {(changeGeneral || sendGeneral) && (
            <Alert tone="danger">{changeGeneral ?? sendGeneral}</Alert>
          )}

          <p className="mb-3 flex items-start gap-2 text-sm text-warning-ink">
            <LogOut aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {t('account.phoneSubmitNote')}
          </p>
          <Button type="submit" full loading={changeState.isLoading}>
            {t('account.phoneSubmit')}
          </Button>
        </form>
      )}
    </Card>
  );
}

/**
 * The browsers that may sign in with a password alone for thirty days
 * (docs/adr/0014). They were created and expired with nobody able to see them,
 * so a lost phone stayed trusted until its thirty days ran out. Forgetting one
 * here makes its next sign-in ask for a code.
 */
function DevicesCard() {
  const toast = useToast();
  const devices = useGetDevicesQuery();
  const [revoke] = useRevokeDeviceMutation();
  const [target, setTarget] = useState<TrustedDevice | null>(null);

  const rows = devices.data?.devices ?? [];

  return (
    <Card className="lg:col-span-2">
      <CardHeader title={t('account.devicesTitle')} subtitle={t('account.devicesHelp')} />

      {devices.isLoading && <ListSkeleton rows={2} />}
      {devices.isError && !devices.data && (
        <ErrorState onRetry={() => devices.refetch()} isRetrying={devices.isFetching} error={devices.error} />
      )}
      {devices.data && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('account.devicesEmpty')}</p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center gap-3 py-3">
              <MonitorSmartphone aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span lang="en">{device.label ?? t('account.deviceUnknown')}</span>
                  {device.current && <Badge tone="primary">{t('account.deviceCurrent')}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {device.lastUsedAt
                    ? tf('account.deviceLastUsed', { time: formatDateTime(device.lastUsedAt) })
                    : tf('account.deviceAdded', { time: formatDateTime(device.createdAt) })}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setTarget(device)}>
                {t('account.deviceRevoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {target && (
        <ConfirmSheet
          title={t('account.deviceRevokeTitle')}
          tone="danger"
          confirmLabel={t('account.deviceRevoke')}
          summary={
            <p className="font-semibold">
              <span lang="en">{target.label ?? t('account.deviceUnknown')}</span>
              {target.current && ` · ${t('account.deviceCurrent')}`}
            </p>
          }
          consequences={[t('account.deviceRevokeConsequence'), t('account.deviceRevokeOpenSessions')]}
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            await revoke({ id: target.id }).unwrap();
            toast(t('account.deviceRevoked'));
          }}
        />
      )}
    </Card>
  );
}
