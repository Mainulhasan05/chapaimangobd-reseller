'use client';

import { cn } from '@/lib/utils';

/**
 * The replacement for a sixteen pixel checkbox.
 *
 * The three toggles in this app are all consequential: whether the shop takes
 * orders, whether a product is listed, whether its price is hidden. A mis-tap on
 * any of them is visible to customers, so the whole row is the target and the
 * state is legible without reading the label.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'tap flex w-full items-center justify-between gap-3 rounded-lg py-2 text-left transition-colors',
        disabled ? 'opacity-50' : 'hover:bg-muted',
        className
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>

      <span
        aria-hidden
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-success' : 'bg-input'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5'
          )}
        />
      </span>
    </button>
  );
}
