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
 * owed to nobody and still raises the cost. That is why the footer carries
 * `payeeTotal` and `total` as two separate figures rather than one. See
 * docs/adr/0023, and docs/adr/0024 for why there is no edit button.
 *
 * Built to the same four rules as the supplies screens:
 *
 * 1. **Spoken business Bengali**, all of it from the dictionary — "দর কত",
 *    "প্রতিটা পড়েছে", "এই টাকাটা কাকে দিলেন".
 * 2. **Every worked-out number explains itself.** The rate is struck through
 *    beside the landed cost, and a "কীভাবে?" on each line opens the addition laid
 *    out the way it would be done on paper.
 * 3. **An inert screen says what to do next.** With nothing recorded, this page
 *    names the two lists a purchase needs and links to both.
 * 4. **Nothing is a dead end.** Each line links to its shelf, each purchase to
 *    the seller whose due it moved.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, ShoppingBasket, Users } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tChargeKind, tUnit } from '@/lib/i18n/bn';
import { businessDate, formatDate, formatMoney, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import type { Paged, Payee, Purchase, PurchaseLine, Supply } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import {
  DateRangeFilter,
  rangeOf,
  rangeParams,
  type DateRange,
  type PresetKey,
} from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { LoadMore } from '@/components/ui/load-more';
import { WhyButton } from '@/components/why';

const PAGE_SIZE = 20;

const CHARGE_KINDS = ['transport', 'labour', 'loading', 'commission', 'other'] as const;

type PurchasePage = Paged<'purchases', Purchase> & {
  totals: { goodsCost: number; chargeTotal: number; spent: number; billedByPayees: number };
};

/** One figure in the breakdown strip under the two headline cards. */
function MoneyCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="tabular mt-0.5 text-sm font-semibold leading-tight">{value}</p>
    </div>
  );
}

/* ------------------------------------------------- where the number came from -- */

/**
 * One line of the working. `strong` marks a subtotal or the answer.
 *
 * Modelled on the working inside `components/why.tsx`, kept local because what is
 * being explained here is one purchase line rather than a supply's average, and
 * the two take different inputs.
 */
function WhyLine({
  label,
  value,
  note,
  strong,
  muted,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1 ${
        strong ? 'border-t border-border pt-2 font-semibold' : ''
      }`}
    >
      <span className={`text-sm ${muted ? 'text-muted-foreground' : ''}`}>
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
      <span className={`tabular text-sm ${muted ? 'text-muted-foreground' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * "প্রতিটা ৳৮৮ পড়ল — কীভাবে?"
 *
 * Laid out the way it would be added on paper, because that is what the owner is
 * checking it against: the goods, then each charge as its own line, then the
 * division. Every charge appears, including the ones that were not added into the
 * cost, because a slip lists all of them and a missing line reads as an error.
 *
 * On a purchase with more than one line, a charge's row shows this line's share of
 * it rather than the whole charge, and the basis that split it is named below.
 */
function LandedCostWhyModal({
  purchase,
  line,
  onClose,
}: {
  purchase: Purchase;
  line: PurchaseLine;
  onClose: () => void;
}) {
  const allocatable = purchase.charges
    .filter((charge) => charge.allocate)
    .reduce((sum, charge) => sum + charge.amount, 0);

  /*
   * This line's share of one charge. The total is the API's own
   * `allocatedCharge`, so the rows below always add up to the figure on the
   * screen behind this sheet; only the split between charges is worked out here.
   */
  const shareOf = (amount: number) =>
    allocatable > 0 ? (line.allocatedCharge * amount) / allocatable : 0;

  const split = purchase.lines.length > 1;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('why.avgCost')}
      footer={<Button onClick={onClose}>{t('why.close')}</Button>}
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('why.avgCostNote')}</p>

      <p className="mb-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{line.supplyNameBn}</span> ·{' '}
        {purchase.payeeNameBn} · {formatDate(purchase.businessDate)} ·{' '}
        <span className="tabular">{purchase.purchaseCode}</span>
      </p>

      <WhyLine
        label={`${formatNumber(line.quantity)} ${tUnit(line.unit)} × ${formatMoney(line.unitCost)}`}
        note={t('why.rate')}
        value={formatMoney(line.lineCost)}
      />

      {purchase.charges.map((charge) => (
        <WhyLine
          key={charge.id}
          // The plus belongs only to the charges that actually get added on.
          label={charge.allocate ? `+ ${tChargeKind(charge.kind)}` : tChargeKind(charge.kind)}
          note={
            !charge.allocate
              ? t('why.notAllocated')
              : charge.paidTo === 'other'
                ? `${t('why.paidToOther')}${charge.payeeName ? ` · ${charge.payeeName}` : ''}`
                : undefined
          }
          // A charge that never entered the cost is shown, but greyed at its own
          // full amount, so the sum below still reads correctly.
          value={charge.allocate ? formatMoney(shareOf(charge.amount)) : formatMoney(charge.amount)}
          muted={!charge.allocate}
        />
      ))}

      <WhyLine label={t('why.goods')} value={formatMoney(line.landedLineCost)} strong />
      <WhyLine
        label={`${formatMoney(line.landedLineCost)} ÷ ${formatNumber(line.quantity)}`}
        note={t('why.divide')}
        value={formatMoney(line.landedUnitCost)}
        strong
      />

      {/*
       * Said out loud, because otherwise the owner adds up the whole van hire
       * against this one line, gets a bigger figure than the screen shows, and
       * concludes the software is wrong.
       */}
      {split && (
        <p className="mt-3 rounded-md bg-muted p-2 text-xs">
          {t('purchase.basis')}:{' '}
          {purchase.allocationBasis === 'value'
            ? t('purchase.basisValue')
            : t('purchase.basisQuantity')}
        </p>
      )}
    </Modal>
  );
}

/**
 * The lines of a saved purchase, rate beside landed cost.
 *
 * This is the payoff of the whole feature, so it is a stacked list rather than a
 * nested table: it has to read the same on a 360px phone as on a desktop. The
 * rate is struck through and the landed cost carries the weight, because the rate
 * is what was agreed and the landed cost is what happened.
 */
function PurchaseLines({
  purchase,
  onWhy,
}: {
  purchase: Purchase;
  onWhy: (line: PurchaseLine) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <ul className="space-y-2">
        {purchase.lines.map((line) => (
          <li key={line.id} className="rounded-lg bg-surface p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              {/* Never a dead end: this is the shelf the purchase landed on. */}
              <Link
                href={`/owner/supplies/${line.supply}`}
                className="inline-flex items-center gap-1.5 font-semibold hover:underline"
              >
                <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                {line.supplyNameBn}
              </Link>
              <span className="tabular text-sm text-muted-foreground">
                {formatNumber(line.quantity)} {tUnit(line.unit)} · {formatMoney(line.lineCost)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2">
              <div>
                <p className="text-[0.6875rem] font-medium text-muted-foreground">
                  {t('purchase.rate')}
                </p>
                <p className="tabular text-sm text-muted-foreground line-through decoration-muted-foreground/60">
                  {formatMoney(line.unitCost)}
                </p>
              </div>
              <div>
                <p className="text-[0.6875rem] font-medium text-muted-foreground">
                  {t('purchase.landedUnitCost')}
                </p>
                <p className="tabular text-base font-bold text-primary-ink">
                  {formatMoney(line.landedUnitCost)}
                </p>
              </div>
            </div>
            {/* The arithmetic, one tap away. Nobody can derive this by looking. */}
            <div className="mt-2">
              <WhyButton onClick={() => onWhy(line)} />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">{t('purchase.landedHint')}</p>

      {purchase.charges.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {purchase.charges.map((charge) => (
            <li key={charge.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                {tChargeKind(charge.kind)}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {charge.paidTo === 'payee'
                    ? t('purchase.paidToPayee')
                    : charge.payeeName || t('purchase.paidToOther')}
                  {!charge.allocate && ` · ${t('why.notAllocated')}`}
                </span>
              </span>
              <span className="tabular">{formatMoney(charge.amount)}</span>
            </li>
          ))}
          <li className="pt-1 text-xs text-muted-foreground">{t('purchase.allocateHint')}</li>
        </ul>
      )}

      {/*
       * Three figures, and the middle one is why the outer two differ: what was
       * handed over at the gate is spent and is owed to nobody. See docs/adr/0023.
       */}
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-3">
        <div>
          <p className="text-[0.6875rem] font-medium text-muted-foreground">
            {t('purchase.payeeTotal')}
          </p>
          <p className="tabular text-base font-bold">{formatMoney(purchase.payeeTotal)}</p>
        </div>
        <div>
          <p className="text-[0.6875rem] font-medium text-muted-foreground">
            {t('purchase.otherCharge')}
          </p>
          <p className="tabular text-base font-semibold text-muted-foreground">
            {formatMoney(purchase.otherCharge)}
          </p>
        </div>
        <div>
          <p className="text-[0.6875rem] font-medium text-muted-foreground">
            {t('purchase.total')}
          </p>
          <p className="tabular text-base font-bold">{formatMoney(purchase.total)}</p>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{t('purchase.paidToHint')}</p>
    </div>
  );
}

export default function OwnerPurchasesPage() {
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** The one line whose arithmetic is being read, with the purchase it sits on. */
  const [why, setWhy] = useState<{ purchase: Purchase; line: PurchaseLine } | null>(null);
  const [payeeId, setPayeeId] = useState('');
  const [status, setStatus] = useState('');
  /*
   * Opens on the last thirty days rather than on all time: a purchase list is
   * read to answer what this season has cost, and the totals strip above it is
   * meaningless summed over every year the business has existed.
   */
  const [preset, setPreset] = useState<PresetKey | 'custom'>('last30');
  const [range, setRange] = useState<DateRange>(rangeOf('last30'));

  const filters =
    `${payeeId ? `&payeeId=${payeeId}` : ''}` +
    `${status ? `&status=${status}` : ''}` +
    `${range ? `&${rangeParams(range)}` : ''}`;

  const purchases = useInfiniteQuery({
    queryKey: ['owner', 'purchases', payeeId, status, range],
    queryFn: ({ pageParam }) =>
      api.get<PurchasePage>(`/owner/purchases?limit=${PAGE_SIZE}&page=${pageParam}${filters}`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.purchases.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });

  // Both dropdowns' data, and what the form needs, are the same two lists.
  const payees = useQuery({
    queryKey: ['owner', 'payees'],
    queryFn: () => api.get<{ payees: Payee[] }>('/owner/payees'),
  });

  const rows = purchases.data?.pages.flatMap((page) => page.purchases) ?? [];
  const total = purchases.data?.pages[0]?.total ?? 0;
  const totals = purchases.data?.pages[0]?.totals;
  const nextError = purchases.isFetchNextPageError ? purchases.error : null;

  return (
    <>
      <PageHeader
        title={t('nav.purchases')}
        subtitle={t('purchase.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DownloadMenu range={range} only={['purchases']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('purchase.new')}
            </Button>
          </div>
        }
      />

      <DateRangeFilter
        className="mb-4"
        preset={preset}
        range={range}
        onChange={(nextPreset, nextRange) => {
          setPreset(nextPreset);
          setRange(nextRange);
        }}
      />

      <Toolbar>
        <ToolbarSpacer />
        <Select
          aria-label={t('purchase.payee')}
          className="w-auto"
          value={payeeId}
          onChange={(event) => setPayeeId(event.target.value)}
        >
          <option value="">{t('app.all')}</option>
          {(payees.data?.payees ?? []).map((payee) => (
            <option key={payee.id} value={payee.id}>
              {payee.nameBn}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('app.status')}
          className="w-auto"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t('app.all')}</option>
          <option value="received">{t('purchase.recorded')}</option>
          <option value="cancelled">{t('purchase.cancelled')}</option>
        </Select>
      </Toolbar>

      {/*
       * What was spent, and what of it the sellers are owed. Two figures side by
       * side and never one: a charge handed over at the gate is spent and is owed
       * to nobody, so adding them together overstates a due. docs/adr/0023.
       */}
      {totals && rows.length > 0 && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Stat
              label={t('purchase.spent')}
              value={formatMoney(totals.spent)}
              hint={t('purchase.total')}
              icon={ShoppingBasket}
            />
            <Stat
              label={t('purchase.payeeTotal')}
              value={formatMoney(totals.billedByPayees)}
              hint={t('payee.dueHint')}
              tone="primary"
              icon={Users}
            />
          </div>

          {/* The breakdown of the left-hand figure above, in the same order the
              purchase itself is built: the goods, then getting them here. */}
          <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
            <MoneyCell label={t('purchase.goodsCost')} value={formatMoney(totals.goodsCost)} />
            <MoneyCell label={t('purchase.chargeTotal')} value={formatMoney(totals.chargeTotal)} />
          </div>

          <p className="mb-4 text-xs text-muted-foreground">{t('purchase.paidToHint')}</p>
        </>
      )}

      {purchases.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {purchases.isError && rows.length === 0 && (
        <ErrorState
          onRetry={() => purchases.refetch()}
          isRetrying={purchases.isFetching}
          error={purchases.error}
        />
      )}

      {/* A filter that found nothing is not an empty account, so it says so and
          stops there rather than teaching somebody who already knows. */}
      {purchases.isSuccess && rows.length === 0 && (payeeId || status) && (
        <EmptyState icon={ShoppingBasket} title={t('app.none')} />
      )}

      {/*
       * Nothing recorded at all. This screen is inert until two other lists have
       * something in them, so it names them in order and links to both instead of
       * shrugging with "কিছু নেই".
       */}
      {purchases.isSuccess && rows.length === 0 && !payeeId && !status && (
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
              <ol className="max-w-sm space-y-1.5 text-left text-xs text-muted-foreground">
                <li>
                  <Link href="/owner/supplies" className="font-semibold text-primary-ink underline">
                    {t('costSetup.supplyFirst')}
                  </Link>
                </li>
                <li>
                  <Link href="/owner/payees" className="font-semibold text-primary-ink underline">
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
        <>
          {/* Phones and small tablets: one card per purchase, nothing sideways. */}
          <ul className="space-y-3 xl:hidden">
            {rows.map((purchase) => {
              const cancelled = purchase.status === 'cancelled';
              return (
                <li key={purchase.id}>
                  <Card className={`p-4 ${cancelled ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`tabular truncate font-bold ${cancelled ? 'line-through' : ''}`}>
                          {purchase.purchaseCode}
                        </p>
                        {/* The seller's own page, where this purchase's share of
                            their due is waiting to be paid. */}
                        <Link
                          href={`/owner/payees/${purchase.payee}`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {purchase.payeeNameBn}
                        </Link>
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
                        <p className="tabular mt-1 text-xl font-bold">
                          {formatMoney(purchase.total)}
                        </p>
                        <p className="text-[0.6875rem] text-muted-foreground">
                          {t('purchase.total')}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                      <div>
                        <p className="text-[0.6875rem] font-medium text-muted-foreground">
                          {t('purchase.payeeTotal')}
                        </p>
                        <p className="tabular font-semibold">{formatMoney(purchase.payeeTotal)}</p>
                      </div>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatNumber(purchase.lines.length)} · {t('purchase.item')}
                      </p>
                    </div>

                    {open === purchase.id && (
                      <div className="mt-3">
                        <PurchaseLines
                          purchase={purchase}
                          onWhy={(line) => setWhy({ purchase, line })}
                        />
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2 [&>button]:flex-1">
                      <Button
                        variant="outline"
                        onClick={() => setOpen(open === purchase.id ? null : purchase.id)}
                      >
                        {open === purchase.id ? t('app.close') : t('purchase.landedUnitCost')}
                      </Button>
                      {/* No edit, ever: a purchase is cancelled and re-entered. */}
                      {!cancelled && (
                        <Button variant="ghost" onClick={() => setCancelling(purchase)}>
                          {t('purchase.cancel')}
                        </Button>
                      )}
                    </div>
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
                  <Tr key={purchase.id} className={cancelled ? 'opacity-60' : undefined}>
                    <Td>
                      <span className={`tabular font-semibold ${cancelled ? 'line-through' : ''}`}>
                        {purchase.purchaseCode}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(purchase.businessDate)}
                      </div>
                      {cancelled && (
                        <Badge tone="danger" dot>
                          {t('purchase.cancelled')}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/owner/payees/${purchase.payee}`}
                        className="font-medium hover:underline"
                      >
                        {purchase.payeeNameBn}
                      </Link>
                      <div className="tabular text-xs text-muted-foreground">
                        {formatNumber(purchase.lines.length)} · {t('purchase.item')}
                        {purchase.invoiceNo && ` · ${purchase.invoiceNo}`}
                      </div>
                    </Td>
                    <Td className="tabular text-right">{formatMoney(purchase.goodsCost)}</Td>
                    <Td className="tabular text-right">{formatMoney(purchase.chargeTotal)}</Td>
                    {/* What the seller is owed, never the same column as what it cost. */}
                    <Td className="tabular text-right font-semibold">
                      {formatMoney(purchase.payeeTotal)}
                    </Td>
                    <Td className="tabular text-right font-bold">{formatMoney(purchase.total)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setOpen(open === purchase.id ? null : purchase.id)}
                        >
                          {open === purchase.id ? t('app.close') : t('purchase.landedUnitCost')}
                        </Button>
                        {!cancelled && (
                          <Button size="sm" variant="ghost" onClick={() => setCancelling(purchase)}>
                            {t('purchase.cancel')}
                          </Button>
                        )}
                      </div>
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
                return (
                  <PurchaseLines
                    purchase={purchase}
                    onWhy={(line) => setWhy({ purchase, line })}
                  />
                );
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
        </>
      )}

      {creating && <PurchaseModal onClose={() => setCreating(false)} />}

      {cancelling && (
        <CancelPurchaseModal purchase={cancelling} onClose={() => setCancelling(null)} />
      )}

      {why && (
        <LandedCostWhyModal
          purchase={why.purchase}
          line={why.line}
          onClose={() => setWhy(null)}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------- the form -- */

/** One line being typed. Every number is a string: it is an input's value. */
type LineDraft = { supplyId: string; quantity: string; unitCost: string };

type ChargeDraft = {
  kind: (typeof CHARGE_KINDS)[number];
  amount: string;
  paidTo: 'payee' | 'other';
  payeeName: string;
  allocate: boolean;
  note: string;
};

const blankLine = (): LineDraft => ({ supplyId: '', quantity: '', unitCost: '' });

/*
 * A new charge allocates by default and is assumed billed by the seller, which
 * is the common case: the memo from the crate seller already has the van on it.
 */
const blankCharge = (): ChargeDraft => ({
  kind: 'transport',
  amount: '',
  paidTo: 'payee',
  payeeName: '',
  allocate: true,
  note: '',
});

const num = (raw: string) => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

function PurchaseModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const [payeeId, setPayeeId] = useState('');
  const [date, setDate] = useState(businessDate());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [basis, setBasis] = useState<'value' | 'quantity'>('value');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [charges, setCharges] = useState<ChargeDraft[]>([]);

  const supplies = useQuery({
    queryKey: ['owner', 'supplies'],
    queryFn: () => api.get<{ supplies: Supply[] }>('/owner/supplies'),
  });

  const payees = useQuery({
    queryKey: ['owner', 'payees'],
    queryFn: () => api.get<{ payees: Payee[] }>('/owner/payees'),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<{ purchase: Purchase }>('/owner/purchases', {
        payeeId,
        lines: lines.map((line) => ({
          supplyId: line.supplyId,
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost),
        })),
        ...(charges.length
          ? {
              charges: charges.map((charge) => ({
                kind: charge.kind,
                amount: Number(charge.amount),
                paidTo: charge.paidTo,
                // Only meaningful when somebody other than the seller was paid.
                ...(charge.paidTo === 'other' && charge.payeeName.trim()
                  ? { payeeName: charge.payeeName.trim() }
                  : {}),
                allocate: charge.allocate,
                ...(charge.note.trim() ? { note: charge.note.trim() } : {}),
              })),
            }
          : {}),
        allocationBasis: basis,
        date,
        ...(invoiceNo.trim() ? { invoiceNo: invoiceNo.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      // A purchase moves the shelf and the seller's due at once, so both lists
      // behind this sheet are stale the moment it saves.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner', 'purchases'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'supplies'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'payees'] }),
      ]);
      onClose();
    },
  });

  const errors = fieldErrors(save.error);

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const setCharge = (index: number, patch: Partial<ChargeDraft>) =>
    setCharges((prev) => prev.map((charge, i) => (i === index ? { ...charge, ...patch } : charge)));

  /*
   * The live arithmetic. Taka floats here, deliberately: this is a preview of a
   * figure the server recomputes in poisha with largest-remainder allocation
   * (docs/adr/0023), and the saved purchase is what gets read back.
   */
  const goodsCost = lines.reduce((sum, line) => sum + num(line.quantity) * num(line.unitCost), 0);
  const totalQuantity = lines.reduce((sum, line) => sum + num(line.quantity), 0);
  const chargeTotal = charges.reduce((sum, charge) => sum + num(charge.amount), 0);
  const payeeCharge = charges
    .filter((charge) => charge.paidTo === 'payee')
    .reduce((sum, charge) => sum + num(charge.amount), 0);
  const allocatable = charges
    .filter((charge) => charge.allocate)
    .reduce((sum, charge) => sum + num(charge.amount), 0);

  /** This line's share of the allocatable charges, per one unit. */
  const landedUnitCost = (line: LineDraft) => {
    const quantity = num(line.quantity);
    if (quantity <= 0) return null;
    const lineCost = quantity * num(line.unitCost);
    const share =
      basis === 'value'
        ? goodsCost > 0
          ? lineCost / goodsCost
          : 0
        : totalQuantity > 0
          ? quantity / totalQuantity
          : 0;
    return num(line.unitCost) + (allocatable * share) / quantity;
  };

  const lineValid = (line: LineDraft) =>
    Boolean(line.supplyId) &&
    num(line.quantity) > 0 &&
    checkMoney(line.unitCost, { allowZero: true }).ok;

  const chargeValid = (charge: ChargeDraft) => checkMoney(charge.amount, { allowZero: true }).ok;

  const valid =
    Boolean(payeeId) &&
    lines.length > 0 &&
    lines.every(lineValid) &&
    charges.every(chargeValid);

  const supplyOf = (id: string) => (supplies.data?.supplies ?? []).find((s) => s.id === id);

  return (
    <Modal
      open
      wide
      dirty={Boolean(payeeId) || lines.some((line) => line.supplyId || line.quantity)}
      onClose={onClose}
      title={t('purchase.new')}
      footerLead={
        /*
         * The two totals, apart and above the save button. They differ by
         * whatever was handed to a third party, and showing one of them alone
         * is how a seller's due ends up overstated.
         */
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
          <div className="bg-surface px-3 py-2">
            <p className="text-[0.6875rem] font-medium text-muted-foreground">
              {t('purchase.payeeTotal')}
            </p>
            <p className="tabular text-lg font-bold leading-tight">
              {formatMoney(goodsCost + payeeCharge)}
            </p>
          </div>
          <div className="bg-surface px-3 py-2">
            <p className="text-[0.6875rem] font-medium text-muted-foreground">
              {t('purchase.total')}
            </p>
            <p className="tabular text-lg font-bold leading-tight">
              {formatMoney(goodsCost + chargeTotal)}
            </p>
          </div>
        </div>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      {/* A purchase cannot be edited afterwards, so the sheet says so up front. */}
      <Alert tone="warning">{t('purchase.cancelHelp')}</Alert>

      {/*
       * Both dropdowns below are fed by other screens, and an empty one is a dead
       * end rather than an error. So the sheet says which list is missing and
       * links straight to it.
       */}
      {supplies.isSuccess && supplies.data.supplies.length === 0 && (
        <Alert tone="primary" title={t('costSetup.next')}>
          {t('costSetup.emptySupply')}{' '}
          <Link href="/owner/supplies" className="font-semibold underline">
            {t('nav.supplies')}
          </Link>
        </Alert>
      )}

      {payees.isSuccess && payees.data.payees.length === 0 && (
        <Alert tone="primary" title={t('costSetup.next')}>
          {t('costSetup.thenPayee')}{' '}
          <Link href="/owner/payees" className="font-semibold underline">
            {t('nav.payees')}
          </Link>
        </Alert>
      )}

      <Field label={t('purchase.payee')} htmlFor="payeeId" error={errors.payeeId} required>
        <Select id="payeeId" value={payeeId} onChange={(event) => setPayeeId(event.target.value)}>
          <option value="">{t('purchase.payee')}</option>
          {(payees.data?.payees ?? []).map((payee) => (
            <option key={payee.id} value={payee.id}>
              {payee.nameBn}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('purchase.date')} htmlFor="date" error={errors.date}>
          <Input
            id="date"
            type="date"
            max={businessDate()}
            className="tabular"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>

        <Field
          label={t('purchase.invoiceNo')}
          htmlFor="invoiceNo"
          hint={t('app.optional')}
          error={errors.invoiceNo}
        >
          <Input
            id="invoiceNo"
            value={invoiceNo}
            onChange={(event) => setInvoiceNo(event.target.value)}
          />
        </Field>
      </div>

      {/* ------------------------------------------------------------ lines -- */}
      <section className="mb-4 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{t('purchase.lines')}</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={lines.length >= 30}
            onClick={() => setLines((prev) => [...prev, blankLine()])}
          >
            <Plus className="h-4 w-4" />
            {t('purchase.addLine')}
          </Button>
        </div>

        {typeof errors.lines === 'string' && <Alert tone="danger">{errors.lines}</Alert>}

        <ul className="space-y-3">
          {lines.map((line, index) => {
            const supply = supplyOf(line.supplyId);
            const landed = landedUnitCost(line);
            return (
              <li key={index} className="rounded-xl border-2 border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {supply ? supply.nameBn : t('purchase.item')}
                  </span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                      className="text-xs font-semibold text-danger"
                    >
                      {t('app.remove')}
                    </button>
                  )}
                </div>

                <Field
                  label={t('purchase.item')}
                  htmlFor={`supply-${index}`}
                  error={errors[`lines.${index}.supplyId`]}
                  required
                >
                  <Select
                    id={`supply-${index}`}
                    value={line.supplyId}
                    onChange={(event) => setLine(index, { supplyId: event.target.value })}
                  >
                    <option value="">{t('purchase.item')}</option>
                    {(supplies.data?.supplies ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nameBn}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t('purchase.quantity')}
                    htmlFor={`quantity-${index}`}
                    hint={supply ? tUnit(supply.unit) : undefined}
                    error={errors[`lines.${index}.quantity`]}
                    required
                  >
                    <Input
                      id={`quantity-${index}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="tabular"
                      value={line.quantity}
                      onChange={(event) => setLine(index, { quantity: event.target.value })}
                    />
                  </Field>

                  <Field
                    label={t('purchase.rate')}
                    htmlFor={`unitCost-${index}`}
                    error={
                      errors[`lines.${index}.unitCost`] ??
                      moneyError(line.unitCost, { allowZero: true })
                    }
                    required
                  >
                    <MoneyInput
                      id={`unitCost-${index}`}
                      value={line.unitCost}
                      onChange={(event) => setLine(index, { unitCost: event.target.value })}
                    />
                  </Field>
                </div>

                {/*
                 * The line's own two figures. `landedUnitCost` is a preview of
                 * what the server will store, and it is the whole reason this
                 * form spreads the charges at all.
                 */}
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted px-3 py-2">
                  <div>
                    <p className="text-[0.6875rem] font-medium text-muted-foreground">
                      {t('purchase.lineCost')}
                    </p>
                    <p className="tabular text-sm font-semibold">
                      {formatMoney(num(line.quantity) * num(line.unitCost))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.6875rem] font-medium text-muted-foreground">
                      {t('purchase.landedUnitCost')}
                    </p>
                    <p className="tabular text-sm font-bold text-primary-ink">
                      {landed == null ? '—' : formatMoney(landed)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-2 text-xs text-muted-foreground">{t('purchase.landedHint')}</p>
      </section>

      {/* ---------------------------------------------------------- charges -- */}
      <section className="mb-4 border-t border-border pt-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{t('purchase.charges')}</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={charges.length >= 10}
            onClick={() => setCharges((prev) => [...prev, blankCharge()])}
          >
            <Plus className="h-4 w-4" />
            {t('purchase.addCharge')}
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t('purchase.paidToHint')}</p>

        {typeof errors.charges === 'string' && <Alert tone="danger">{errors.charges}</Alert>}

        <ul className="space-y-3">
          {charges.map((charge, index) => (
            <li key={index} className="rounded-xl border-2 border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{tChargeKind(charge.kind)}</span>
                <button
                  type="button"
                  onClick={() => setCharges((prev) => prev.filter((_, i) => i !== index))}
                  className="text-xs font-semibold text-danger"
                >
                  {t('app.remove')}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t('purchase.chargeKind')}
                  htmlFor={`chargeKind-${index}`}
                  error={errors[`charges.${index}.kind`]}
                >
                  <Select
                    id={`chargeKind-${index}`}
                    value={charge.kind}
                    onChange={(event) =>
                      setCharge(index, { kind: event.target.value as ChargeDraft['kind'] })
                    }
                  >
                    {CHARGE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {tChargeKind(kind)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label={t('purchase.chargeAmount')}
                  htmlFor={`chargeAmount-${index}`}
                  error={
                    errors[`charges.${index}.amount`] ??
                    moneyError(charge.amount, { allowZero: true })
                  }
                  required
                >
                  <MoneyInput
                    id={`chargeAmount-${index}`}
                    value={charge.amount}
                    onChange={(event) => setCharge(index, { amount: event.target.value })}
                  />
                </Field>

                {/*
                 * Who is owed, which is a different question from whether the
                 * charge raises the shelf price. See docs/adr/0023.
                 */}
                <Field
                  label={t('purchase.paidTo')}
                  htmlFor={`paidTo-${index}`}
                  hint={t('purchase.paidToHint')}
                  error={errors[`charges.${index}.paidTo`]}
                >
                  <Select
                    id={`paidTo-${index}`}
                    value={charge.paidTo}
                    onChange={(event) =>
                      setCharge(index, { paidTo: event.target.value as ChargeDraft['paidTo'] })
                    }
                  >
                    <option value="payee">{t('purchase.paidToPayee')}</option>
                    <option value="other">{t('purchase.paidToOther')}</option>
                  </Select>
                </Field>

                {charge.paidTo === 'other' && (
                  <Field
                    label={t('purchase.payeeName')}
                    htmlFor={`payeeName-${index}`}
                    hint={t('app.optional')}
                    error={errors[`charges.${index}.payeeName`]}
                  >
                    <Input
                      id={`payeeName-${index}`}
                      value={charge.payeeName}
                      onChange={(event) => setCharge(index, { payeeName: event.target.value })}
                    />
                  </Field>
                )}

                <Field label={t('app.notes')} htmlFor={`chargeNote-${index}`} hint={t('app.optional')}>
                  <Input
                    id={`chargeNote-${index}`}
                    value={charge.note}
                    onChange={(event) => setCharge(index, { note: event.target.value })}
                  />
                </Field>
              </div>

              <div className="divide-y divide-border">
                <Switch
                  checked={charge.allocate}
                  onChange={(checked) => setCharge(index, { allocate: checked })}
                  label={t('purchase.allocate')}
                  hint={t('purchase.allocateHint')}
                />
              </div>
            </li>
          ))}
        </ul>

        {charges.length > 0 && (
          <Field
            className="mt-4"
            label={t('purchase.basis')}
            htmlFor="basis"
            error={errors.allocationBasis}
          >
            <Select
              id="basis"
              value={basis}
              onChange={(event) => setBasis(event.target.value as 'value' | 'quantity')}
            >
              <option value="value">{t('purchase.basisValue')}</option>
              <option value="quantity">{t('purchase.basisQuantity')}</option>
            </Select>
          </Field>
        )}
      </section>

      <Field label={t('app.notes')} htmlFor="note" hint={t('app.optional')} error={errors.note}>
        <Textarea id="note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Modal>
  );
}

/** Cancelling reverses the stock and the due together. It is never an edit. */
function CancelPurchaseModal({
  purchase,
  onClose,
}: {
  purchase: Purchase;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const cancel = useMutation({
    mutationFn: () =>
      api.post<{ purchase: Purchase }>(`/owner/purchases/${purchase.id}/cancel`, { reason }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner', 'purchases'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'supplies'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'payees'] }),
      ]);
      onClose();
    },
  });

  const errors = fieldErrors(cancel.error);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('purchase.cancel')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            disabled={reason.trim().length < 2}
            onClick={() => cancel.mutate()}
          >
            {t('purchase.cancel')}
          </Button>
        </>
      }
    >
      {/* Kept open on failure: a purchase already cancelled elsewhere 409s here. */}
      {cancel.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(cancel.error)}</Alert>
      )}

      <p className="mb-1 text-sm">
        <span className="tabular font-semibold">{purchase.purchaseCode}</span> ·{' '}
        {purchase.payeeNameBn} · <span className="tabular">{formatMoney(purchase.total)}</span>
      </p>
      <p className="mb-4 text-xs text-muted-foreground">{t('purchase.cancelHelp')}</p>

      <Field
        label={t('purchase.cancelReason')}
        htmlFor="cancel-reason"
        error={errors.reason}
        required
      >
        <Textarea
          id="cancel-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Modal>
  );
}
