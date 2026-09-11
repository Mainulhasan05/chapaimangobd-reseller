'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { Field, InlineIconButton, Input } from '@/components/ui/form';

/**
 * A password field with a reveal toggle.
 *
 * Typing a password blind on a phone keyboard is where most failed sign-ins
 * actually come from: the key you cannot see is the one you got wrong, and the
 * only feedback is a rejected login a network round trip later. The toggle is a
 * button rather than a checkbox so it carries its own state to a screen reader.
 *
 * The reveal is never the initial state, and the field is remounted as
 * `type="password"` on every page load, so a revealed password cannot survive
 * into a screenshot or a shared screen by accident.
 */
export function PasswordField({
  label,
  value,
  onChange,
  id,
  error,
  hint,
  required,
  autoComplete = 'current-password',
  minLength,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  autoComplete?: string;
  /** Native floor for a new password, so the browser stops a short one first. */
  minLength?: number;
  className?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [revealed, setRevealed] = useState(false);

  return (
    <Field label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className}>
      <Input
        id={fieldId}
        name={fieldId}
        type={revealed ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        minLength={minLength}
        invalid={Boolean(error)}
        // The toggle sits inside the field rather than beside it, so the input
        // keeps the full width of the form.
        action={
          <InlineIconButton
            onClick={() => setRevealed((previous) => !previous)}
            aria-label={revealed ? t('auth.hidePassword') : t('auth.showPassword')}
            aria-pressed={revealed}
            // Excluded from the tab order: Tab from the password field should
            // reach the submit button, not a decoration between them.
            tabIndex={-1}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </InlineIconButton>
        }
      />
    </Field>
  );
}
