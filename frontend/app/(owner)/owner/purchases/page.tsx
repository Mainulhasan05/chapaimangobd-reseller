'use client';

/**
 * Purchases: what was bought, from whom, and what it really cost.
 *
 * The screen exists for one number. The rate agreed is not what a crate cost:
 * a hundred crates at 80 with 600 of van hire cost 88 each, and 88 is the answer
 * to "কত করে পড়ল". So every line shows its rate and its landed cost side by
 * side — live in the form, exactly as the API computed it on a saved purchase.
 *
 * The other thing this screen refuses to conflate is who is owed. A charge the
 * seller billed enters their due; a charge handed to a van driver at the gate is
 * owed to nobody and still raises the cost. That is why the totals carry
 * `payeeTotal` and `total` as two separate figures rather than one. See
 * docs/adr/0023, and docs/adr/0024 for why there is no edit button: a mistake
 * is cancelled and written again, and "বাতিল করে আবার লিখুন" opens the form
 * with everything already typed.
 *
 * Built to the same four rules as the supplies screens:
 *
 * 1. **Spoken business Bengali**, all of it from the dictionary — "দর কত",
 *    "প্রতিটা পড়েছে", "এই টাকাটা কাকে দিলেন".
 * 2. **Every worked-out number explains itself.** The rate is struck through
 *    beside the landed cost, and a "কীভাবে?" on each line opens the addition laid
 *    out the way it would be done on paper.
 * 3. **An inert screen says what to do next.** With nothing recorded, this page
 *    names the two lists a purchase needs and links to both. A filter that found
 *    nothing says so instead, with the one tap that clears it.
 * 4. **Nothing is a dead end.** Each line links to its shelf, each purchase to
 *    the seller whose due it moved.
 *
 * The form, the lines and the working live beside this file.
 */

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, RotateCcw, ShoppingBasket } from 'lucide-react';
import { t, tf } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Purchase, PurchaseLine } from '@/lib/types';
import { useUrlRange, useUrlState } from '@/lib/use-url-state';
import {
  useCancelPurchaseMutation,
  useGetPayeesQuery,
  useGetPurchasesInfiniteQuery,
} from '@/lib/store/endpoints/cost';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { DateRangeFilter } from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { LoadMore } from '@/components/ui/load-more';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { PurchaseModal } from './purchase-form';
import { LandedCostWhyModal, PurchaseLines } from './purchase-lines';
import { PurchaseSheet } from './purchase-sheet';

/** One figure in the totals strip. Two lines on a phone, never a card each. */
function TotalCell({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 bg-surface px-3 py-2', className)}>
      <p className="text-[0.6875rem] font-medium leading-snug text-muted-foreground">{label}</p>
      <p className={cn('tabular mt-0.5 leading-tight', strong ? 'text-lg font-bold' : 'text-sm font-semibold')}>
        {value}
      </p>
    </div>
  );
}

/** The supplies on a purchase in words, the first two and a count of the rest. */
function supplyNames(purchase: Purchase): string {
  const names = purchase.lines.map((line) => line.supplyNameBn);
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} ${tf('purchase.moreItems', { n: formatNumber(names.length - 2) })}` : shown;
}

export default function OwnerPurchasesPage() {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [reentering, setReentering] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);
  const [reenterAfter, setReenterAfter] = useState(true);
  const pendingReentry = useRef<Purchase | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** The one line whose arithmetic is being read, with the purchase it sits on. */
  const [why, setWhy] = useState<{ purchase: Purchase; line: PurchaseLine } | null>(null);

  // This month, the same default as every cost screen.
  const { preset, range, setRange } = useUrlRange('thisMonth');
  const [filters, setFilters, { reset, activeCount }] = useUrlState({ payeeId: '', status: '' });
  // One purchase opened by link, kept apart from the filters so it never counts as one.
  const [linked, setLinked] = useUrlState({ purchase: '' });

  const purchases = useGetPurchasesInfiniteQuery({
    payeeId: filters.payeeId,
    status: filters.status,
    ...(range ?? {}),
  });
  // Archived sellers too: a link from an archived payee's page still names them here.
  const payees = useGetPayeesQuery({ includeArchived: true });
  const [cancel] = useCancelPurchaseMutation();

  const rows = purchases.data?.pages.flatMap((page) => page.purchases) ?? [];
  const total = purchases.data?.pages[0]?.total ?? 0;
  const totals = purchases.data?.pages[0]?.totals;
  const nextError = purchases.isFetchNextPageError ? purchases.error : null;
  const switching = purchases.isFetching && !purchases.isFetchingNextPage && !purchases.isLoading;

  const narrowed = activeCount() > 0 || preset !== 'all';
  const emptyNow = purchases.isSuccess && !purchases.isFetching && rows.length === 0;
  /*
   * Whether anything was ever recorded, asked only when the filtered list came
   * back empty: "record your first purchase" under this month's empty range
   * told an owner with a full history that they had none.
   */
  const anyAtAll = useGetPurchasesInfiniteQuery({ limit: 1 }, { skip: !(emptyNow && narrowed) });
  const firstTime = emptyNow && (!narrowed || anyAtAll.data?.pages[0]?.total === 0);
  const filteredEmpty = emptyNow && narrowed && !anyAtAll.isLoading && anyAtAll.data?.pages[0]?.total !== 0;

  const clearFilters = () => {
    reset();
    setRange('all', null);
  };

  const reportExtra = {
    payeeId: filters.payeeId || undefined,
    status: filters.status || undefined,
  };

  const openCancel = (purchase: Purchase) => {
    setReenterAfter(true);
    setCancelling(purchase);
  };

  /** The two buttons every purchase offers, the same on a card and in the table. */
  const actions = (purchase: Purchase, size: 'sm' | 'md') => {
    const cancelled = purchase.status === 'cancelled';
    const expanded = open === purchase.id;
    return (
      <>
        <Button size={size} variant="outline" onClick={() => setOpen(expanded ? null : purchase.id)}>
          {expanded ? t('purchase.hideDetails') : t('app.details')}
        </Button>
        {/* No edit, ever: a purchase is cancelled and re-entered. */}
        {cancelled ? (
          <Button size={size} variant="ghost" onClick={() => setReentering(purchase)}>
            <RotateCcw className="h-4 w-4" />
            {t('purchase.reenter')}
          </Button>
        ) : (
          <Button size={size} variant="ghost" onClick={() => openCancel(purchase)}>
            {t('purchase.cancel')}
          </Button>
        )}
      </>
    );
  };

  return (
    <>
      <PageHeader
        title={t('nav.purchases')}
        subtitle={t('purchase.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DownloadMenu
              range={range}
              preset={preset}
              only={['purchases']}
              extra={reportExtra}
              csv={[
                {
                  file: 'purchases.csv',
                  label: t('nav.purchases'),
                  params: { ...reportExtra, ...(range ?? {}) },
                },
              ]}
            />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('purchase.new')}
            </Button>
          </div>
        }
      />

      <DateRangeFilter className="mb-3" preset={preset} range={range} onChange={setRange} />

      {/* Two selects side by side even on a phone, each with a label a person can read. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
        <div className="min-w-0 sm:w-56">
          <Label htmlFor="filter-seller">{t('purchase.filterSeller')}</Label>
          <Select
            id="filter-seller"
            value={filters.payeeId}
            onChange={(event) => setFilters({ payeeId: event.target.value })}
          >
            <option value="">{t('purchase.allSellers')}</option>
            {(payees.data?.payees ?? []).map((payee) => (
              <option key={payee.id} value={payee.id}>
                {payee.nameBn}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0 sm:w-48">
          <Label htmlFor="filter-status">{t('app.status')}</Label>
          <Select
            id="filter-status"
            value={filters.status}
            onChange={(event) => setFilters({ status: event.target.value })}
          >
            <option value="">{t('purchase.allStatuses')}</option>
            <option value="received">{t('purchase.recorded')}</option>
            <option value="cancelled">{t('purchase.cancelled')}</option>
          </Select>
        </div>
      </div>

      {/*
       * What was spent, and what of it the sellers are owed. Two figures side by
       * side and never one: a charge handed over at the gate is spent and is owed
       * to nobody, so adding them together overstates a due. docs/adr/0023.
       * Summed over the whole filter, so they do not move as pages load.
       */}
      {totals && (rows.length > 0 || switching) && (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
            <TotalCell label={t('purchase.spent')} value={formatMoney(totals.spent)} strong />
            <TotalCell label={t('purchase.payeeTotal')} value={formatMoney(totals.billedByPayees)} strong />
            {/* The breakdown of the first figure: one row on a phone, the rest from `lg` and on the sheet. */}
            <TotalCell
              className="hidden lg:block"
              label={t('purchase.goodsCost')}
              value={formatMoney(totals.goodsCost)}
            />
            <TotalCell
              className="hidden lg:block"
              label={t('purchase.chargeTotal')}
              value={formatMoney(totals.chargeTotal)}
            />
          </div>
          {/* What the first figure is made of, on a phone where its two cells are hidden. */}
          <p className="tabular mt-1.5 text-xs text-muted-foreground lg:hidden">
            {tf('purchase.breakdownLine', {
              goods: formatMoney(totals.goodsCost),
              charges: formatMoney(totals.chargeTotal),
            })}
          </p>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">{t('purchase.totalsHint')}</p>
        </>
      )}

      {purchases.isLoading && <ListSkeleton rows={4} />}

      {purchases.isError && !purchases.data && (
        <ErrorState
          onRetry={() => purchases.refetch()}
          isRetrying={purchases.isFetching}
          error={purchases.error}
        />
      )}

      {filteredEmpty && <FilteredEmpty onClear={clearFilters} />}

      {/*
       * Nothing recorded at all. This screen is inert until two other lists have
       * something in them, so it names them in order and links to both instead of
       * shrugging with "কিছু নেই".
       */}
      {firstTime && (
        <EmptyState
          icon={ShoppingBasket}
          title={t('purchase.title')}
          description={`${t('costSetup.noPurchaseYet')} ${t('purchase.landedHint')}`}
          action={
            <div className="flex flex-col items-center gap-3">
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                {t('purchase.new')}
              </Button>
              <ol className="max-w-sm space-y-1 text-left text-xs text-muted-foreground">
                <li>
                  <Link href="/owner/supplies" className="tap inline-flex items-center font-semibold text-primary-ink underline">
                    {t('costSetup.supplyFirst')}
                  </Link>
                </li>
                <li>
                  <Link href="/owner/payees" className="tap inline-flex items-center font-semibold text-primary-ink underline">
                    {t('costSetup.thenPayee')}
                  </Link>
                </li>
                <li>{t('costSetup.thenPurchase')}</li>
              </ol>
            </div>
          }
        />
      )}

      {rows.length > 0 && (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          {/* Phones and small tablets: one card per purchase, nothing sideways. */}
          <ul className="space-y-3 xl:hidden">
            {rows.map((purchase) => {
              const cancelled = purchase.status === 'cancelled';
              return (
                <li key={purchase.id}>
                  <Card className={cn('p-4', cancelled && 'bg-muted/40')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn('tabular truncate font-bold', cancelled && 'line-through')}>
                          {purchase.purchaseCode}
                        </p>
                        {/* The seller's own page, where this purchase's share of their due waits. */}
                        <Link
                          href={`/owner/payees/${purchase.payee}`}
                          className="block truncate py-3 text-sm font-semibold leading-5 text-primary-ink hover:underline sm:py-0.5"
                        >
                          {purchase.payeeNameBn}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{supplyNames(purchase)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(purchase.businessDate)}
                          {purchase.invoiceNo && ` · ${purchase.invoiceNo}`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {cancelled && (
                          <Badge tone="danger" dot>
                            {t('purchase.cancelled')}
                          </Badge>
                        )}
                        <p className={cn('tabular mt-1 text-xl font-bold', cancelled && 'line-through')}>
                          {formatMoney(purchase.total)}
                        </p>
                        <p className="text-[0.6875rem] text-muted-foreground">{t('purchase.total')}</p>
                      </div>
                    </div>

                    {cancelled ? (
                      purchase.cancelReason && (
                        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                          {t('purchase.cancelledReasonLabel')}: {purchase.cancelReason}
                        </p>
                      )
                    ) : (
                      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
                        <p className="text-xs text-muted-foreground">{t('purchase.payeeTotal')}</p>
                        <p className="tabular font-semibold">{formatMoney(purchase.payeeTotal)}</p>
                      </div>
                    )}

                    {open === purchase.id && (
                      <div className="mt-3">
                        <PurchaseLines purchase={purchase} onWhy={(line) => setWhy({ purchase, line })} />
                      </div>
                    )}

                    <div className="mt-3 flex gap-2 [&>button]:flex-1">{actions(purchase, 'md')}</div>
                  </Card>
                </li>
              );
            })}
          </ul>

          <TableWrap from="xl" minWidth="56rem">
            <thead>
              <tr>
                <Th>{t('purchase.code')}</Th>
                <Th>{t('purchase.payee')}</Th>
                <Th className="text-right">{t('purchase.goodsCost')}</Th>
                <Th className="text-right">{t('purchase.chargeTotal')}</Th>
                <Th className="text-right">{t('purchase.payeeTotal')}</Th>
                <Th className="text-right">{t('purchase.total')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((purchase) => {
                const cancelled = purchase.status === 'cancelled';
                return (
                  <Tr key={purchase.id} selected={open === purchase.id} className={cancelled ? 'opacity-70' : undefined}>
                    <Td>
                      <span className={cn('tabular font-semibold', cancelled && 'line-through')}>
                        {purchase.purchaseCode}
                      </span>
                      <div className="text-xs text-muted-foreground">{formatDate(purchase.businessDate)}</div>
                      {cancelled && (
                        <Badge tone="danger" dot title={purchase.cancelReason ?? undefined}>
                          {t('purchase.cancelled')}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Link href={`/owner/payees/${purchase.payee}`} className="font-medium hover:underline">
                        {purchase.payeeNameBn}
                      </Link>
                      <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                        {supplyNames(purchase)}
                        {purchase.invoiceNo && ` · ${purchase.invoiceNo}`}
                      </div>
                      {cancelled && purchase.cancelReason && (
                        <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                          {t('purchase.cancelledReasonLabel')}: {purchase.cancelReason}
                        </div>
                      )}
                    </Td>
                    <Td className="tabular text-right">{formatMoney(purchase.goodsCost)}</Td>
                    <Td className="tabular text-right">{formatMoney(purchase.chargeTotal)}</Td>
                    {/* What the seller is owed, never the same column as what it cost. */}
                    <Td className="tabular text-right font-semibold">{formatMoney(purchase.payeeTotal)}</Td>
                    <Td className="tabular text-right font-bold">{formatMoney(purchase.total)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">{actions(purchase, 'sm')}</div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>

          {/*
           * The expanded detail sits under the table rather than inside it: a
           * nested grid of rate-against-landed inside a `td` reads as a broken
           * column, and this block is the one people came to read.
           */}
          {open && rows.some((purchase) => purchase.id === open) && (
            <div className="mt-3 hidden xl:block">
              {(() => {
                const purchase = rows.find((row) => row.id === open)!;
                return <PurchaseLines purchase={purchase} onWhy={(line) => setWhy({ purchase, line })} />;
              })()}
            </div>
          )}

          <LoadMore
            hasMore={Boolean(purchases.hasNextPage)}
            loading={purchases.isFetchingNextPage}
            onLoadMore={() => purchases.fetchNextPage()}
            error={nextError}
            shown={rows.length}
            total={total}
          />

          {/*
           * Why there is no edit button on any row, said once at the foot of the
           * list rather than in a tooltip nobody opens. docs/adr/0024.
           */}
          <p className="mt-4 text-xs text-muted-foreground">{t('purchase.cancelHelp')}</p>
        </div>
      )}

      {(creating || reentering) && (
        <PurchaseModal
          key={reentering?.id ?? 'new'}
          from={reentering ?? undefined}
          onClose={() => {
            setCreating(false);
            setReentering(null);
          }}
        />
      )}

      {cancelling && (
        <ConfirmSheet
          title={t('purchase.cancel')}
          confirmLabel={reenterAfter ? t('purchase.cancelAndReenter') : t('purchase.cancel')}
          tone="danger"
          onClose={() => {
            setCancelling(null);
            // Opened in the same render the confirm sheet closes in, never on top of it.
            if (pendingReentry.current) {
              setReentering(pendingReentry.current);
              pendingReentry.current = null;
            }
          }}
          onConfirm={async (reason) => {
            await cancel({ id: cancelling.id, reason }).unwrap();
            toast(tf('purchase.cancelledToast', { code: cancelling.purchaseCode }));
            if (reenterAfter) pendingReentry.current = cancelling;
          }}
          summary={
            <>
              <p className="tabular font-semibold">{cancelling.purchaseCode}</p>
              <p className="text-xs text-muted-foreground">
                {cancelling.payeeNameBn} · {formatDate(cancelling.businessDate)} ·{' '}
                <span className="tabular">{formatMoney(cancelling.total)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{supplyNames(cancelling)}</p>
            </>
          }
          consequences={[
            t('purchase.cancelStock'),
            ...(cancelling.payeeTotal > 0
              ? [
                  tf('purchase.cancelDue', {
                    name: cancelling.payeeNameBn,
                    amount: formatMoney(cancelling.payeeTotal),
                  }),
                ]
              : []),
          ]}
          reason={{
            required: true,
            minLength: 2,
            label: t('purchase.cancelReason'),
            presets: [
              t('purchase.cancelPresetWrong'),
              t('purchase.cancelPresetTwice'),
              t('purchase.cancelPresetReturned'),
            ],
          }}
        >
          {/* There is no edit; a wrong purchase is fixed by cancelling and writing it again. */}
          <Switch
            checked={reenterAfter}
            onChange={setReenterAfter}
            label={t('purchase.reenterSwitch')}
            hint={t('purchase.reenterHint')}
          />
        </ConfirmSheet>
      )}

      {linked.purchase && (
        <PurchaseSheet
          key={linked.purchase}
          id={linked.purchase}
          onClose={() => setLinked({ purchase: '' })}
          // Closed in the same render the next sheet opens in, never stacked under it.
          onCancel={(purchase) => {
            setLinked({ purchase: '' });
            openCancel(purchase);
          }}
          onReenter={(purchase) => {
            setLinked({ purchase: '' });
            setReentering(purchase);
          }}
        />
      )}

      {why && <LandedCostWhyModal purchase={why.purchase} line={why.line} onClose={() => setWhy(null)} />}
    </>
  );
}
