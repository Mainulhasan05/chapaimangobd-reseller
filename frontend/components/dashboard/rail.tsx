import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/layout';

/**
 * The pieces the right-hand rail is built from.
 *
 * A rail holds context, not controls: things worth knowing while you work on the
 * left-hand column. Everything in here is therefore either a link to the page
 * that can act on it or a plain read-out. Nothing in a rail is the only way to
 * reach an action, because below `lg` the rail is simply the bottom of the page.
 */

/**
 * One person, or one thing that behaves like a person.
 *
 * `href` turns the whole row into a link with a chevron, which is the affordance
 * on a phone where there is no hover to reveal anything.
 */
export function RailRow({
  name,
  caption,
  meta,
  href,
  trailing,
}: {
  name: string;
  caption?: React.ReactNode;
  /** The figure on the right: a count, an amount, a status. */
  meta?: React.ReactNode;
  href?: Route;
  /** Replaces the chevron, for a row that carries a pill instead. */
  trailing?: React.ReactNode;
}) {
  const body = (
    <>
      <Avatar name={name} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        {caption && <span className="block truncate text-xs text-muted-foreground">{caption}</span>}
      </span>
      {meta && <span className="tabular shrink-0 text-sm font-bold">{meta}</span>}
      {trailing}
      {href && !trailing && (
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
        >
          {body}
        </Link>
      </li>
    );
  }

  return <li className="flex items-center gap-2.5 py-2">{body}</li>;
}

export function RailList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

/**
 * The dark panel at the foot of the rail.
 *
 * It is the one block on a dashboard that inverts, which is what makes a queue
 * of things waiting on you read as a different kind of object from the cards
 * above it. White on this gradient measures about 6.7:1, so the figures inside
 * it are not relying on size to stay readable.
 */
export function QueuePanel({
  title,
  subtitle,
  href,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  href?: Route;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="elev-2 relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br from-[oklch(0.5_0.22_263)] to-[oklch(0.38_0.16_265)] p-4 text-white">
      {/* A soft highlight, so the fill reads as a surface rather than a swatch. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/15 blur-2xl"
      />

      <div className="relative">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-white/75">{subtitle}</p>}
          </div>
          {href && (
            <Link
              href={href}
              aria-label={title}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-white/25"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">{children}</div>

        {footer && (
          <div className="mt-3 rounded-lg bg-white/12 px-3 py-2 text-xs text-white/90">{footer}</div>
        )}
      </div>
    </section>
  );
}

/**
 * One tile inside the queue panel. A count of zero is drawn faded rather than
 * hidden: "nothing waiting" is the answer the reader came for, and a tile that
 * disappears when it hits zero makes the panel change shape every time it is
 * right.
 */
export function QueueTile({
  label,
  count,
  icon: Icon,
  href,
}: {
  label: string;
  count: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  href?: Route;
}) {
  const empty = count === 0 || count === '০' || count === '0';

  const body = (
    <>
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="tabular block text-sm font-bold leading-tight">{count}</span>
        <span className="block truncate text-[0.6875rem] leading-tight text-white/75">{label}</span>
      </span>
    </>
  );

  const className = cn(
    'flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-2 transition-colors',
    empty && 'opacity-60',
    href && 'hover:bg-white/20'
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
