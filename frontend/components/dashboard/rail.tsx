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
 * Everything waiting on the owner personally, as one block.
 *
 * **The emphasis follows the queue, not the other way round.** This panel used to
 * be a loud filled slab at all times, which meant the single most shouting thing
 * on the dashboard was usually the thing saying "nothing needs you" — six zeroes
 * under a bright gradient. Attention paid to an empty queue is attention taken
 * from the figures that did change.
 *
 * So it has two states. With nothing waiting it is an ordinary card and sits
 * down with everything else. With something waiting it fills with mango and
 * becomes the loudest block on the page, which is the only time that is true.
 *
 * `data-busy` carries the state to the tiles rather than a prop or a context,
 * so `QueueTile`'s signature stays as it is at six call sites.
 */
export function QueuePanel({
  title,
  subtitle,
  href,
  waiting,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  href?: Route;
  /** How many things are actually waiting. Zero makes the panel recede. */
  waiting: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const busy = waiting > 0;

  return (
    <section
      data-busy={busy}
      className={cn(
        'group/panel relative overflow-hidden rounded-[var(--radius-panel)] p-5 transition-colors',
        busy
          ? // Darkens towards the corner. Measured against the near-black label
            // the two ends are 8.7:1 and 5.9:1, so the text holds anywhere on it.
            'elev-2 bg-gradient-to-br from-[var(--primary)] to-[oklch(0.70_0.17_58)] text-[var(--primary-foreground)]'
          : 'card'
      )}
    >
      {/* A soft highlight, so a filled panel reads as a surface rather than a swatch. */}
      {busy && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/25 blur-2xl"
        />
      )}

      <div className="relative">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={cn('truncate text-base font-bold', !busy && 'text-foreground')}>
              {title}
            </h2>
            {subtitle && (
              <p
                className={cn(
                  'mt-0.5 text-xs',
                  busy ? 'text-[var(--primary-foreground)]/75' : 'text-muted-foreground'
                )}
              >
                {subtitle}
              </p>
            )}
          </div>
          {href && (
            <Link
              href={href}
              aria-label={title}
              className={cn(
                // 44px on a phone, like every other card arrow.
                '-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors sm:my-0 sm:mr-0 sm:h-9 sm:w-9',
                busy
                  ? 'bg-black/10 hover:bg-black/16'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">{children}</div>

        {footer && (
          <div
            className={cn(
              'mt-3 rounded-lg px-3 py-2 text-xs',
              busy
                ? 'bg-black/8 text-[var(--primary-foreground)]/90'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {footer}
          </div>
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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/5 group-data-[busy=true]/panel:bg-black/10"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="tabular block text-sm font-bold leading-tight">{count}</span>
        <span className="block truncate text-[0.6875rem] leading-tight text-muted-foreground group-data-[busy=true]/panel:text-[var(--primary-foreground)]/75">
          {label}
        </span>
      </span>
    </>
  );

  /*
   * On the filled panel the tile is a white scrim, not a black one. Measured on
   * the mango fill, black at 8% gives 1.18:1 against the panel behind it — which
   * is why the tiles read as ghosts — while white at 45% gives 1.37:1 and carries
   * the near-black label at 11.1:1. A dark veil works on a dark fill; this fill
   * is bright.
   */
  const className = cn(
    'flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors',
    'bg-muted group-data-[busy=true]/panel:bg-white/45',
    empty && 'opacity-70',
    href && 'hover:bg-subtle group-data-[busy=true]/panel:hover:bg-white/60'
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
