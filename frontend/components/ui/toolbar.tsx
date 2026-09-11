'use client';

import { Search, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';

/**
 * The strip above a list: filters on the left, search and controls on the right.
 *
 * It wraps rather than scrolls. A toolbar that scrolls sideways hides its own
 * controls, which is the problem the old header navigation had, and this sits on
 * pages where the filter is often the reason the page was opened at all.
 */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>{children}</div>
  );
}

/** Pushes everything after it to the right edge, on wide viewports only. */
export function ToolbarSpacer() {
  return <div className="hidden flex-1 sm:block" />;
}

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Rendered as a count chip after the label. Zero is hidden, not shown as 0. */
  count?: number;
};

/**
 * A row of mutually exclusive filters.
 *
 * Tabs in appearance, radios in behaviour, so arrow keys move between them and a
 * screen reader announces one of several rather than a row of unrelated buttons.
 * `radiogroup` rather than `tablist` because nothing here controls a panel: it
 * filters a list that is always present.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for a screen reader, e.g. "order status". */
  label: string;
  className?: string;
}) {
  const move = (event: React.KeyboardEvent, index: number) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'scroll-x-bare flex max-w-full items-center gap-1 rounded-xl bg-muted p-1',
        className
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => move(event, index)}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-surface text-foreground elev-1'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
            {option.count ? (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 text-xs font-semibold',
                  active ? 'bg-primary-soft text-primary-ink' : 'bg-subtle text-muted-foreground'
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Search, with the magnifier inside the field and a clear button once there is
 * something to clear. Type `search` so mobile keyboards offer a search key and
 * so the browser's own clear affordance is suppressed in favour of ours, which
 * meets the tap floor.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={cn('relative min-w-0 flex-1 sm:max-w-64 sm:flex-none', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t('app.search')}
        aria-label={placeholder ?? t('app.search')}
        className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-9 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('app.clear')}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * The phone-side equivalent of clicking a column header.
 *
 * The desktop table sorts by header click, and the card list below `sm` has no
 * headers to click. Without this, sorting would be a feature that exists only on
 * a device most of this app's users do not have.
 */
export function SortSelect<K extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: K; label: string }[];
  value: K | '';
  onChange: (value: K | '') => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as K | '')}
      aria-label={t('app.sortBy')}
      className={cn(
        'h-11 rounded-xl border border-border bg-surface px-3 text-base text-foreground focus:border-ring focus:outline-none sm:hidden',
        className
      )}
    >
      <option value="">{t('app.sortBy')}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
