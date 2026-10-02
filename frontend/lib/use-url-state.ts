'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { RANGE_PRESETS, type DateRange, type PresetKey } from '@/components/ui/date-range';
import { useDebounced } from '@/lib/use-debounced';

type Primitive = string | number | boolean;
type Defaults = Record<string, Primitive>;

/**
 * The query string most recently asked for, until the router has written it.
 *
 * `router.replace` does not touch `window.location` straight away: the App
 * Router writes history after the render commits. Two updates in one handler
 * ("clear filters" resetting the filters and then the date range) both read the
 * old address, and the second overwrote the first. Each update now builds on
 * the last one asked for, for as long as the address has not caught up with it.
 */
let pending: { pathname: string; query: string; at: number } | null = null;
const PENDING_MS = 2000;

function currentParams(pathname: string): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  const live = window.location.search.replace(/^\?/, '');
  if (pending) {
    const fresh = pending.pathname === pathname && Date.now() - pending.at < PENDING_MS;
    // Caught up, or stale (Back, another page): the address is the truth again.
    if (!fresh || live === pending.query) pending = null;
  }
  return new URLSearchParams(pending ? pending.query : live);
}

function parse<T extends Primitive>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  if (typeof fallback === 'number') {
    const value = Number(raw);
    return (Number.isFinite(value) ? value : fallback) as T;
  }
  if (typeof fallback === 'boolean') return (raw === '1' || raw === 'true') as T;
  return raw as T;
}

function serialise(value: Primitive): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

/**
 * Filter state that lives in the URL.
 *
 * Every list used to hold its filters in component state, so opening an order
 * and coming back reset the queue to its first tab with the search cleared, and
 * a dashboard tile could only ever open the unfiltered list. Kept in the query
 * string instead, Back restores the list exactly, a link can open it already
 * filtered, and a reload keeps the owner's place.
 *
 * Values equal to their default are left out of the URL, so an untouched page
 * keeps a clean address. Updates use `replace`, not `push`: flipping through
 * five tabs must not take five presses of Back to leave the page.
 *
 * Parameters this hook does not know about are kept, so two hooks on one page
 * (a list's filters and a sheet's open record) do not erase each other.
 */
export function useUrlState<T extends Defaults>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Stable for the life of the page: the defaults are a literal at the call site.
  const [initial] = useState(defaults);

  const state = useMemo(() => {
    const out = {} as T;
    (Object.keys(initial) as (keyof T)[]).forEach((key) => {
      out[key] = parse(searchParams.get(key as string), initial[key]);
    });
    return out;
  }, [searchParams, initial]);

  const set = useCallback(
    (patch: Partial<T> | ((current: T) => Partial<T>)) => {
      const params = currentParams(pathname);
      const read = {} as T;
      (Object.keys(initial) as (keyof T)[]).forEach((key) => {
        read[key] = parse(params.get(key as string), initial[key]);
      });
      const next = typeof patch === 'function' ? patch(read) : patch;
      Object.entries(next).forEach(([key, value]) => {
        if (value === undefined || value === initial[key]) params.delete(key);
        else params.set(key, serialise(value as Primitive));
      });
      const query = params.toString();
      pending = { pathname, query, at: Date.now() };
      router.replace(`${pathname}${query ? `?${query}` : ''}` as Route, { scroll: false });
    },
    [initial, pathname, router]
  );

  const reset = useCallback(() => set({ ...initial }), [initial, set]);

  /** How many of the given keys differ from their default: the "ফিল্টার (n)" badge. */
  const activeCount = useCallback(
    (keys: (keyof T)[] = Object.keys(initial) as (keyof T)[]) =>
      keys.filter((key) => state[key] !== initial[key]).length,
    [initial, state]
  );

  return [state, set, { reset, activeCount, defaults: initial }] as const;
}

/**
 * A date range in the URL, as a preset or as explicit dates.
 *
 * A preset is stored by name and turned into dates on every render, never stored
 * as dates: "today" saved on Monday must still mean today when the link is
 * opened on Tuesday. Only a custom range carries `from` and `to`.
 */
export function useUrlRange(defaultPreset: PresetKey) {
  const [state, set] = useUrlState({ range: defaultPreset as string, from: '', to: '' });

  const preset = (
    state.range === 'custom' || RANGE_PRESETS.some((p) => p.key === state.range)
      ? state.range
      : defaultPreset
  ) as PresetKey | 'custom';

  const range: DateRange = useMemo(() => {
    if (preset === 'custom') {
      return state.from && state.to ? { from: state.from, to: state.to } : null;
    }
    return RANGE_PRESETS.find((p) => p.key === preset)!.build();
  }, [preset, state.from, state.to]);

  const setRange = useCallback(
    (nextPreset: PresetKey | 'custom', nextRange: DateRange) => {
      if (nextPreset === 'custom' && nextRange) {
        set({ range: 'custom', from: nextRange.from, to: nextRange.to });
      } else {
        set({ range: nextPreset, from: '', to: '' });
      }
    },
    [set]
  );

  return { preset, range, setRange, isDefault: preset === defaultPreset };
}

/**
 * A search box backed by the URL.
 *
 * The input answers every keystroke from local state; the URL, and so the
 * request, follows once typing pauses. Coming back to the page refills the box
 * from the URL.
 */
export function useUrlSearch(key = 'q', delay = 350) {
  const [state, set] = useUrlState({ [key]: '' } as Record<string, string>);
  const committed = state[key] ?? '';
  const [input, setInput] = useState(committed);
  const settled = useDebounced(input, delay);

  useEffect(() => {
    if (settled.trim() !== committed) set({ [key]: settled.trim() });
    // Only the settled input drives the URL; `committed` changing (Back) is
    // handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  // Back or a link changed the URL under the box: show what it now says.
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) {
    setSeen(committed);
    if (input.trim() !== committed) setInput(committed);
  }

  return { input, setInput, term: committed };
}
