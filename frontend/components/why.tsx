'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { tMovementKind, tChargeKind } from '@/lib/i18n/bn';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/**
 * "This number came from somewhere — here is where."
 *
 * Every figure the system works out for itself is a figure somebody will one day
 * disbelieve, and on a cost screen that somebody is the owner, holding a paper
 * slip that says something else. Two of them are worse than the rest:
 *
 * - **প্রতিটা পড়েছে** — a weighted average of landed costs. Nobody can derive it
 *   by looking, and it is the number every buying decision rests on.
 * - **এখন আছে** — a running sum of everything that ever moved, some of which was
 *   never counted by a person.
 *
 * So each of them carries a "কীভাবে?" beside it that opens the working: the rate,
 * then each charge as its own line, then the division. Laid out the way it would
 * be added up on paper, because that is what it is being checked against.
 *
 * This is deliberately not a tooltip. A tooltip is for a word; this is arithmetic
 * somebody wants to sit and follow on a phone.
 */

/** The small "কীভাবে?" button that sits beside a worked-out figure. */
export function WhyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] underline-offset-2 hover:underline"
    >
      <HelpCircle className="h-3.5 w-3.5" />
      {t('why.show')}
    </button>
  );
}

/** One line of the working. `strong` marks a subtotal or the answer. */
function Line({
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
        strong ? 'border-t border-[var(--border)] pt-2 font-semibold' : ''
      }`}
    >
      <span className={`text-sm ${muted ? 'text-[var(--muted-fg)]' : ''}`}>
        {label}
        {note && <span className="block text-xs text-[var(--muted-fg)]">{note}</span>}
      </span>
      <span className={`tabular text-sm ${muted ? 'text-[var(--muted-fg)]' : ''}`}>{value}</span>
    </div>
  );
}

export type AvgCostWhy = {
  purchaseCode: string;
  payeeNameBn: string;
  businessDate: string;
  quantity: number;
  unit: string;
  unitCost: number;
  goodsCost: number;
  charges: {
    kind: string;
    amount: number;
    allocate: boolean;
    paidTo: string;
    payeeName: string | null;
  }[];
  allocatedCharge: number;
  landedLineCost: number;
  landedUnitCost: number;
  isBlended: boolean;
} | null;

export type OnHandWhy = { kind: string; quantity: number; count: number }[];

/**
 * How the per-unit cost was arrived at, from the most recent purchase.
 *
 * Shows every charge on that purchase, including the ones that were *not* added
 * into the goods cost, because the owner is checking this against a slip that
 * lists all of them and a missing line reads as an error.
 */
export function AvgCostWhyModal({
  open,
  onClose,
  from,
}: {
  open: boolean;
  onClose: () => void;
  from: AvgCostWhy;
}) {
  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('why.avgCost')}
      footer={<Button onClick={onClose}>{t('why.close')}</Button>}
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">{t('why.avgCostNote')}</p>

      {!from ? (
        <p className="text-sm">{t('why.noPurchase')}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-[var(--muted-fg)]">
            {from.payeeNameBn} · {from.businessDate} · {from.purchaseCode}
          </p>

          <Line
            label={`${formatNumber(from.quantity)} × ${formatMoney(from.unitCost)}`}
            note={t('why.rate')}
            value={formatMoney(from.goodsCost)}
          />

          {from.charges.map((charge, i) => (
            <Line
              key={i}
              label={tChargeKind(charge.kind)}
              note={
                !charge.allocate
                  ? t('why.notAllocated')
                  : charge.paidTo === 'other'
                    ? `${t('why.paidToOther')}${charge.payeeName ? ` · ${charge.payeeName}` : ''}`
                    : undefined
              }
              value={formatMoney(charge.amount)}
              // A charge that was not added into the goods cost is shown, but
              // greyed, so the sum below still reads correctly.
              muted={!charge.allocate}
            />
          ))}

          <Line
            label={t('why.goods')}
            value={formatMoney(from.landedLineCost)}
            strong
          />
          <Line
            label={`${formatMoney(from.landedLineCost)} ÷ ${formatNumber(from.quantity)}`}
            note={t('why.divide')}
            value={formatMoney(from.landedUnitCost)}
            strong
          />

          {/*
            * Said out loud, because otherwise the owner adds up the lines above,
            * gets a different figure from the one on the screen behind this
            * dialog, and concludes the software is wrong.
            */}
          {from.isBlended && (
            <p className="mt-3 rounded-md bg-[var(--muted)] p-2 text-xs">{t('why.blended')}</p>
          )}
        </>
      )}
    </Modal>
  );
}

/** How the shelf figure was arrived at: everything that ever moved, by reason. */
export function OnHandWhyModal({
  open,
  onClose,
  rows,
  onHand,
}: {
  open: boolean;
  onClose: () => void;
  rows: OnHandWhy;
  onHand: number;
}) {
  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('why.onHand')}
      footer={<Button onClick={onClose}>{t('why.close')}</Button>}
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">{t('why.onHandNote')}</p>

      {rows.length === 0 ? (
        <p className="text-sm">{t('costSetup.noPurchaseYet')}</p>
      ) : (
        <>
          {rows.map((row) => (
            <Line
              key={row.kind}
              label={tMovementKind(row.kind)}
              value={`${row.quantity > 0 ? '+' : ''}${formatNumber(row.quantity)}`}
            />
          ))}
          <Line label={t('supply.onHand')} value={formatNumber(onHand)} strong />
        </>
      )}
    </Modal>
  );
}

/**
 * A figure with its working one tap away.
 *
 * Used for the two headline numbers on a supply. Everything else on the screen is
 * a number somebody typed, and a typed number needs no explanation.
 */
export function ExplainedStat({
  label,
  value,
  hint,
  onWhy,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  onWhy: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="text-xs text-[var(--muted-fg)]">{label}</div>
      <div className="tabular mt-0.5 text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-[var(--muted-fg)]">{hint}</div>}
      <div className="mt-1">
        <WhyButton onClick={onWhy} />
      </div>
    </div>
  );
}

/** Convenience: the two modals plus their open state, for one supply. */
export function useWhy() {
  const [which, setWhich] = useState<'onHand' | 'avgCost' | null>(null);
  return {
    which,
    openOnHand: () => setWhich('onHand'),
    openAvgCost: () => setWhich('avgCost'),
    close: () => setWhich(null),
  };
}
