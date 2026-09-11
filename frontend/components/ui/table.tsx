'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDownUp, ArrowDown, ArrowUp, Check, Ellipsis, SlidersHorizontal } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';

/**
 * The desktop table, and the machinery around it.
 *
 * The chrome here is the visible half: a tinted sticky header, hairline row
 * rules, a hover tint, and a selected row that tints rather than outlines. The
 * other half is behaviour the old table did not have at all — sorting,
 * selection, per-user column visibility and a row overflow menu.
 *
 * All of it is desktop-only on purpose. `TableWrap` still hides itself below
 * `sm`, because a 42rem table inside a sideways scroller on a 360px screen puts
 * the action column off the right edge. Phones get the card list each page
 * renders instead, and the sort control is offered there as a plain select. No
 * behaviour in this file is the only way to reach a piece of data.
 */

/* ---------------------------------------------------------------- shell -- */

export function TableWrap({
  children,
  alwaysVisible,
  className,
}: {
  children: React.ReactNode;
  alwaysVisible?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'card scroll-x overflow-hidden p-0',
        alwaysVisible ? undefined : 'hidden sm:block',
        className
      )}
    >
      <table className="w-full min-w-[42rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'sticky top-0 z-10 border-b border-border bg-subtle px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn('border-b border-border px-4 py-3 align-middle last:border-b-0', className)}
      {...props}
    />
  );
}

/**
 * A row. `selected` tints rather than outlines, because an outline on one row of
 * a hairline-ruled table shifts every row below it by a pixel.
 */
export function Tr({
  selected,
  className,
  ...props
}: React.ComponentProps<'tr'> & { selected?: boolean }) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cn(
        'transition-colors',
        selected ? 'bg-primary-softer' : 'hover:bg-muted/70',
        className
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------- sorting -- */

export type SortDirection = 'asc' | 'desc';
export type SortState<K extends string> = { key: K; direction: SortDirection } | null;

/** Bengali labels do not sort correctly under a byte comparison. */
const collator = new Intl.Collator('bn-BD', { numeric: true, sensitivity: 'base' });

/**
 * Sorts rows in the browser, which is correct here and would not be on a bigger
 * table: every list in this app is already paginated by the API, so this orders
 * the page you are looking at rather than pretending to order the whole set.
 * The column header says so by sorting only what is loaded.
 */
export function useSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => string | number | null | undefined>,
  initial: SortState<K> = null
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const toggle = useCallback((key: K) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      // Third click clears, so a table can be returned to the server's order,
      // which for orders is newest first and is the order people actually want.
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;

    return [...rows].sort((left, right) => {
      const a = accessor(left);
      const b = accessor(right);
      // Empty cells sink to the bottom whichever way the column is pointing.
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor;
      return collator.compare(String(a), String(b)) * factor;
    });
    // `accessors` is an object literal at every call site, so depending on it
    // would re-sort on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { rows: sorted, sort, toggle, setSort };
}

/**
 * A header that sorts. The arrow is the state: a faded double arrow when the
 * column is available but inactive, a solid single arrow when it is the one in
 * use. `aria-sort` carries the same fact to a screen reader.
 */
export function SortTh<K extends string>({
  column,
  sort,
  onSort,
  children,
  align = 'left',
  className,
}: {
  column: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort?.key === column;
  const direction = active ? sort.direction : undefined;

  return (
    <Th
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(align === 'right' && 'text-right', 'p-0', className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'flex w-full items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors hover:text-foreground',
          align === 'right' && 'justify-end',
          active && 'text-foreground'
        )}
      >
        <span className="truncate">{children}</span>
        {!active && <ArrowDownUp aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-40" />}
        {active && direction === 'asc' && <ArrowUp aria-hidden className="h-3.5 w-3.5 shrink-0" />}
        {active && direction === 'desc' && (
          <ArrowDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
    </Th>
  );
}

/* ------------------------------------------------------------ selection -- */

/**
 * Which rows are ticked.
 *
 * Selection is scoped to the ids handed in, so a page change or a filter drops
 * anything no longer on screen rather than quietly carrying it into a bulk
 * action the user can no longer see.
 */
export function useSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(() => new Set(ids), [ids]);

  const pruned = useMemo(() => {
    const next = new Set<string>();
    selected.forEach((id) => {
      if (visible.has(id)) next.add(id);
    });
    return next;
  }, [selected, visible]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const allOn = ids.length > 0 && ids.every((id) => current.has(id));
      return allOn ? new Set() : new Set(ids);
    });
  }, [ids]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    selected: pruned,
    count: pruned.size,
    isSelected: (id: string) => pruned.has(id),
    allSelected: ids.length > 0 && pruned.size === ids.length,
    someSelected: pruned.size > 0 && pruned.size < ids.length,
    toggle,
    toggleAll,
    clear,
  };
}

/**
 * A real checkbox underneath, because the native control is what a screen
 * reader, a keyboard and a browser's form autofill all already understand. Only
 * the box is drawn over it.
 */
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  /** Never rendered. Present because a bare checkbox announces as nothing. */
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);

  return (
    <label className={cn('relative inline-flex cursor-pointer items-center', className)}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-[0.3rem] border-2 transition-colors',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
          checked || indeterminate
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-surface'
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3.5} />}
        {!checked && indeterminate && <span className="h-0.5 w-2.5 rounded-full bg-current" />}
      </span>
    </label>
  );
}

/* ----------------------------------------------------------- popup menu -- */

export type MenuItem = {
  label: string;
  onSelect: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'danger';
  disabled?: boolean;
};

/**
 * The row overflow menu.
 *
 * Hand-rolled for the same reason the modal is: what it has to get right is
 * behaviour, not styling. Escape closes and returns focus, a click anywhere else
 * closes, arrow keys move through the items, and the panel flips to the left
 * edge of the trigger so it never opens off the right side of the table.
 *
 * Everything in here is also reachable somewhere else on the page. A menu that
 * hides the only route to an action fails on a phone, where this table does not
 * render at all.
 */
export function RowMenu({ items, label }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // Opening with the keyboard should land on the first item, not on nothing.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const onItemKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = (index + step + items.length) % items.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label ?? t('app.actions')}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground'
        )}
      >
        <Ellipsis className="h-4 w-4" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="menu-in elev-3 absolute right-0 top-full z-40 mt-1 min-w-44 overflow-hidden rounded-xl border border-border bg-surface py-1"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onKeyDown={(event) => onItemKeyDown(event, index)}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
                item.tone === 'danger'
                  ? 'text-danger hover:bg-danger-soft'
                  : 'text-foreground hover:bg-muted'
              )}
            >
              {item.icon && <item.icon className="h-4 w-4 shrink-0 opacity-70" />}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------- column visibility -- */

export type ColumnDef<K extends string> = {
  key: K;
  label: string;
  /** A column the table cannot function without, so it cannot be switched off. */
  locked?: boolean;
};

/*
 * The stored column preference is browser state, not React state, so it is read
 * as an external store rather than copied into `useState` by an effect. Writes
 * from one table have to reach any other mounted copy of the same table, which
 * the `storage` event does not do, because it only fires in *other* tabs. Hence
 * the local listener set alongside it.
 */
const columnListeners = new Set<() => void>();

function subscribeToColumns(onChange: () => void) {
  columnListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    columnListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Which columns are showing, remembered per browser.
 *
 * The snapshot is the raw stored string rather than a parsed Set: React compares
 * snapshots with `Object.is`, and a fresh Set on every read would re-render for
 * ever. The server snapshot is null, so both the server and the first client
 * render agree on "everything visible" and the stored preference is applied on
 * the pass after hydration. Reading localStorage during the first render instead
 * would be a hydration mismatch, whose failure mode is a table that flickers its
 * columns on every load.
 */
export function useColumns<K extends string>(columns: ColumnDef<K>[], storageKey: string) {
  const key = `cols:${storageKey}`;

  const raw = useSyncExternalStore<string | null>(
    subscribeToColumns,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // A private window, or a browser set to block site data.
        return null;
      }
    },
    () => null
  );

  const hidden = useMemo(() => {
    const locked = new Set(columns.filter((column) => column.locked).map((column) => column.key));
    if (!raw) return new Set<K>();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set<K>();
      // A locked column is never hidden, whatever an older stored value says.
      return new Set(
        parsed.filter((entry): entry is K => typeof entry === 'string' && !locked.has(entry as K))
      );
    } catch {
      // A stored value from an older shape. Show everything rather than break.
      return new Set<K>();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const persist = useCallback(
    (next: Set<K>) => {
      try {
        window.localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // Preference lost on reload, table still correct. Acceptable.
      }
      columnListeners.forEach((listener) => listener());
    },
    [key]
  );

  const toggle = useCallback(
    (column: K) => {
      const next = new Set(hidden);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      persist(next);
    },
    [hidden, persist]
  );

  return {
    isVisible: (column: K) => !hidden.has(column),
    hidden,
    toggle,
    reset: () => persist(new Set()),
    columns,
  };
}

/** The gear. Opens the same popup shape as the row menu, with checkmarks. */
export function ColumnToggle<K extends string>({
  columns,
  isVisible,
  onToggle,
}: {
  columns: ColumnDef<K>[];
  isVisible: (key: K) => boolean;
  onToggle: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('app.columns')}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground'
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="menu-in elev-3 absolute right-0 top-full z-40 mt-1 min-w-48 overflow-hidden rounded-xl border border-border bg-surface py-1"
        >
          <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            {t('app.columns')}
          </p>
          {columns.map((column) => {
            const visible = isVisible(column.key);
            return (
              <button
                key={column.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={visible}
                disabled={column.locked}
                onClick={() => onToggle(column.key)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-40"
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border-2',
                    visible ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                  )}
                >
                  {visible && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
                </span>
                <span className="truncate">{column.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The strip that appears when rows are ticked. It replaces the toolbar rather
 * than stacking under it, so the count and the actions land where the user is
 * already looking.
 */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary-softer px-4 py-2.5">
      <span className="tabular text-sm font-semibold text-primary-ink">
        {count} {t('app.selected')}
      </span>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          {t('app.clear')}
        </button>
      </div>
    </div>
  );
}
