'use client';

/**
 * The date filter above a list, and the one shared idea of what a range is.
 *
 * Dates here are Dhaka business dates as `YYYY-MM-DD` strings, never `Date`
 * objects. That is what the API takes, what an order carries as its
 * `businessDate`, and what the rest of the system means by a day. Turning them
 * into `Date` on the way through is how the first six hours of every Dhaka day
 * end up filed under yesterday, so this module never does.
 */

import { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { businessDate, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type DateRange = { from: string; to: string } | null;

/** N days back from today, as a Dhaka business date. */
export function daysAgo(days: number): string {
  return businessDate(new Date(Date.now() - days * 86_400_000));
}

export function startOfMonth(): string {
  return `${businessDate().slice(0, 7)}-01`;
}

/**
 * The presets, in the order an owner reaches for them.
 *
 * Today leads because it is the answer to nearly every question asked of this
 * screen, and it is the default the page opens on. "All time" is last and is
 * the only one that sends no dates at all.
 */
export const RANGE_PRESETS = [
  { key: 'today', labelKey: 'range.today', build: (): DateRange => ({ from: businessDate(), to: businessDate() }) },
  { key: 'yesterday', labelKey: 'range.yesterday', build: (): DateRange => ({ from: daysAgo(1), to: daysAgo(1) }) },
  { key: 'last7', labelKey: 'range.last7', build: (): DateRange => ({ from: daysAgo(6), to: businessDate() }) },
  { key: 'last30', labelKey: 'range.last30', build: (): DateRange => ({ from: daysAgo(29), to: businessDate() }) },
  { key: 'thisMonth', labelKey: 'range.thisMonth', build: (): DateRange => ({ from: startOfMonth(), to: businessDate() }) },
  { key: 'all', labelKey: 'range.all', build: (): DateRange => null },
] as const;

export type PresetKey = (typeof RANGE_PRESETS)[number]['key'];

/** The range a preset names, or null for "all time". */
export function rangeOf(preset: PresetKey): DateRange {
  return RANGE_PRESETS.find((p) => p.key === preset)!.build();
}

/** `?from=…&to=…`, or an empty string. Safe to concatenate onto any query. */
export function rangeQuery(range: DateRange): string {
  if (!range) return '';
  return `&from=${range.from}&to=${range.to}`;
}

/** The same, as the first parameter of a query string. */
export function rangeParams(range: DateRange): string {
  if (!range) return '';
  return `from=${range.from}&to=${range.to}`;
}

/**
 * How a range reads to a person: one day is a date, a span is two.
 *
 * Printed at the top of every report, which is why it is here and not in the
 * report components: the screen and the sheet must describe the same days in
 * the same words, or the sheet cannot be checked against the screen.
 */
export function formatRange(range: DateRange): string {
  if (!range) return t('range.all');
  if (range.from === range.to) return formatDate(range.from);
  return `${formatDate(range.from)} – ${formatDate(range.to)}`;
}

/**
 * The control itself: presets as chips, with a custom range behind the last one.
 *
 * Presets rather than two date fields, because two date fields on a phone is
 * four taps and a keyboard to ask "what happened today", which is the question
 * this screen is opened for. The custom pair is still there, one tap away, for
 * the times it genuinely is a range.
 */
export function DateRangeFilter({
  preset,
  range,
  onChange,
  className,
}: {
  preset: PresetKey | 'custom';
  range: DateRange;
  onChange: (preset: PresetKey | 'custom', range: DateRange) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(preset === 'custom');
  /*
   * A draft, not the filter.
   *
   * The two fields are only committed when Apply is pressed, so typing a start
   * date does not fire a request for the half-second before the end date is
   * typed. The draft is seeded from whatever range is current at the moment the
   * panel opens, which is a user event — the same thing done in an effect would
   * re-run on every range change and cascade a render each time.
   */
  const [draft, setDraft] = useState(() => ({
    from: range?.from ?? businessDate(),
    to: range?.to ?? businessDate(),
  }));

  const backwards = draft.from > draft.to;

  const openPanel = () => {
    setDraft({ from: range?.from ?? businessDate(), to: range?.to ?? businessDate() });
    setOpen(true);
  };

  const apply = () => {
    if (backwards) return;
    onChange('custom', { ...draft });
    setOpen(false);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="radiogroup"
        aria-label={t('range.label')}
        className="scroll-x-bare flex max-w-full items-center gap-1 rounded-xl bg-muted p-1"
      >
        {RANGE_PRESETS.map((option) => {
          const active = preset === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setOpen(false);
                onChange(option.key, option.build());
              }}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-surface text-foreground elev-1'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(option.labelKey)}
            </button>
          );
        })}

      </div>

      {/*
       * Outside the radio group on purpose. The presets choose between ranges;
       * this opens a panel, which is a disclosure, and a radio that also claims
       * `aria-expanded` describes itself as two different controls at once.
       */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          'flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
          preset === 'custom'
            ? 'border-primary bg-primary-softer text-primary-ink'
            : 'border-border text-muted-foreground hover:text-foreground'
        )}
      >
        <CalendarDays className="h-4 w-4" />
        {preset === 'custom' && range ? formatRange(range) : t('range.custom')}
      </button>

      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
          <label className="flex min-w-[8.5rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t('range.from')}
            <input
              type="date"
              value={draft.from}
              max={draft.to}
              onChange={(event) =>
                setDraft((current) => ({ ...current, from: event.target.value }))
              }
              className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
          <label className="flex min-w-[8.5rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t('range.to')}
            <input
              type="date"
              value={draft.to}
              min={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
          <Button size="sm" onClick={apply} disabled={backwards}>
            {t('range.apply')}
          </Button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('app.clear')}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
          {backwards && (
            <p className="w-full text-xs text-danger">{t('range.invalid')}</p>
          )}
        </div>
      )}
    </div>
  );
}
