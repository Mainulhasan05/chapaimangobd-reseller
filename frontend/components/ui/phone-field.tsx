'use client';

import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { PHONE_LENGTH, normalizeBdPhoneInput, phoneProblem } from '@/lib/phone';
import { cn } from '@/lib/utils';
import { Field, Input } from '@/components/ui/form';

/**
 * The only way a phone number is typed in this app.
 *
 * Every number here is a Bangladeshi mobile, so the field enforces that shape
 * instead of accepting anything and letting the server object after submit. Three
 * things happen as the digits arrive:
 *
 * - Bengali numerals are converted to Latin, because a Bengali keyboard is the
 *   default on these phones and `০১৭` reaches the API as an unparseable string.
 * - A pasted `+880`, `880` or bare `1712345678` is folded to the local form, so
 *   copying a number out of a contacts app just works.
 * - A live counter says how many digits are left, and turns into a tick at
 *   eleven. Length is the mistake people actually make, and a counter is the
 *   cheapest possible way to show it.
 *
 * The value handed to the parent is always plain Latin digits, at most eleven,
 * which is exactly what `normalizeBdPhone` on the server expects.
 */
export function PhoneField({
  label,
  value,
  onChange,
  id,
  error,
  hint,
  required,
  autoComplete = 'tel',
  className,
}: {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  id?: string;
  /** A server-side field error, which always outranks the local hint. */
  error?: string;
  hint?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  /*
   * Nothing is called wrong until the field has been left once. Telling someone
   * their number is too short while they are still typing the third digit is
   * noise, and it trains people to ignore the line that will later matter.
   */
  const [touched, setTouched] = useState(false);

  const digits = normalizeBdPhoneInput(value);
  const problem = phoneProblem(digits);
  const valid = problem === null;
  const remaining = PHONE_LENGTH - digits.length;

  const localError =
    touched && problem === 'prefix'
      ? t('auth.phonePrefix')
      : touched && problem === 'incomplete'
        ? t('auth.phoneRemaining').replace('{n}', formatNumber(remaining))
        : undefined;

  return (
    <Field
      label={label}
      htmlFor={fieldId}
      error={error ?? localError}
      hint={valid ? t('auth.phoneValid') : (hint ?? t('auth.phoneHint'))}
      required={required}
      className={className}
    >
      <div className="relative">
        <Input
          id={fieldId}
          name={fieldId}
          type="tel"
          inputMode="numeric"
          autoComplete={autoComplete}
          // Digits only, so the browser's own validation agrees with ours rather
          // than fighting it on submit.
          pattern="01[3-9][0-9]{8}"
          value={digits}
          required={required}
          onChange={(event) => onChange(normalizeBdPhoneInput(event.target.value))}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !valid && digits.length > 0 ? true : undefined}
          className={cn(
            'tabular pr-20 tracking-wide',
            valid && 'border-success',
            touched && localError && 'border-danger'
          )}
        />

        {/* The counter, which becomes the confirmation. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium',
            valid ? 'text-success' : 'text-muted-foreground'
          )}
        >
          {valid ? (
            <Check className="h-5 w-5" />
          ) : (
            t('auth.phoneCounter').replace('{n}', formatNumber(digits.length))
          )}
        </span>
      </div>
    </Field>
  );
}
