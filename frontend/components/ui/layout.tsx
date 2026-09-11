import Link from 'next/link';
import type { Route } from 'next';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n/bn';
import { errorMessage, errorHint } from '@/lib/api';

/*
 * The shared vocabulary of the interface.
 *
 * The table primitives moved to `./table` when they grew sorting, selection and
 * column visibility, but they are re-exported from here because twenty-odd pages
 * already import them from this module and the split is an implementation
 * detail, not a change to the vocabulary.
 */
export {
  TableWrap,
  Th,
  Td,
  Tr,
  SortTh,
  Checkbox,
  RowMenu,
  ColumnToggle,
  SelectionBar,
  useSort,
  useSelection,
  useColumns,
} from './table';
export type { SortState, SortDirection, MenuItem, ColumnDef } from './table';

/* ----------------------------------------------------------------- card -- */

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('card p-5 sm:p-6', className)} {...props} />;
}

/**
 * A card header.
 *
 * `href` renders the corner arrow: a card that is a doorway to a fuller page
 * says so in the corner rather than at the bottom, where on a phone it sits
 * below a scroll. `action` is for a control that does something here instead.
 * Passing both is fine; the arrow is navigation and the action is not.
 */
export function CardHeader({
  title,
  subtitle,
  action,
  href,
  hrefLabel,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  href?: Route;
  /** Names the arrow for a screen reader, since an arrow announces as nothing. */
  hrefLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {action}
        {href && (
          <Link
            href={href}
            aria-label={hrefLabel ?? String(title)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * The right-hand rail panel. Same shell as a card with tighter internal rhythm,
 * because a rail is a column of small things rather than one big thing.
 */
export function Panel({
  title,
  href,
  hrefLabel,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  href?: Route;
  hrefLabel?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('card p-5', className)}>
      <CardHeader title={title} href={href} hrefLabel={hrefLabel} action={action} className="mb-4" />
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- tones -- */

/*
 * Pills are a soft ground with a dark ink of the same hue, measured against each
 * other rather than against white, because that is the pair that renders. The
 * ring is what keeps a pill legible when a row behind it is tinted by hover or
 * selection.
 */
const TONES = {
  neutral: 'bg-subtle text-foreground ring-1 ring-border',
  primary: 'bg-primary-softer text-primary-ink ring-1 ring-primary/25',
  brand: 'bg-brand-soft text-brand-ink ring-1 ring-brand/35',
  success: 'bg-success-soft text-success-ink ring-1 ring-success/25',
  warning: 'bg-warning-soft text-warning-ink ring-1 ring-warning/45',
  danger: 'bg-danger-soft text-danger-ink ring-1 ring-danger/25',
} as const;

export type Tone = keyof typeof TONES;

/** The dot colours, for the pills that carry one. */
const DOTS: Record<Tone, string> = {
  neutral: 'bg-muted-foreground',
  primary: 'bg-primary',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
        TONES[tone],
        className
      )}
      {...props}
    >
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
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

/* ----------------------------------------------------------------- stat -- */

/**
 * The tinted square a stat card wears.
 *
 * A gradient rather than a flat tint, running from the soft ground into a
 * fractionally deeper one. It is barely perceptible on its own and it is the
 * difference between a chip that looks placed and a chip that looks printed.
 */
const CHIPS: Record<Tone, string> = {
  neutral: 'bg-gradient-to-br from-subtle to-muted text-muted-foreground',
  primary: 'bg-gradient-to-br from-primary-softer to-primary-soft text-primary-ink',
  brand: 'bg-gradient-to-br from-brand-soft to-brand/25 text-brand-ink',
  success: 'bg-gradient-to-br from-success-soft to-success/15 text-success-ink',
  warning: 'bg-gradient-to-br from-warning-soft to-warning/25 text-warning-ink',
  danger: 'bg-gradient-to-br from-danger-soft to-danger/12 text-danger-ink',
};

/**
 * A single number on a dashboard.
 *
 * The label sits above the figure, not below it. A number you have to read past
 * before finding out what it counts is a number you read twice, and this row of
 * cards is the first thing on both dashboards.
 *
 * The tone colours the icon chip and, when it is not neutral, the figure. A
 * count of zero overdue orders is good news and stays in ink; callers pass the
 * tone conditionally for exactly that reason.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon: Icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
  /** Makes the whole card the link, with an arrow in the corner to say so. */
  href?: Route;
  className?: string;
}) {
  const accent =
    tone === 'danger'
      ? 'text-danger-ink'
      : tone === 'warning'
        ? 'text-warning-ink'
        : tone === 'success'
          ? 'text-success-ink'
          : 'text-foreground';

  const body = (
    <>
      {/*
       * The chip row only exists when there is something to put in it. Rendering
       * it empty for a plain figure left a 36px hole above the label, which on a
       * row of four cards where only some carry an icon reads as a misalignment.
       */}
      {(Icon || href) && (
        <div className="mb-4 flex items-start justify-between gap-2">
          {Icon ? (
            <span
              aria-hidden
              className={cn('flex h-10 w-10 items-center justify-center rounded-xl', CHIPS[tone])}
            >
              <Icon className="h-5 w-5" />
            </span>
          ) : (
            <span />
          )}
          {href && (
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-all group-hover:bg-muted group-hover:text-foreground"
            >
              <ArrowUpRight className="h-4 w-4" />
            </span>
          )}
        </div>
      )}

      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div
        className={cn(
          'tabular mt-1 text-[2rem] font-bold leading-none tracking-tight',
          accent
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cn('card card-interactive group block p-5', className)}>
        {body}
      </Link>
    );
  }

  return <div className={cn('card p-5', className)}>{body}</div>;
}

/* --------------------------------------------------------------- avatar -- */

const AVATAR_SIZES = {
  sm: 'h-7 w-7 text-[0.625rem]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
} as const;

/**
 * Initials on a tinted ground, deterministic from the name.
 *
 * There are no uploaded profile pictures in this system and there is no plan for
 * any, so this is the whole implementation rather than a fallback for one. The
 * hue is derived from the name so the same reseller is the same colour on every
 * screen, which is what makes a column of these scannable at all.
 *
 * Bengali has no case, so `toUpperCase` is a no-op on most names here and the
 * first grapheme is taken as-is. Splitting by code unit would cut a conjunct in
 * half and render a broken glyph.
 */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name?: string | null;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  const label = (name ?? '').trim();
  const initial = label ? [...label][0].toUpperCase() : '?';

  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) % 360;
  }

  return (
    <span
      aria-hidden
      title={label || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold',
        AVATAR_SIZES[size],
        className
      )}
      style={{
        // Lightness and chroma are fixed; only the hue rotates. That keeps every
        // avatar at the same measured contrast against its own label whatever
        // name lands on it.
        background: `oklch(0.93 0.045 ${hash})`,
        color: `oklch(0.42 0.11 ${hash})`,
      }}
    >
      {initial}
    </span>
  );
}

/**
 * A row of people, overlapped, with a count for the ones that did not fit.
 *
 * The overlap is what makes this read as a group rather than a list, and the
 * ring around each avatar is what keeps the one behind from looking like a
 * smudge. `onRemove` puts a small cross on each, which is the only way to drop
 * one person from a set without a separate management screen.
 *
 * Ten is the cap rather than a scroll: past that the faces stop being
 * recognisable and the count is the more useful fact.
 */
export function AvatarStack({
  people,
  max = 6,
  onRemove,
  removeLabel,
  size = 'md',
  className,
}: {
  people: { id: string; name: string }[];
  max?: number;
  onRemove?: (id: string) => void;
  /** Built per person, e.g. `(name) => `Remove ${name}``. */
  removeLabel?: (name: string) => string;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  if (people.length === 0) return null;

  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <div className={cn('flex flex-wrap items-center gap-y-2', className)}>
      {shown.map((person) => (
        <span key={person.id} className="relative -mr-2 last:mr-0">
          <Avatar name={person.name} size={size} className="ring-2 ring-surface" />
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(person.id)}
              aria-label={removeLabel ? removeLabel(person.name) : person.name}
              className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-muted-foreground ring-1 ring-border transition-colors hover:bg-danger hover:text-danger-foreground hover:ring-danger"
            >
              <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 2l6 6M8 2L2 8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      ))}

      {rest > 0 && (
        <span
          className={cn(
            'tabular ml-3 flex items-center justify-center rounded-full bg-subtle font-semibold text-muted-foreground',
            AVATAR_SIZES[size]
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/** A name with its avatar, as one unit. Used in tables and rail lists. */
export function Person({
  name,
  caption,
  size = 'md',
  className,
}: {
  name?: string | null;
  caption?: React.ReactNode;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <Avatar name={name} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name ?? '—'}</span>
        {caption && <span className="block truncate text-xs text-muted-foreground">{caption}</span>}
      </span>
    </span>
  );
}

/* ----------------------------------------------------------- page shell -- */

/**
 * The two-column dashboard grid: main work on the left, rail on the right.
 *
 * One column until `lg`. The rail is supporting context, so on a narrow screen
 * it follows the main column rather than competing with it for the fold.
 */
export function DashboardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {children}
    </div>
  );
}

export function Rail({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
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
    <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- state -- */

export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      {Icon && (
        <span
          aria-hidden
          className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-subtle to-muted text-muted-foreground"
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
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
  icon: Icon,
  onDismiss,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Adds the close button from the reference design's inline notices. */
  onDismiss?: () => void;
}) {
  return (
    <div className={cn('mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm', TONES[tone])}>
      {Icon && <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('app.close')}
          className="-m-1 shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      )}
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
  error,
  message,
}: {
  onRetry: () => void;
  isRetrying?: boolean;
  /** The failure itself, so this component decides the wording and the hint. */
  error?: unknown;
  /** Explicit override, for the few callers that are not reporting an ApiError. */
  message?: string;
}) {
  const text = message ?? (error !== undefined ? errorMessage(error) : t('app.errorHelp'));
  // Says what actually broke, e.g. that the API is not running. Development only,
  // because it names ports and services a shopkeeper has no use for.
  const hint = error !== undefined ? errorHint(error) : undefined;

  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span
        aria-hidden
        className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft text-danger-ink"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <p className="font-medium">{t('app.errorTitle')}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {hint && (
        <p className="max-w-sm rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="tap mt-2 rounded-lg border-2 border-input px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
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
    <div className="elev-2 fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 pb-safe backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:shadow-none sm:backdrop-blur-none">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );
}
