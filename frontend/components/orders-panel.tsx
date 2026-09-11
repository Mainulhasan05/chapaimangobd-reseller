'use client';

import { AlarmClock, PackageCheck, Truck, Wallet } from 'lucide-react';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatNumber, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Order, OrderItem, OrderStatus } from '@/lib/types';

/**
 * The furniture of the owner's order panel.
 *
 * The list itself was a table of facts with no shape to it: every row the same
 * weight, the only signal a coloured pill, and the counts that say what actually
 * needs doing today nowhere on the page. What is here gives it that shape - how
 * far along each order is, and how many are waiting at each point.
 */

/**
 * Fulfilment, in order.
 *
 * The owner's half of the journey. `pending` is the reseller's problem, and by
 * the time an order reaches this screen it has been confirmed, so the track
 * starts there. The two unhappy endings are not stages and are drawn differently.
 */
const STAGES: OrderStatus[] = ['confirmed', 'accepted', 'packed', 'shipped', 'delivered'];

const TERMINAL = new Set<OrderStatus>(['cancelled', 'returned']);

/**
 * How far along one order is, as five segments.
 *
 * A status pill says where an order is; it does not say how much is left. Five
 * segments answer both at a glance, which is what turns a column of identical
 * rows into something scannable: the nearly-finished orders look different from
 * the ones not started.
 */
export function StageTrack({ status }: { status: OrderStatus }) {
  const failed = TERMINAL.has(status);
  const reached = STAGES.indexOf(status);

  return (
    <span
      className="mt-1.5 flex items-center gap-0.5"
      role="img"
      aria-label={`${t('order.stage')}: ${tStatus(status)}`}
    >
      {STAGES.map((stage, index) => {
        const done = !failed && index <= reached;
        const current = !failed && index === reached;

        return (
          <span
            key={stage}
            className={cn(
              'h-1 w-4 rounded-full transition-colors',
              failed
                ? 'bg-danger/30'
                : done
                  ? current
                    ? // The current stage is the brighter one, so the eye lands
                      // on where the order actually is rather than on the run of
                      // completed segments behind it.
                      'bg-primary'
                    : 'bg-primary/45'
                  : 'bg-subtle'
            )}
          />
        );
      })}
    </span>
  );
}

export type StatusCounts = Partial<Record<OrderStatus, number>>;

/**
 * The four numbers worth looking at before touching anything, each a filter.
 *
 * A tile is not a decoration here. Awaiting acceptance is money the reseller has
 * already committed and the owner has not yet touched, and clicking it is the
 * fastest route to the only list that matters at nine in the morning. The aging
 * count is the same orders gone cold, which is the one number on this page that
 * represents fruit going soft in a crate.
 */
export function OrderTiles({
  counts,
  aging,
  active,
  agingActive,
  onPick,
  onPickAging,
}: {
  counts: StatusCounts;
  aging: number;
  /** The status filter currently applied, or the empty string for all. */
  active: string;
  agingActive: boolean;
  onPick: (status: string) => void;
  onPickAging: () => void;
}) {
  const inProgress =
    (counts.accepted ?? 0) + (counts.packed ?? 0) + (counts.shipped ?? 0);

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        icon={Wallet}
        tone="warning"
        label={t('owner.awaitingAcceptance')}
        value={counts.confirmed ?? 0}
        selected={active === 'confirmed' && !agingActive}
        onClick={() => onPick('confirmed')}
      />
      <Tile
        icon={Truck}
        tone="primary"
        label={t('order.inProgress')}
        value={inProgress}
        selected={active === 'accepted' && !agingActive}
        onClick={() => onPick('accepted')}
      />
      <Tile
        icon={PackageCheck}
        tone="success"
        label={t('order.delivered')}
        value={counts.delivered ?? 0}
        selected={active === 'delivered' && !agingActive}
        onClick={() => onPick('delivered')}
      />
      {/*
       * Confirmed orders gone stale. Drawn in the danger tone only when there
       * are any, because a permanent red zero trains people to ignore red.
       */}
      <Tile
        icon={AlarmClock}
        tone={aging > 0 ? 'danger' : 'neutral'}
        label={t('order.aging')}
        value={aging}
        selected={agingActive}
        onClick={onPickAging}
      />
    </div>
  );
}

const TONES = {
  warning: 'bg-warning-soft text-warning-ink',
  primary: 'bg-primary-softer text-primary-ink',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-subtle text-muted-foreground',
} as const;

const RINGS = {
  warning: 'ring-warning/50',
  primary: 'ring-primary/50',
  success: 'ring-success/50',
  danger: 'ring-danger/50',
  neutral: 'ring-border',
} as const;

function Tile({
  icon: Icon,
  tone,
  label,
  value,
  selected,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONES;
  label: string;
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'card group flex items-center gap-3 p-4 text-left transition-all',
        // Lifts a little on hover and holds a ring while it is the active
        // filter, so the tiles read as controls rather than as read-outs.
        'hover:-translate-y-0.5 hover:elev-2',
        selected ? cn('ring-2', RINGS[tone]) : 'ring-0'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105',
          TONES[tone]
        )}
      >
        <Icon className="h-5 w-5" />
      </span>

      <span className="min-w-0">
        <span className="tabular block text-2xl font-bold leading-none tracking-tight">
          {formatNumber(value)}
        </span>
        <span className="mt-1 block truncate text-xs font-semibold text-muted-foreground">
          {label}
        </span>
      </span>
    </button>
  );
}

/**
 * What was actually ordered, on the row.
 *
 * The list showed a code, a shop, a buyer, a figure and a status, and not one
 * word about mangoes. Answering "what is this order and how much of it" meant
 * opening every row in turn, which is the question the owner is asking on every
 * single one of them: it decides which crates to pull and from where.
 *
 * Read from the line snapshots, so an order renders what was bought at the price
 * and under the name agreed at the time, whatever the catalog says today.
 */
export function OrderItems({
  items,
  /** How many lines to spell out before collapsing the rest into a count. */
  limit = 2,
}: {
  items: OrderItem[];
  limit?: number;
}) {
  if (!items || items.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const shown = items.slice(0, limit);
  const hidden = items.length - shown.length;

  return (
    <div className="min-w-0">
      <ul className="space-y-0.5">
        {shown.map((item) => (
          <li key={item.id} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.productName}</span>
            {/*
             * The quantity carries the weight here, not the name. An owner
             * reading this column is working out what to collect, and five kilos
             * against three is the whole decision.
             */}
            <span className="tabular shrink-0 rounded bg-subtle px-1.5 py-0.5 text-xs font-semibold">
              {formatQuantity(item.quantity, item.unit)}
            </span>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('order.moreItems').replace('{n}', formatNumber(hidden))}
        </p>
      )}
    </div>
  );
}

/**
 * A one line version of the same thing, for the phone card.
 *
 * A card has no column to give this, so the lines are run together and the
 * quantity stays attached to each name rather than being summed: two kilos of
 * one mango and three of another is not five kilos of anything.
 */
export function OrderItemsInline({ items }: { items: OrderItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <p className="truncate text-sm">
      {items
        .map((item) => `${item.productName} ${formatQuantity(item.quantity, item.unit)}`)
        .join(' · ')}
    </p>
  );
}

/** The first product on an order, which is what the items column sorts by. */
export const firstProduct = (order: Order): string => order.items?.[0]?.productName ?? '';
