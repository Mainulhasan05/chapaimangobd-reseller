'use client';

import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { t, tChargeKind, tUnit } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Purchase, PurchaseLine } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { WhyButton } from '@/components/why';

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
      className={cn(
        'flex items-baseline justify-between gap-3 py-1',
        strong && 'border-t border-border pt-2 font-semibold'
      )}
    >
      <span className={cn('text-sm', muted && 'text-muted-foreground')}>
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
      <span className={cn('tabular text-sm', muted && 'text-muted-foreground')}>{value}</span>
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
export function LandedCostWhyModal({
  purchase,
  line,
  onClose,
}: {
  purchase: Purchase;
  line: PurchaseLine;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={t('why.avgCost')}
      footer={<Button onClick={onClose}>{t('why.close')}</Button>}
    >
      <LandedCostWorking purchase={purchase} line={line} />
    </Modal>
  );
}

/** The working itself, for the modal above or inline in the purchase sheet. */
export function LandedCostWorking({ purchase, line }: { purchase: Purchase; line: PurchaseLine }) {
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
    <>
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

      {/* The goods and every charge added on: not "the goods", which it used to say. */}
      <WhyLine label={t('why.allIn')} value={formatMoney(line.landedLineCost)} strong />
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
    </>
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
export function PurchaseLines({
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
                className="inline-flex min-h-11 items-center gap-1.5 font-semibold hover:underline sm:min-h-0"
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
                <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('purchase.rate')}</p>
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
            <div className="mt-1">
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
        </ul>
      )}

      {/*
       * Three figures, and the middle one is why the outer two differ: what was
       * handed over at the gate is spent and is owed to nobody. See docs/adr/0023.
       */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('purchase.payeeTotal')}</p>
          <p className="tabular text-sm font-bold sm:text-base">{formatMoney(purchase.payeeTotal)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('purchase.otherCharge')}</p>
          <p className="tabular text-sm font-semibold text-muted-foreground sm:text-base">
            {formatMoney(purchase.otherCharge)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('purchase.total')}</p>
          <p className="tabular text-sm font-bold sm:text-base">{formatMoney(purchase.total)}</p>
        </div>
      </div>

      {purchase.note && <p className="mt-2 text-xs text-muted-foreground">{purchase.note}</p>}
    </div>
  );
}
