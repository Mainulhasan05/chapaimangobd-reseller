'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { skipToken } from '@reduxjs/toolkit/query/react';
import {
  AlarmClock,
  Ban,
  CircleCheckBig,
  ClipboardList,
  Eye,
  MessageSquareWarning,
  Printer,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { districtLabel } from '@/lib/districts';
import { formatMoney, formatAge, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUrlRange, useUrlSearch, useUrlState } from '@/lib/use-url-state';
import { LIVE, LIST } from '@/lib/store/api';
import { qs } from '@/lib/store/base-query';
import { useAppDispatch } from '@/lib/store/hooks';
import {
  ordersApi,
  useAcceptOrderMutation,
  useDeliverOrderMutation,
  useGetOrdersSummaryQuery,
  useGetOwnerOrdersInfiniteQuery,
  usePackOrderMutation,
  useShipOrderMutation,
} from '@/lib/store/endpoints/orders';
import { useGetSourceQuery } from '@/lib/store/endpoints/catalog';
import { useGetResellerQuery } from '@/lib/store/endpoints/people';
import type { Order, OrderStatus } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  Checkbox,
  ColumnToggle,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  Person,
  PhoneLink,
  RowMenu,
  SelectionBar,
  SortTh,
  statusTone,
  TableWrap,
  Td,
  Th,
  Tr,
  useColumns,
  useSelection,
  useSort,
  type ColumnDef,
  type MenuItem,
} from '@/components/ui/layout';
import { SearchInput, Segmented, Toolbar } from '@/components/ui/toolbar';
import { DateRangeFilter, formatRange } from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Button, ButtonLink } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { LoadMore } from '@/components/ui/load-more';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { BulkAcceptModal, rememberSources } from '@/components/accept-order-modal';
import { BulkShipModal } from '@/components/ship-order-modal';
import { BulkDeliverSheet, primaryActionOf, useOrderActions } from '@/components/order-actions';
import {
  defaultSort,
  firstProduct,
  IN_PROGRESS,
  OrderItems,
  OrderItemsInline,
  OrderTiles,
  ORDER_TABS,
  ownerStatusLabel,
  readOrdersQueue,
  shopOf,
  StageTrack,
} from '@/components/orders-panel';

/** One figure in the strip under the toolbar. */
function MoneyCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2">
      <p className="truncate text-[0.6875rem] font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-base font-bold leading-tight">{value}</p>
    </div>
  );
}

type SortKey = 'code' | 'reseller' | 'customer' | 'items' | 'amount' | 'status';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'code', label: t('order.code'), locked: true },
  { key: 'reseller', label: t('nav.resellers') },
  { key: 'customer', label: t('order.customer') },
  { key: 'items', label: t('order.items') },
  { key: 'amount', label: t('orders.toCollect') },
  { key: 'status', label: t('app.status') },
];

/** When an order joined the queue, which is what "new" is measured against. */
const joinedAt = (order: Order): string => order.confirmedAt ?? order.createdAt;

/** What the courier brings back, or a plain statement that it brings back nothing. */
function CollectAmount({ order, compact }: { order: Order; compact?: boolean }) {
  if (order.paymentMode !== 'cod') {
    return <p className="text-sm font-semibold text-success">{t('orders.prepaidShort')}</p>;
  }
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{t('orders.courierCollectsShort')} </span>
      <span className={cn('tabular font-bold text-warning-ink', compact ? 'text-base' : 'text-lg')}>
        {formatMoney(order.totals.customerTotal)}
      </span>
    </p>
  );
}

export default function OwnerOrdersPage() {
  const toast = useToast();
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  /*
   * Every filter is in the URL, so opening an order and coming back, or a
   * dashboard tile linking here, lands on exactly this list. The status default
   * is a value no tab uses, so a tapped tab is always written out: the empty
   * URL means "the queue", or "everything" when arriving from an orchard or a
   * reseller (see `readOrdersQueue`).
   */
  const [, setUrl] = useUrlState({ status: '-', aging: false as boolean, source: '', reseller: '', sort: '' });
  const { setRange } = useUrlRange('all');
  const { input, setInput } = useUrlSearch('q');
  const queue = useMemo(() => readOrdersQueue(new URLSearchParams(search)), [search]);
  const { status, aging, source, reseller, range, preset, args } = queue;
  const listKey = qs(args);

  const orders = useGetOwnerOrdersInfiniteQuery(args, LIVE);

  /*
   * Counts and money for the tabs and tiles. The counts carry every filter
   * except status, so a tab promises the number you get when you press it; the
   * money is scoped to the tab, so the strip is about the orders on screen.
   */
  const summary = useGetOrdersSummaryQuery({
    status: args.status,
    q: args.q,
    source: args.source,
    reseller: args.reseller,
    from: args.from,
    to: args.to,
  });
  const counts = summary.data?.byStatus;
  const money = summary.data?.money;

  // Arriving from an orchard or a reseller: the list has to say whose orders these are.
  const sourceDetail = useGetSourceQuery(source ? { id: source } : skipToken);
  const resellerDetail = useGetResellerQuery(reseller ? { id: reseller } : skipToken);

  const loaded = useMemo(() => orders.data?.pages.flatMap((page) => page.orders) ?? [], [orders.data]);
  const total = orders.data?.pages[0]?.total ?? 0;
  const fresh = orders.currentData !== undefined;

  /*
   * A poll never reorders rows under the thumb.
   *
   * The queue refreshes every minute. An order arriving mid-scroll used to
   * appear at the top and shove the row about to be tapped down by a card, so
   * "accept" landed on the wrong order. New arrivals are held back behind a
   * "নতুন N অর্ডার" bar until asked for; rows already on screen still update in
   * place, and rows that left the queue still go. "New" is measured on the
   * server's own clock, against the newest order on screen when the list was
   * last taken in, so older rows pulled up by a removal never count as new.
   *
   * Only a newest-first list needs this. The fulfilment queues run oldest
   * first, where an arrival joins the end and moves nothing above it.
   */
  const [mark, setMark] = useState<{ key: string; at: string; pages: number } | null>(null);
  const pageCount = orders.currentData?.pages.length ?? 0;
  const newestLoaded = loaded.reduce((max, order) => (joinedAt(order) > max ? joinedAt(order) : max), '');
  if (fresh && (mark?.key !== listKey || mark.pages !== pageCount || (!mark.at && loaded.length))) {
    setMark({ key: listKey, at: newestLoaded, pages: pageCount });
  }
  const held =
    fresh && args.sort === 'newest' && mark?.key === listKey && mark.at
      ? loaded.filter((order) => joinedAt(order) > mark.at)
      : [];
  const shown = held.length ? loaded.filter((order) => !held.includes(order)) : loaded;
  const showHeld = () => setMark({ key: listKey, at: newestLoaded, pages: pageCount });

  /*
   * Sorting by a column header reorders what is loaded, not what exists: the
   * list is paged and sorted by the server (oldest first in the fulfilment
   * tabs). Only the desktop table offers it.
   */
  const sorting = useSort<Order, SortKey>(shown, {
    code: (order) => order.orderCode,
    reseller: (order) => shopOf(order)?.shopName ?? '',
    customer: (order) => order.customer.name,
    items: firstProduct,
    amount: (order) => order.totals.customerTotal,
    status: (order) => ownerStatusLabel(order.status),
  });
  const rows = sorting.rows;
  const rowIds = useMemo(() => rows.map((order) => order.id), [rows]);
  const selection = useSelection(rowIds);
  const columns = useColumns(COLUMNS, 'owner-orders');

  /** The order's own page, carrying this list so its "next" and "back" know where they are. */
  const detailHref = (order: Order) =>
    // Always carried, even when empty: an empty list is the default queue, and
    // the order page needs to know it came from one to offer "পরের অর্ডার".
    `/owner/orders/${order.id}?list=${encodeURIComponent(search)}` as Route;

  /*
   * After a sheet closes, the next row's main button takes focus, so a keyboard
   * or a switch user works down the queue without hunting for their place. The
   * acted-on row has usually gone by then, so the target is picked when the
   * action starts.
   */
  const focusAfter = useRef<string | null>(null);
  const pickNext = (order: Order) => {
    const index = rows.findIndex((row) => row.id === order.id);
    focusAfter.current = rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
  };
  const focusNext = () => {
    const id = focusAfter.current;
    if (!id) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = [...document.querySelectorAll<HTMLElement>(`[data-primary="${id}"]`)].find(
          (element) => element.offsetParent !== null
        );
        target?.focus();
      })
    );
  };

  const actions = useOrderActions({ onDone: focusNext });
  const act = (kind: Parameters<typeof actions.open>[0], order: Order) => {
    pickNext(order);
    actions.open(kind, order);
  };
  const runPrimary = (order: Order) => {
    const primary = primaryActionOf(order);
    if (!primary) return;
    pickNext(order);
    actions.run(primary.action, order);
  };

  /* -------------------------------------------------------------- bulk -- */

  const [acceptOne] = useAcceptOrderMutation();
  const [packOne] = usePackOrderMutation();
  const [shipOne] = useShipOrderMutation();
  const [deliverOne] = useDeliverOrderMutation();
  const [bulkSheet, setBulkSheet] = useState<'accept' | 'ship' | 'deliver' | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(
    null
  );

  /*
   * A bulk transition, one request at a time rather than in parallel.
   *
   * Each of these posts to the ledger, so they are serialised deliberately: a
   * burst of concurrent writes against the same reseller's balance is exactly
   * the contention the ledger's atomic update is there to survive. One failure
   * no longer stops the run or leaves the button spinning: every order is
   * tried, the ones that went through leave the selection, and the toast names
   * the first that did not and offers to try the rest again.
   */
  // A ref, not the progress state: the toast's "try the rest" holds an older
  // copy of this function, and must still see a run that is under way.
  const bulkRunning = useRef(false);
  const runBulk = async (
    label: string,
    to: OrderStatus,
    targets: Order[],
    step: (order: Order) => Promise<unknown>
  ) => {
    if (bulkRunning.current || targets.length === 0) return;
    bulkRunning.current = true;
    const failed: { order: Order; message: string }[] = [];
    setProgress({ label, done: 0, total: targets.length });
    for (let index = 0; index < targets.length; index += 1) {
      const order = targets[index];
      try {
        await step(order);
      } catch (failure) {
        failed.push({ order, message: errorMessage(failure) });
      }
      setProgress({ label, done: index + 1, total: targets.length });
    }
    setProgress(null);
    bulkRunning.current = false;

    selection.clear();
    failed.forEach(({ order }) => selection.toggle(order.id));

    if (failed.length === 0) {
      toast(tf('orders.bulkDone', { count: formatNumber(targets.length), status: ownerStatusLabel(to) }));
      return;
    }
    // A failed order may have moved under us; refresh what the list shows.
    dispatch(ordersApi.util.invalidateTags([{ type: 'Order', id: LIST }, 'OrderSummary']));
    toast(
      tf('orders.bulkPartial', {
        done: formatNumber(targets.length - failed.length),
        total: formatNumber(targets.length),
        code: failed[0].order.orderCode,
        reason: failed[0].message,
      }),
      'danger',
      {
        action: {
          label: tf('orders.retryRest', { count: formatNumber(failed.length) }),
          onClick: () => void runBulk(label, to, failed.map(({ order }) => order), step),
        },
      }
    );
  };

  const selectedOrders = rows.filter((order) => selection.isSelected(order.id));
  const allCan = (action: string) =>
    selectedOrders.length > 0 && selectedOrders.every((order) => order.actions.includes(action));
  const labelsHref = `/owner/reports/print/labels?ids=${selectedOrders.map((order) => order.id).join(',')}` as Route;

  /* --------------------------------------------------------------- menu -- */

  /** The row overflow menu. Everything in it is also a button on the phone card. */
  const menuFor = (order: Order): MenuItem[] => [
    { label: t('order.viewDetail'), icon: Eye, onSelect: () => router.push(detailHref(order)) },
    ...(order.actions.includes('return')
      ? [{ label: t('orders.markReturnedShort'), icon: Undo2, onSelect: () => act('return', order) }]
      : []),
    { label: t('complaint.add'), icon: MessageSquareWarning, onSelect: () => act('complaint', order) },
    ...(order.actions.includes('cancel')
      ? [
          {
            label: t('order.cancelOrder'),
            icon: Ban,
            tone: 'danger' as const,
            onSelect: () => act('cancel', order),
          },
        ]
      : []),
  ];

  /* ------------------------------------------------------------ filters -- */

  const pickStatus = (next: string) => setUrl({ status: next, aging: false, sort: '' });
  const filtered =
    Boolean(args.q) || Boolean(range) || Boolean(source) || Boolean(reseller) || aging;
  const clearFilters = () => {
    setInput('');
    setUrl({ aging: false, source: '', reseller: '', sort: '' });
    setRange('all', null);
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const extraFilters = (preset !== 'all' ? 1 : 0) + (searchParams.get('sort') ? 1 : 0);

  const tabValue = aging ? 'confirmed' : status;
  const tabOptions = [
    ...ORDER_TABS.map((tab) => ({
      value: tab.value,
      label: tab.label(),
      // A chip on the tab, so the cost of looking somewhere else is visible
      // without going there. "All" counts everything but the reseller's pending.
      count: counts
        ? tab.value
          ? counts[tab.value as OrderStatus]
          : (summary.data?.total ?? 0) - (counts.pending ?? 0)
        : undefined,
    })),
    // Shown only when there is something in it: these are the reseller's to confirm.
    ...((counts?.pending ?? 0) > 0 || status === 'pending'
      ? [{ value: 'pending', label: ownerStatusLabel('pending'), count: counts?.pending }]
      : []),
    // The "চলমান" tile's filter, named while it is the one applied.
    ...(status === IN_PROGRESS ? [{ value: IN_PROGRESS, label: t('order.inProgress') }] : []),
  ];

  // Search results that sit in other tabs, for the empty state to offer.
  const elsewhere =
    args.q && counts
      ? ORDER_TABS.filter((tab) => tab.value && tab.value !== status && (counts[tab.value as OrderStatus] ?? 0) > 0)
      : [];

  const dimmed = orders.isFetching && !fresh;
  /*
   * A tab or filter whose request failed. RTK keeps the last good rows, which
   * belong to the previous tab; showing them live under the new tab would let
   * the owner act on the wrong list. They stay visible, dimmed and inert, under
   * the error and its retry.
   */
  const stale = orders.isError && !fresh;

  return (
    <>
      <PageHeader
        title={t('nav.orders')}
        subtitle={
          orders.data
            ? `${formatNumber(total)} ${t('nav.orders')} · ${formatRange(range)}`
            : formatRange(range)
        }
        action={
          /*
           * The download sits here rather than at the bottom of the list: it
           * carries the filters above it, so it has to be read as part of them.
           * The sheet it opens is the one the packing table actually works from.
           */
          <DownloadMenu
            range={range}
            extra={{
              status: args.status,
              source: source || undefined,
              reseller: reseller || undefined,
              q: args.q,
              aging: aging ? 'true' : undefined,
            }}
            only={['orders', 'pick-list', 'sales']}
          />
        }
      />

      {source && (
        <Alert tone="primary" title={sourceDetail.data?.source.name}>
          <span className="flex flex-wrap items-center gap-x-3">
            <span>{t('source.viewOrders')}</span>
            <Link
              href={`/owner/sources/${source}` as Route}
              className="tap inline-flex items-center font-semibold text-primary-ink hover:underline"
            >
              {t('source.record')}
            </Link>
            <button type="button" onClick={() => setUrl({ source: '' })} className="tap font-semibold hover:underline">
              {t('app.clear')}
            </button>
          </span>
        </Alert>
      )}

      {reseller && (
        <Alert tone="primary" title={resellerDetail.data?.reseller.shopName}>
          <span className="flex flex-wrap items-center gap-x-3">
            <span>{t('orders.resellerOrders')}</span>
            <Link
              href={`/owner/resellers/${reseller}` as Route}
              className="tap inline-flex items-center font-semibold text-primary-ink hover:underline"
            >
              {t('orders.resellerPage')}
            </Link>
            <button type="button" onClick={() => setUrl({ reseller: '' })} className="tap font-semibold hover:underline">
              {t('app.clear')}
            </button>
          </span>
        </Alert>
      )}

      {/*
       * The four numbers worth looking at before touching anything, each one a
       * filter. From `sm` only: on a phone they repeated the tab counts right
       * under them and pushed the first order below the fold.
       */}
      <OrderTiles
        className="hidden sm:grid"
        counts={counts}
        aging={summary.data?.aging}
        active={status}
        agingActive={aging}
        onPick={pickStatus}
        onPickAging={() => setUrl({ status: 'confirmed', aging: !aging, sort: '' })}
      />

      {/*
       * Search and the tabs stay under the thumb while the list scrolls beneath
       * them on a phone; from `sm` they sit in the page like any toolbar.
       */}
      <div className="sticky top-16 z-20 -mx-4 mb-3 bg-background/95 px-4 pt-2 pb-1.5 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <Toolbar className="mb-2">
          <SearchInput value={input} onChange={setInput} placeholder={t('app.searchOrders')} />
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className={cn(
              'tap inline-flex items-center gap-1.5 rounded-xl border px-3 text-sm font-medium sm:hidden',
              extraFilters ? 'border-primary bg-primary-softer text-primary-ink' : 'border-border text-muted-foreground'
            )}
          >
            <SlidersHorizontal aria-hidden className="h-4 w-4" />
            {preset === 'all' ? t('app.filters') : formatRange(range)}
            {extraFilters > 0 && <span className="tabular">({formatNumber(extraFilters)})</span>}
          </button>
          <div className="ml-auto hidden xl:block">
            <ColumnToggle columns={COLUMNS} isVisible={columns.isVisible} onToggle={columns.toggle} />
          </div>
        </Toolbar>
        <Segmented label={t('app.status')} value={tabValue} onChange={pickStatus} options={tabOptions} />
      </div>

      {/*
       * The dates and the order, behind one chip on a phone (a row of eight date
       * chips and a sort box under the search took a third of the screen before
       * the first order) and laid out in full from `sm`.
       */}
      <div className={cn('mb-3 flex-wrap items-start gap-3', filtersOpen ? 'flex' : 'hidden sm:flex')}>
        <DateRangeFilter
          className="min-w-0 max-w-full"
          preset={preset}
          range={range}
          onChange={(nextPreset, nextRange) => {
            setRange(nextPreset, nextRange);
            // Aging is a wall-clock age, not a calendar day; the two filters
            // answer different questions and holding both means neither.
            if (aging) setUrl({ aging: false });
          }}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('app.sortBy')}
          <Select
            className="w-auto"
            value={queue.sort}
            // The tab's own order is left out of the URL, so the next tab gets its own.
            onChange={(event) =>
              setUrl({ sort: event.target.value === defaultSort(status, aging) ? '' : event.target.value })
            }
          >
            <option value="oldest">{t('orders.sortOldest')}</option>
            <option value="newest">{t('orders.sortNewest')}</option>
          </Select>
        </label>
      </div>

      {status === 'pending' && <Alert tone="warning">{t('orders.pendingExplained')}</Alert>}

      {/* On a phone the aging tile is this line, and only when there is something stale. */}
      {!aging && (summary.data?.aging ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => setUrl({ status: 'confirmed', aging: true, sort: '' })}
          className="tap mb-3 flex w-full items-center gap-2 rounded-xl bg-danger-soft px-3 text-left text-sm font-medium text-danger-ink sm:hidden"
        >
          <AlarmClock aria-hidden className="h-4 w-4 shrink-0" />
          {tf('orders.agingNotice', { count: formatNumber(summary.data?.aging ?? 0) })}
        </button>
      )}
      {aging && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-danger-soft px-3 text-sm font-medium text-danger-ink">
          <span className="flex items-center gap-2 py-2">
            <AlarmClock aria-hidden className="h-4 w-4 shrink-0" />
            {t('orders.agingOn')}
          </span>
          <button type="button" onClick={() => setUrl({ aging: false })} className="tap shrink-0 font-semibold hover:underline">
            {t('app.clear')}
          </button>
        </div>
      )}

      {/*
       * What the orders in this tab are worth, once a range narrows the list:
       * summed over all time it is a number nobody asked for, and summed over a
       * day it is the first thing anybody asks. Scoped to the tab, and says so.
       */}
      {range && !aging && money && money.orders > 0 && (
        <div className="mb-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            <MoneyCell label={t('owner.ownerRevenue')} value={formatMoney(money.ownerRevenue)} />
            <MoneyCell label={t('owner.goodsValue')} value={formatMoney(money.goods)} />
            <MoneyCell label={t('owner.deliveryCollected')} value={formatMoney(money.delivery)} />
            <MoneyCell label={t('owner.customerValue')} value={formatMoney(money.customerTotal)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {tf('orders.moneyCaption', { count: formatNumber(money.orders) })}
          </p>
        </div>
      )}

      {/*
       * Pinned above the bottom bar on a phone, where the thumb is; inline above
       * the list once the sidebar replaces the bottom bar.
       */}
      {(selection.count > 0 || progress) && (
        <div className="above-nav fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2 lg:static lg:mb-3 lg:p-0 [&>div]:mb-0 [&>div]:shadow-[var(--elev-3)] lg:[&>div]:shadow-none">
          {progress ? (
            <div className="rounded-xl border border-primary/30 bg-primary-softer px-4 py-3" role="status">
              <p className="tabular text-sm font-semibold text-primary-ink">
                {progress.label} · {tf('app.progress', { done: formatNumber(progress.done), total: formatNumber(progress.total) })}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <SelectionBar count={selection.count} onClear={selection.clear}>
              {allCan('accept') && (
                <Button size="sm" onClick={() => setBulkSheet('accept')}>
                  {t('order.accept')}
                </Button>
              )}
              {allCan('pack') && (
                <Button
                  size="sm"
                  onClick={() =>
                    void runBulk(t('order.pack'), 'packed', selectedOrders, (order) => packOne({ id: order.id }).unwrap())
                  }
                >
                  {t('order.pack')}
                </Button>
              )}
              {allCan('ship') && (
                <Button size="sm" onClick={() => setBulkSheet('ship')}>
                  {t('order.ship')}
                </Button>
              )}
              {allCan('deliver') && (
                <Button size="sm" variant="success" onClick={() => setBulkSheet('deliver')}>
                  {t('orders.deliverShort')}
                </Button>
              )}
              <ButtonLink href={labelsHref} size="sm" variant="outline">
                <Printer aria-hidden className="h-4 w-4" />
                {t('orders.labels')}
              </ButtonLink>
            </SelectionBar>
          )}
        </div>
      )}

      {orders.isLoading && <ListSkeleton />}

      {stale && (
        <ErrorState onRetry={() => orders.refetch()} isRetrying={orders.isFetching} error={orders.error} />
      )}

      {orders.data && fresh && loaded.length === 0 && (
        filtered ? (
          <>
            {elsewhere.length > 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={t('orders.notInThisTab')}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {elsewhere.map((tab) => (
                      <Button key={tab.value} variant="outline" size="sm" onClick={() => pickStatus(tab.value)}>
                        {tab.label()} ({formatNumber(counts?.[tab.value as OrderStatus] ?? 0)})
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : (
              <FilteredEmpty onClear={clearFilters} />
            )}
          </>
        ) : status === 'confirmed' ? (
          <EmptyState
            icon={CircleCheckBig}
            title={t('orders.allAccepted')}
            description={t('orders.allAcceptedHelp')}
          />
        ) : summary.data?.total === 0 ? (
          <EmptyState icon={ClipboardList} title={t('order.noOrders')} />
        ) : (
          <EmptyState icon={ClipboardList} title={t('orders.tabEmpty')} />
        )
      )}

      {held.length > 0 && (
        <button
          type="button"
          onClick={showHeld}
          className="tap sticky top-[11.5rem] z-10 mx-auto mb-3 flex items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground elev-2 sm:top-20"
        >
          {tf('orders.newArrived', { count: formatNumber(held.length) })}
        </button>
      )}

      {rows.length > 0 && (
        <div
          className={cn('transition-opacity', (dimmed || stale) && 'opacity-60')}
          aria-busy={dimmed || undefined}
          inert={stale || undefined}
        >
          {/* Select-all for the cards, which have no header row to put it in. */}
          <div className="mb-2 flex items-center justify-between gap-3 xl:hidden">
            <Checkbox
              className="tap -ml-3 justify-center"
              label={t('app.selectAll')}
              checked={selection.allSelected}
              indeterminate={selection.someSelected}
              onChange={selection.toggleAll}
            />
            {/* The visible words widen the target; the checkbox itself carries the name. */}
            <span
              aria-hidden
              onClick={selection.toggleAll}
              className="mr-auto -ml-2 cursor-pointer py-3 text-sm text-muted-foreground"
            >
              {t('app.selectAll')}
            </span>
            {status === 'packed' && (
              <ButtonLink
                href={`/owner/reports/print/labels${qs({ status: 'packed', from: range?.from, to: range?.to, q: args.q, source: args.source, reseller: args.reseller })}` as Route}
                size="sm"
                variant="outline"
              >
                <Printer aria-hidden className="h-4 w-4" />
                {t('orders.labelsAll')}
              </ButtonLink>
            )}
          </div>

          {/*
           * Cards everywhere below `xl`, two across once there is room. The
           * table carries seven columns and only genuinely fits from `xl`, where
           * the sidebar leaves it about 944px.
           */}
          <ul className="grid gap-3 sm:grid-cols-2 xl:hidden">
            {rows.map((order) => (
              <li key={order.id}>
                <OrderCard
                  order={order}
                  href={detailHref(order)}
                  selected={selection.isSelected(order.id)}
                  onToggle={() => selection.toggle(order.id)}
                  busy={actions.packingId === order.id}
                  onPrimary={() => runPrimary(order)}
                  onCancel={() => act('cancel', order)}
                  onReturn={() => act('return', order)}
                />
              </li>
            ))}
          </ul>

          <TableWrap from="xl" minWidth="58rem">
            <thead>
              <tr>
                <Th className="w-10 pr-0">
                  <Checkbox
                    label={t('app.selectAll')}
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    onChange={selection.toggleAll}
                  />
                </Th>
                {columns.isVisible('code') && (
                  <SortTh column="code" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('order.code')}
                  </SortTh>
                )}
                {columns.isVisible('reseller') && (
                  <SortTh column="reseller" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('nav.resellers')}
                  </SortTh>
                )}
                {columns.isVisible('customer') && (
                  <SortTh column="customer" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('order.customer')}
                  </SortTh>
                )}
                {columns.isVisible('items') && (
                  <SortTh column="items" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('order.items')}
                  </SortTh>
                )}
                {columns.isVisible('amount') && (
                  <SortTh column="amount" sort={sorting.sort} onSort={sorting.toggle} align="right">
                    {t('orders.toCollect')}
                  </SortTh>
                )}
                {columns.isVisible('status') && (
                  <SortTh column="status" sort={sorting.sort} onSort={sorting.toggle}>
                    {t('app.status')}
                  </SortTh>
                )}
                <Th className="w-44 text-right">
                  <span className="sr-only">{t('app.actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const primary = primaryActionOf(order);
                const shop = shopOf(order);
                return (
                  <Tr key={order.id} selected={selection.isSelected(order.id)}>
                    <Td className="pr-0">
                      <Checkbox
                        label={`${t('app.selectRow')} ${order.orderCode}`}
                        checked={selection.isSelected(order.id)}
                        onChange={() => selection.toggle(order.id)}
                      />
                    </Td>

                    {columns.isVisible('code') && (
                      <Td>
                        <Link
                          href={detailHref(order)}
                          className="tabular rounded-md bg-subtle px-1.5 py-0.5 font-semibold text-primary-ink transition-colors hover:bg-primary-softer"
                        >
                          {order.orderCode}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">{formatAge(joinedAt(order))}</div>
                      </Td>
                    )}

                    {columns.isVisible('reseller') && (
                      <Td>
                        {shop ? (
                          <Person name={shop.shopName} size="sm" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                    )}

                    {columns.isVisible('customer') && (
                      <Td>
                        <div className="text-sm font-medium">{order.customer.name}</div>
                        <PhoneLink phone={order.customer.phoneE164} className="text-xs text-muted-foreground" />
                        <div className="text-xs text-muted-foreground">{districtLabel(order.customer.district)}</div>
                      </Td>
                    )}

                    {/*
                     * The reason this column exists: the row never said what had
                     * been ordered, so deciding anything about it meant opening it.
                     */}
                    {columns.isVisible('items') && (
                      <Td>
                        <OrderItems items={order.items} />
                      </Td>
                    )}

                    {/*
                     * What the courier collects, which is the owner's exposure on
                     * this parcel, with what the reseller is billed under it.
                     */}
                    {columns.isVisible('amount') && (
                      <Td className="text-right">
                        <CollectAmount order={order} compact />
                        <div className="tabular text-xs text-muted-foreground">
                          {t('orders.resellerBilled')} {formatMoney(order.totals.walletDebit)}
                        </div>
                      </Td>
                    )}

                    {columns.isVisible('status') && (
                      <Td>
                        <Badge tone={statusTone(order.status)} dot>
                          {ownerStatusLabel(order.status)}
                        </Badge>
                        {/*
                         * The pill says where the order is; the track says how much
                         * is left.
                         */}
                        <StageTrack status={order.status} />
                      </Td>
                    )}

                    <Td className="text-right">
                      {/*
                       * The one thing this order most likely needs, as a button;
                       * the rest stay in the menu.
                       */}
                      <div className="flex items-center justify-end gap-1">
                        {primary && (
                          <Button
                            size="sm"
                            variant={primary.action === 'deliver' ? 'success' : 'outline'}
                            data-primary={order.id}
                            loading={actions.packingId === order.id}
                            onClick={() => runPrimary(order)}
                          >
                            {primary.label}
                          </Button>
                        )}
                        <RowMenu label={`${t('app.actions')} ${order.orderCode}`} items={menuFor(order)} />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>

          <LoadMore
            hasMore={Boolean(orders.hasNextPage)}
            loading={orders.isFetchingNextPage}
            onLoadMore={() => orders.fetchNextPage()}
            error={orders.isFetchNextPageError ? orders.error : undefined}
            shown={rows.length}
            total={total}
            className={cn(selection.count > 0 && 'mb-24 lg:mb-0')}
          />
        </div>
      )}

      {actions.sheets}

      {bulkSheet === 'accept' && (
        <BulkAcceptModal
          count={selectedOrders.length}
          products={selectedOrders.flatMap((order) => order.items.map((item) => item.product))}
          onClose={() => setBulkSheet(null)}
          onConfirm={(sourceId) => {
            const targets = selectedOrders;
            setBulkSheet(null);
            void runBulk(t('order.accept'), 'accepted', targets, async (order) => {
              await acceptOne({
                id: order.id,
                sources: order.items.map((item) => ({ itemId: item.id, sourceId })),
              }).unwrap();
              rememberSources(order.items.map((item) => ({ product: item.product, sourceId })));
            });
          }}
        />
      )}
      {bulkSheet === 'ship' && (
        <BulkShipModal
          count={selectedOrders.length}
          onClose={() => setBulkSheet(null)}
          onConfirm={(courierName) => {
            const targets = selectedOrders;
            setBulkSheet(null);
            void runBulk(t('order.ship'), 'shipped', targets, (order) =>
              shipOne({ id: order.id, courierName }).unwrap()
            );
          }}
        />
      )}
      {bulkSheet === 'deliver' && (
        <BulkDeliverSheet
          orders={selectedOrders}
          onClose={() => setBulkSheet(null)}
          onConfirm={async () => {
            // The sheet closes at once; the run shows its own progress.
            void runBulk(t('orders.deliverShort'), 'delivered', selectedOrders, (order) =>
              deliverOne({ id: order.id }).unwrap()
            );
          }}
        />
      )}
    </>
  );
}

/**
 * One order on a phone.
 *
 * Read top to bottom the way the owner decides: who and where, what is in it,
 * what the courier must bring back, then the one button for the next step. The
 * whole card opens the order (the code is a stretched link), while the tick,
 * the phone number and the buttons sit above that link and keep their own taps.
 */
function OrderCard({
  order,
  href,
  selected,
  onToggle,
  busy,
  onPrimary,
  onCancel,
  onReturn,
}: {
  order: Order;
  href: Route;
  selected: boolean;
  onToggle: () => void;
  busy: boolean;
  onPrimary: () => void;
  onCancel: () => void;
  onReturn: () => void;
}) {
  const primary = primaryActionOf(order);
  const shop = shopOf(order);
  const canCancel = order.actions.includes('cancel');
  const canReturn = order.actions.includes('return');

  return (
    <Card className={cn('relative p-3 sm:p-4', selected && 'ring-2 ring-primary/50')}>
      <div className="flex items-start gap-1">
        <Checkbox
          className="tap relative z-10 -ml-2 -mt-2 shrink-0 justify-center"
          label={`${t('app.selectRow')} ${order.orderCode}`}
          checked={selected}
          onChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate font-semibold">{order.customer.name}</p>
            <Badge tone={statusTone(order.status)} dot className="shrink-0">
              {ownerStatusLabel(order.status)}
            </Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <PhoneLink phone={order.customer.phoneE164} className="relative z-10 text-xs" />
            <span>{districtLabel(order.customer.district)}</span>
          </p>
        </div>
      </div>

      {/*
       * What was ordered, in boxes, above the money. A card that showed a total
       * and no mangoes told the owner nothing they could act on without opening it.
       */}
      <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2">
        <OrderItemsInline items={order.items} />
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <CollectAmount order={order} />
          <p className="tabular truncate text-xs text-muted-foreground">
            {t('orders.resellerBilled')} {formatMoney(order.totals.walletDebit)}
            {shop ? ` · ${shop.shopName}` : ''}
          </p>
        </div>
        <p className="tabular shrink-0 text-right text-xs text-muted-foreground">
          {/* The stretched link: the whole card opens the order. */}
          <Link
            href={href}
            className="font-semibold text-primary-ink after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
          >
            {order.orderCode}
          </Link>
          <span className="block">{formatAge(joinedAt(order))}</span>
        </p>
      </div>

      {(primary || canCancel || canReturn) && (
        // Wraps rather than squeezing: a long Bengali label never runs out of its button.
        <div className="relative z-10 mt-3 flex flex-wrap gap-2 [&>button]:flex-1">
          {primary && (
            <Button
              data-primary={order.id}
              variant={primary.action === 'deliver' ? 'success' : 'primary'}
              loading={busy}
              onClick={onPrimary}
            >
              {primary.label}
            </Button>
          )}
          {canReturn && (
            <Button variant="outline" onClick={onReturn}>
              {t('orders.markReturnedShort')}
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" onClick={onCancel}>
              {t('order.cancelOrder')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
