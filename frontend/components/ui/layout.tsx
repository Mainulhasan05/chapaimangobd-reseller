import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n/bn';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('card p-4 sm:p-5', className)} {...props} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/15 text-[oklch(0.45_0.14_70)]',
  success: 'bg-success/15 text-[oklch(0.42_0.12_150)]',
  warning: 'bg-warning/20 text-[oklch(0.42_0.11_75)]',
  danger: 'bg-danger/12 text-[oklch(0.48_0.17_27)]',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className
      )}
      {...props}
    />
  );
}

/** Maps an order or review status onto a colour, in one place. */
export function statusTone(status: string): Tone {
  if (['delivered', 'approved'].includes(status)) return 'success';
  if (['cancelled', 'returned', 'rejected'].includes(status)) return 'danger';
  if (['pending', 'not_submitted'].includes(status)) return 'warning';
  if (['confirmed', 'accepted', 'packed', 'shipped'].includes(status)) return 'primary';
  return 'neutral';
}

/** A single number on a dashboard. The label sits under it, not beside it. */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  const accent =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-[oklch(0.5_0.13_75)]'
        : tone === 'success'
          ? 'text-success'
          : 'text-foreground';

  return (
    <div className="card p-4">
      <div className={cn('text-2xl font-semibold tabular', accent)}>{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('mb-4 rounded-lg px-4 py-3 text-sm', TONES[tone])}>
      {title && <p className="font-medium">{title}</p>}
      {children}
    </div>
  );
}

/**
 * A table, from `sm` up.
 *
 * It is hidden below that by default, because a 42rem table inside a sideways
 * scroller on a 360px screen puts the action column off the right edge: the
 * primary button of the whole app was reachable only by scrolling to find it.
 * Every list that uses this renders cards for phones instead. Pass
 * `alwaysVisible` for the few tables that genuinely have nowhere else to go.
 */
export function TableWrap({
  children,
  alwaysVisible,
}: {
  children: React.ReactNode;
  alwaysVisible?: boolean;
}) {
  return (
    <div className={cn('card scroll-x', alwaysVisible ? undefined : 'hidden sm:block')}>
      <table className="w-full min-w-[42rem] text-sm">{children}</table>
    </div>
  );
}

/**
 * A query that failed, with the way out.
 *
 * Before this, a failed fetch rendered nothing: no message, no retry, just an
 * empty page that looked like an account with no orders in it. On a phone with
 * one bar that is the most common state of all, and `app.retry` sat unused in
 * the dictionary the whole time.
 */
export function ErrorState({
  onRetry,
  isRetrying,
  message,
}: {
  onRetry: () => void;
  isRetrying?: boolean;
  message?: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="font-medium">{t('app.errorTitle')}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message ?? t('app.errorHelp')}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="tap mt-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {t('app.retry')}
      </button>
    </div>
  );
}

/**
 * The bar that pins a page's primary action to the bottom of the viewport.
 *
 * The two screens where money is decided, the public order form and the confirm
 * sheet, both put their totals and their submit button at the end of a long
 * scroll. On a phone that means committing to a number you cannot see.
 */
export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 pb-safe backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-b border-border px-4 py-3 text-left text-xs font-medium text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('border-b border-border px-4 py-3 align-middle', className)} {...props} />;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
