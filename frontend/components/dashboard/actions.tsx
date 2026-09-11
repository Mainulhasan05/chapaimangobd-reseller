import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/utils';

/**
 * The handful of things the reader came here to start.
 *
 * A dashboard answers two questions: how are things, and what do I do now. The
 * figures above answer the first. Without this row the second is answered only
 * by the navigation, which means reading a number and then hunting for the
 * screen that acts on it.
 *
 * Two columns on a phone rather than one. These are short labels beside a chip,
 * so a single column would stack four near-empty bands down the most valuable
 * part of the screen and push the actual data below the fold.
 */

const CHIPS = {
  primary: 'bg-primary-softer text-primary-ink',
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
} as const;

export type ActionTone = keyof typeof CHIPS;

export function ActionGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function ActionCard({
  icon: Icon,
  label,
  hint,
  href,
  tone = 'primary',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** One line on what the screen is for. Hidden on a phone, where it does not fit. */
  hint?: string;
  href: Route;
  tone?: ActionTone;
}) {
  return (
    <Link
      href={href}
      className="card card-interactive group flex items-center gap-3 p-3.5 sm:p-4"
    >
      <span
        aria-hidden
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105',
          CHIPS[tone]
        )}
      >
        <Icon className="h-5 w-5" />
      </span>

      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {hint && (
          <span className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">
            {hint}
          </span>
        )}
      </span>
    </Link>
  );
}
