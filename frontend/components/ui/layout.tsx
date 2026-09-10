import { cn } from '@/lib/utils';

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

/** Tables scroll inside their own box so the page body never scrolls sideways. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="card scroll-x">
      <table className="w-full min-w-[42rem] text-sm">{children}</table>
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
