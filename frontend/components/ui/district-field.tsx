'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import {
  DISTRICTS,
  districtLabel,
  districtMatches,
  findDistrict,
  type District,
} from '@/lib/districts';
import { Input } from '@/components/ui/form';

/**
 * Choosing among sixty-four districts.
 *
 * A native `<select>` of sixty-four rows is a wheel a customer spins past their
 * own district twice on a cheap Android, which is why this is a combobox with a
 * search box at the top: type two letters in either script and the list is three
 * rows long. The search is the point of the component, not a decoration.
 *
 * `deliverable`, where it is given, is the set of districts the owner's delivery
 * zones actually cover. All sixty-four are still listed: a district that is
 * missing from a dropdown tells a customer nothing, while a district marked "we
 * do not deliver here yet" tells them exactly what happened and saves them the
 * refusal at checkout (the API answers `NO_ZONE` for the same reason).
 */
export function DistrictSelect({
  id,
  value,
  onChange,
  deliverable,
  disabled,
  invalid,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Stored values the owner delivers to. Omit to treat every district as fine. */
  deliverable?: readonly string[];
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const allowed = useMemo(
    () => (deliverable ? new Set(deliverable.map((d) => d.trim().toLowerCase())) : null),
    [deliverable]
  );
  const isDeliverable = (district: District) =>
    !allowed || allowed.has(district.value.toLowerCase());

  /*
   * Deliverable districts first, each group still in division order. Someone
   * scrolling rather than typing should reach a district they can actually
   * order to without passing the ones they cannot.
   */
  const matches = useMemo(() => {
    const found = DISTRICTS.filter((d) => districtMatches(d, term));
    if (!allowed) return found;
    return [...found.filter(isDeliverable), ...found.filter((d) => !isDeliverable(d))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, allowed]);

  // A click anywhere else closes it. The panel is inline rather than in a
  // portal, so this is the whole of the dismissal logic.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Opening puts the cursor in the search box: opening this at all is almost
  // always the first half of typing a district name.
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const selected = findDistrict(value);
  const selectedUnavailable = Boolean(value) && !!allowed && !allowed.has(value.toLowerCase());

  const choose = (district: District) => {
    onChange(district.value);
    setTerm('');
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className={cn(
          'control flex h-11 w-full items-center gap-2 px-3 text-left text-base sm:h-10 sm:text-sm',
          'disabled:text-muted-foreground'
        )}
        data-invalid={invalid || undefined}
      >
        <span className={cn('flex-1 truncate', !value && 'text-muted-foreground')}>
          {value ? districtLabel(value) : (placeholder ?? t('district.choose'))}
        </span>
        {selected && (
          <span className="shrink-0 text-xs text-muted-foreground">{selected.divisionBn}</span>
        )}
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {/* A district the owner has stopped delivering to, still on this order. */}
      {selectedUnavailable && (
        <p className="mt-1 text-xs font-medium text-warning-ink">{t('district.noDelivery')}</p>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border-2 border-border bg-card shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              ref={search}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t('district.search')}
              icon={Search}
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false);
                // Enter takes the first match, which is what typing a whole
                // district name and pressing go should obviously do.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const first = matches.find(isDeliverable) ?? matches[0];
                  if (first) choose(first);
                }
              }}
              trailing={
                term ? (
                  <X
                    className="h-4 w-4 cursor-pointer text-muted-foreground"
                    onClick={() => {
                      setTerm('');
                      search.current?.focus();
                    }}
                  />
                ) : undefined
              }
            />
          </div>

          <ul role="listbox" aria-labelledby={id} className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('district.noMatch')}
              </li>
            )}

            {matches.map((district) => {
              const available = isDeliverable(district);
              const isSelected = district.value === value;
              return (
                <li key={district.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={!available}
                    onClick={() => choose(district)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm',
                      available ? 'hover:bg-muted' : 'cursor-not-allowed opacity-55',
                      isSelected && 'bg-primary-softer'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{district.bn}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {district.divisionBn}
                        {!available && ` · ${t('district.noDelivery')}`}
                      </span>
                    </span>
                    {isSelected && <Check aria-hidden className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Picking many districts at once, for the owner assigning them to a zone.
 *
 * The same sixty-four and the same search. It replaces a textarea where the
 * owner typed district names by hand, which meant one typo took a district out
 * of delivery with nothing on any screen to say so.
 *
 * Districts already on a zone that are not among the sixty-four are kept and
 * shown as chips, never silently dropped: they are live data, and a zone editor
 * that quietly forgets half a zone on open is worse than one that cannot spell.
 */
export function DistrictMultiSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [term, setTerm] = useState('');

  const chosen = useMemo(() => new Set(value.map((d) => d.trim().toLowerCase())), [value]);
  const matches = useMemo(() => DISTRICTS.filter((d) => districtMatches(d, term)), [term]);

  // Names on this zone that this list does not know. Written before the list
  // existed, or typed by hand, and they still route real orders.
  const unknown = value.filter((d) => !findDistrict(d));

  const toggle = (district: District) => {
    onChange(
      chosen.has(district.value.toLowerCase())
        ? value.filter((d) => d.trim().toLowerCase() !== district.value.toLowerCase())
        : [...value, district.value]
    );
  };

  return (
    <div>
      <Input
        id={id}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t('district.search')}
        icon={Search}
        autoComplete="off"
        className="mb-2"
      />

      <p className="mb-2 text-xs text-muted-foreground">
        {t('district.selectedCount').replace('{n}', String(value.length))}
      </p>

      {unknown.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {unknown.map((name) => (
            <li
              key={name}
              className="flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning-ink"
            >
              {name}
              <button
                type="button"
                aria-label={`${t('app.clear')} ${name}`}
                onClick={() => onChange(value.filter((d) => d !== name))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul className="max-h-64 overflow-y-auto rounded-xl border-2 border-border">
        {matches.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('district.noMatch')}
          </li>
        )}

        {matches.map((district) => {
          const isChosen = chosen.has(district.value.toLowerCase());
          return (
            <li key={district.value} className="border-b border-border last:border-0">
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                  checked={isChosen}
                  onChange={() => toggle(district)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{district.bn}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {district.divisionBn}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
