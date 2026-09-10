'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { Field, Input } from '@/components/ui/form';

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
  className?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [revealed, setRevealed] = useState(false);

  return (
    <Field label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className}>
      <div className="relative">
        <Input
          id={fieldId}
          name={fieldId}
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          // Room for the toggle, which sits inside the field rather than beside
          // it so the input keeps the full width of the form.
          className="pr-12"
        />

        <button
          type="button"
          onClick={() => setRevealed((previous) => !previous)}
          aria-label={revealed ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed={revealed}
          // Excluded from the tab order: Tab from the password field should reach
          // the submit button, not a decoration between them.
          tabIndex={-1}
          className="tap absolute right-0 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          {revealed ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </Field>
  );
}
