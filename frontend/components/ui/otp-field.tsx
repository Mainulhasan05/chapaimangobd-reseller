'use client';

import { useEffect, useId, useState } from 'react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { toLatinDigits } from '@/lib/phone';
import { cn } from '@/lib/utils';
import { Field, Input } from '@/components/ui/form';

export const OTP_LENGTH = 6;

/** How long before another code may be asked for. The server allows three an hour. */
export const RESEND_SECONDS = 60;

/**
 * The six digit SMS code.
 *
 * `one-time-code` lets Android and iOS offer the code straight from the SMS
 * above the keyboard, which on a cheap phone is the difference between tapping
 * once and switching apps to copy six digits. A Bengali keyboard's digits are
 * folded to Latin, because that is what the server compares.
 */
export function OtpField({
  value,
  onChange,
  id,
  error,
  hint,
  label = t('auth.otp'),
  className,
}: {
  value: string;
  onChange: (digits: string) => void;
  id?: string;
  error?: string;
  hint?: string;
  label?: string;
  className?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <Field
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint ?? t('auth.otpHint')}
      required
      className={className}
    >
      <Input
        id={fieldId}
        name={fieldId}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={OTP_LENGTH}
        required
        value={value}
        invalid={Boolean(error)}
        onChange={(event) =>
          onChange(toLatinDigits(event.target.value).replace(/\D/g, '').slice(0, OTP_LENGTH))
        }
        className="tabular text-center text-lg tracking-[0.5em]"
      />
    </Field>
  );
}

/**
 * A countdown that starts when `startedAt` changes. Returns the seconds left,
 * zero once another code may be requested.
 */
export function useResendCountdown(startedAt: number | null, seconds = RESEND_SECONDS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null) return 0;
  // Clamped both ways: `now` is from the last tick and can predate a fresh start.
  return Math.min(seconds, Math.max(0, seconds - Math.floor((now - startedAt) / 1000)));
}

/** The resend link under a code field, disabled while the countdown runs. */
export function ResendCode({
  secondsLeft,
  onResend,
  pending,
  className,
}: {
  secondsLeft: number;
  onResend: () => void;
  pending?: boolean;
  className?: string;
}) {
  const waiting = secondsLeft > 0;
  return (
    <p className={cn('mb-4 text-sm', className)}>
      {waiting ? (
        <span className="text-muted-foreground">
          {t('auth.resendIn').replace('{n}', formatNumber(secondsLeft))}
        </span>
      ) : (
        <button
          type="button"
          onClick={onResend}
          disabled={pending}
          className="font-semibold text-primary-ink hover:underline disabled:opacity-50"
        >
          {t('auth.resendCode')}
        </button>
      )}
    </p>
  );
}
