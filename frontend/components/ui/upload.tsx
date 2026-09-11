'use client';

import { Check, Trash2, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The parts an upload area is made of.
 *
 * Drawn as a tray: a soft recessed panel holding the button that adds files and
 * the list of what has been added. The recess is what separates it from the form
 * around it without another hairline box, which is the trick the reference
 * design uses and the reason its attachment area does not read as one more
 * field.
 *
 * `FileField` and `ImagesField` both build on these. Neither is replaced by
 * them, because a KYC document and a set of product photographs want different
 * bodies inside the same tray: one page you photograph once, versus a set you
 * add to and cull.
 */

/** Kilobytes under a megabyte, one decimal above it. Bengali digits, display only. */
export function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024))} ${t('file.kb')}`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} ${t('file.mb')}`;
}

/**
 * The recessed panel.
 *
 * `dragging` and `invalid` are drawn on the tray rather than on the rows inside
 * it, because the drop target is the whole panel and outlining anything smaller
 * makes people aim.
 */
export function UploadTray({
  dragging,
  invalid,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { dragging?: boolean; invalid?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-muted/60 p-3 transition-colors',
        dragging && 'border-primary bg-primary-softer',
        invalid && !dragging && 'border-danger',
        !dragging && !invalid && 'border-border',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The grey pill carrying a file's size.
 *
 * A size is a fact about a file, not a status, so it is the quietest chip in the
 * system: no ring, no colour, and it never competes with the name beside it.
 */
export function SizeChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * One file in the tray: a tick, its name, its size, and the way to remove it.
 *
 * While a file is uploading the trailing control cancels rather than deletes,
 * and it says so with a different glyph, because cancelling a transfer and
 * deleting something already stored are not the same promise.
 */
export function FileRow({
  name,
  size,
  progress,
  eta,
  onRemove,
  removeLabel,
  done = true,
}: {
  name: string;
  /** Bytes. Rendered through `humanSize`, or omitted entirely. */
  size?: number;
  /** 0 to 100 while transferring. Omit once the file is settled. */
  progress?: number;
  /** Seconds remaining, shown beside the percentage. */
  eta?: number;
  onRemove?: () => void;
  removeLabel?: string;
  /** Draws the leading tick. False while a transfer is still running. */
  done?: boolean;
}) {
  const uploading = typeof progress === 'number' && progress < 100;

  return (
    <div className="py-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center',
            done && !uploading ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          {done && !uploading ? (
            <Check className="h-4 w-4" strokeWidth={3} />
          ) : (
            <span className="h-2 w-2 rounded-full bg-current" />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>

        {typeof size === 'number' && <SizeChip>{humanSize(size)}</SizeChip>}

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel ?? t('file.remove')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface hover:text-danger"
          >
            {uploading ? <X className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
          </button>
        )}
      </div>

      {uploading && <ProgressBar value={progress} eta={eta} />}
    </div>
  );
}

/**
 * A transfer in progress.
 *
 * The percentage and the time remaining sit under the bar rather than inside it.
 * A label inside a bar is unreadable for the half of its life when the fill has
 * not yet reached it, and this app's audience is on connections where that half
 * lasts a while.
 */
export function ProgressBar({
  value,
  eta,
  className,
}: {
  value: number;
  /** Seconds remaining. */
  eta?: number;
  className?: string;
}) {
  const pct = Math.min(Math.max(value, 0), 100);

  return (
    <div className={cn('mt-1.5', className)}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-subtle"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="tabular mt-1 text-[0.6875rem] text-muted-foreground">
        {formatNumber(Math.round(pct))}%
        {typeof eta === 'number' && eta > 0 && (
          <> / {formatNumber(Math.round(eta))} {t('file.seconds')}</>
        )}
      </p>
    </div>
  );
}

/** The divider between rows in a tray, inset so it does not touch the edges. */
export function FileList({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 divide-y divide-border">{children}</div>;
}
