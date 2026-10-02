'use client';

import { AlarmClock, PackageCheck, Truck, Wallet } from 'lucide-react';
import { t, tStatus, type DictKey } from '@/lib/i18n/bn';
import { formatNumber, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RANGE_PRESETS, type DateRange, type PresetKey } from '@/components/ui/date-range';
import type { OwnerOrdersArgs } from '@/lib/store/endpoints/orders';
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

/*
 * One name per status on the owner's screens, and it is the name of what the
 * order is waiting for. The tab said "নিশ্চিত" while the tile above it said
 * "গ্রহণের অপেক্ষায়" about the same orders, and the card said a third thing;
 * the owner reads every one of these as "what do I do next".
 */
const OWNER_STATUS: Record<OrderStatus, DictKey> = {
  pending: 'orders.status.pending',
  confirmed: 'owner.awaitingAcceptance',
  accepted: 'orders.status.accepted',
  packed: 'orders.status.packed',
  shipped: 'orders.status.shipped',
  delivered: 'order.delivered',
  returned: 'order.returned',
  cancelled: 'order.cancelled',
};

/** A status as the owner's list, tabs, cards and detail name it. */
export function ownerStatusLabel(status: OrderStatus | string): string {
  const key = OWNER_STATUS[status as OrderStatus];
  return key ? t(key) : tStatus(status);
}

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
      aria-label={`${t('order.stage')}: ${ownerStatusLabel(status)}`}
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

/* ------------------------------------------------------------- the queue -- */

/** Every status the owner works with. Pending is the reseller's and is its own tab. */
export const OWNER_STATUSES = 'confirmed,accepted,packed,shipped,delivered,returned,cancelled';

/** What the "চলমান" tile opens: everything accepted and not yet arrived. */
export const IN_PROGRESS = 'accepted,packed,shipped';

/** The tabs, in the order the work happens. The empty value is "all but pending". */
export const ORDER_TABS: { value: string; label: () => string }[] = [
  { value: 'confirmed', label: () => ownerStatusLabel('confirmed') },
  { value: 'accepted', label: () => ownerStatusLabel('accepted') },
  { value: 'packed', label: () => ownerStatusLabel('packed') },
  { value: 'shipped', label: () => ownerStatusLabel('shipped') },
  { value: 'delivered', label: () => ownerStatusLabel('delivered') },
  { value: 'returned', label: () => ownerStatusLabel('returned') },
  { value: 'cancelled', label: () => ownerStatusLabel('cancelled') },
  { value: '', label: () => t('app.all') },
];

/** The queues a parcel is still moving through, which are worked oldest first. */
const FULFILMENT = new Set(['confirmed', 'accepted', 'packed', 'shipped', IN_PROGRESS]);

export const defaultSort = (status: string, aging: boolean): 'oldest' | 'newest' =>
  aging || FULFILMENT.has(status) ? 'oldest' : 'newest';

export type OrdersQueue = {
  /** The tab as the URL holds it: '' is "all", which still leaves out pending. */
  status: string;
  aging: boolean;
  q: string;
  source: string;
  reseller: string;
  sort: 'oldest' | 'newest';
  preset: PresetKey | 'custom';
  range: DateRange;
  /** What the list asks the API for. Identical queues share one cache entry. */
  args: OwnerOrdersArgs;
};

/**
 * The owner's order list, read from a query string.
 *
 * One reader for the list page and the order page, so "পরের অর্ডার" on an order
 * walks exactly the list the owner came from, from the same cache entry, and
 * the back arrow can rebuild that list when there is no history to go back to.
 *
 * Arriving from an orchard or a reseller with no status asks about their whole
 * history, so the tab falls back to "all"; everything else opens on the queue
 * that needs the owner first.
 */
export function readOrdersQueue(params: URLSearchParams): OrdersQueue {
  const source = params.get('source') ?? '';
  const reseller = params.get('reseller') ?? '';
  const q = params.get('q') ?? '';
  const aging = params.get('aging') === '1' || params.get('aging') === 'true';
  const status = params.has('status')
    ? (params.get('status') ?? '')
    : source || reseller
      ? ''
      : 'confirmed';

  const rawSort = params.get('sort');
  const sort = rawSort === 'oldest' || rawSort === 'newest' ? rawSort : defaultSort(status, aging);

  const rawPreset = params.get('range') ?? 'all';
  const preset = (
    rawPreset === 'custom' || RANGE_PRESETS.some((p) => p.key === rawPreset) ? rawPreset : 'all'
  ) as PresetKey | 'custom';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const range: DateRange =
    preset === 'custom'
      ? from && to
        ? { from, to }
        : null
      : RANGE_PRESETS.find((p) => p.key === preset)!.build();

  return {
    status,
    aging,
    q,
    source,
    reseller,
    sort,
    preset,
    range,
    args: {
      // Aging is "confirmed and stale"; the server ignores any other status with it.
      status: aging ? 'confirmed' : status || OWNER_STATUSES,
      aging: aging || undefined,
      q: q || undefined,
      source: source || undefined,
      reseller: reseller || undefined,
      from: range?.from,
      to: range?.to,
      sort,
    },
  };
}

/* ----------------------------------------------------------------- tiles -- */

/**
 * The four numbers worth looking at before touching anything, each a filter.
 *
 * A tile is not a decoration here. Awaiting acceptance is money the reseller has
 * already committed and the owner has not yet touched, and clicking it is the
 * fastest route to the only list that matters at nine in the morning. The aging
 * count is the same orders gone cold, which is the one number on this page that
 * represents fruit going soft in a crate.
 *
 * `counts` is undefined while the summary loads or after it failed: a tile then
 * says "—" rather than a confident zero.
 */
export function OrderTiles({
  counts,
  aging,
  active,
  agingActive,
  onPick,
  onPickAging,
  className,
}: {
  counts: StatusCounts | undefined;
  aging: number | undefined;
  /** The status filter currently applied, or the empty string for all. */
  active: string;
  agingActive: boolean;
  onPick: (status: string) => void;
  onPickAging: () => void;
  className?: string;
}) {
  const inProgress = counts
    ? (counts.accepted ?? 0) + (counts.packed ?? 0) + (counts.shipped ?? 0)
    : undefined;

  return (
    <div className={cn('mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      <Tile
        icon={Wallet}
        tone="warning"
        label={ownerStatusLabel('confirmed')}
        value={counts ? (counts.confirmed ?? 0) : undefined}
        selected={active === 'confirmed' && !agingActive}
        onClick={() => onPick('confirmed')}
      />
      <Tile
        icon={Truck}
        tone="primary"
        label={t('order.inProgress')}
        value={inProgress}
        selected={active === IN_PROGRESS && !agingActive}
        onClick={() => onPick(IN_PROGRESS)}
      />
      <Tile
        icon={PackageCheck}
        tone="success"
        label={ownerStatusLabel('delivered')}
        value={counts ? (counts.delivered ?? 0) : undefined}
        selected={active === 'delivered' && !agingActive}
        onClick={() => onPick('delivered')}
      />
      {/*
       * Confirmed orders gone stale. Drawn in the danger tone only when there
       * are any, because a permanent red zero trains people to ignore red.
       */}
      <Tile
        icon={AlarmClock}
        tone={aging ? 'danger' : 'neutral'}
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
  value: number | undefined;
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
        <span
          className={cn(
            'tabular block text-2xl font-bold leading-none tracking-tight',
            value === undefined && 'text-muted-foreground'
          )}
        >
          {value === undefined ? t('app.notAvailable') : formatNumber(value)}
        </span>
        <span className="mt-1 block truncate text-xs font-semibold text-muted-foreground">
          {label}
        </span>
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------- items -- */

/**
 * One line as the packing table counts it: which box and how many of them.
 *
 * Boxes, not kilos, because a box is what gets pulled off the stack; a line
 * from before boxes existed has only its weight and reads as it always did.
 * See docs/adr/0021.
 */
export function itemAmount(item: OrderItem): string {
  if (item.boxes == null) return formatQuantity(item.quantity, item.unit);
  const box = item.variantLabel ?? t('orders.box');
  return `${box} × ${formatNumber(item.boxes)}`;
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
             * The count carries the weight here, not the name. An owner reading
             * this column is working out what to collect, and two boxes against
             * three is the whole decision.
             */}
            <span className="tabular shrink-0 rounded bg-subtle px-1.5 py-0.5 text-xs font-semibold">
              {itemAmount(item)}
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
 * A card has no column to give this, so the first line is spelled out with its
 * boxes and the rest become "+N": two names and two box counts run together on
 * a 360px card were cut off mid-word, which hid exactly the number that matters.
 */
export function OrderItemsInline({ items }: { items: OrderItem[] }) {
  if (!items || items.length === 0) return null;
  const [first, ...rest] = items;

  return (
    <p className="flex min-w-0 items-baseline gap-2 text-sm">
      <span className="min-w-0 truncate font-medium">{first.productName}</span>
      <span className="tabular shrink-0 font-semibold">{itemAmount(first)}</span>
      {rest.length > 0 && (
        <span
          className="tabular shrink-0 rounded bg-subtle px-1.5 text-xs font-semibold text-muted-foreground"
          title={rest.map((item) => `${item.productName} ${itemAmount(item)}`).join(' · ')}
        >
          +{formatNumber(rest.length)}
        </span>
      )}
    </p>
  );
}

/** The first product on an order, which is what the items column sorts by. */
export const firstProduct = (order: Order): string => order.items?.[0]?.productName ?? '';

/** The shop an order came through, when the API populated it. */
export const shopOf = (order: Order) =>
  typeof order.reseller === 'object' && order.reseller ? order.reseller : null;
