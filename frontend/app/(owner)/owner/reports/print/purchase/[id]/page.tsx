'use client';

/**
 * One purchase on paper: the receipt.
 *
 * The purchase report is a summary of many purchases; this is the document for
 * one, laid out the way a memo from the market is, so the two can be stapled
 * together. The letterhead and footer are the report sheet's own, so a receipt
 * and a report from the same business look like they came from the same desk.
 *
 * It reads top to bottom as the arithmetic does: the goods, then each charge
 * and who it was handed to, then the money in the order it is owed — the
 * goods and the seller's own charges are what the seller is owed, and what
 * went to a van driver at the gate is added after that to reach what the
 * purchase cost. The seller's figure is spelled out in words, because that is
 * the figure two people sign under. See docs/adr/0023.
 *
 * The landed cost per unit is the owner's business, not the seller's, so it is
 * left off by default and switched on for the copy the owner files.
 */

import { Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { t, tChargeKind, tUnit } from '@/lib/i18n/bn';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { amountInWords } from '@/lib/amount-words';
import { cn } from '@/lib/utils';
import { useUrlState } from '@/lib/use-url-state';
import { useGetPayeeQuery, useGetPurchaseQuery } from '@/lib/store/endpoints/cost';
import {
  brandName,
  PrintBar,
  ReportFooter,
  ReportSection,
  ReportSheet,
  ReportTable,
  RTd,
  RTh,
  RTotalRow,
  useAutoPrint,
  useBrand,
} from '@/components/report/sheet';
import { Alert, ErrorState } from '@/components/ui/layout';
import { Switch } from '@/components/ui/switch';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function PurchaseReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<ListSkeleton />}>
      <PurchaseReceipt id={id} />
    </Suspense>
  );
}

/** One party on the receipt: who sold, who bought. */
function Party({ label, name, lines }: { label: string; name: string; lines: (string | null | undefined)[] }) {
  return (
    <div className="min-w-0 rounded-xl border border-border px-4 py-3">
      <p className="text-[0.6875rem] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-bold leading-snug [overflow-wrap:anywhere]">{name}</p>
      {lines.filter(Boolean).map((line) => (
        <p key={line} className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
    </div>
  );
}

/** One line of the money column at the foot of the receipt. */
function SumLine({
  label,
  value,
  sign,
  strong,
  muted,
}: {
  label: string;
  value: number;
  /** The operator printed before the label, so the column reads as a sum. */
  sign?: '+' | '=';
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 px-4 py-2',
        strong && 'border-t-2 border-foreground bg-subtle',
        muted && 'text-muted-foreground'
      )}
    >
      <span className={cn('text-sm', strong && 'font-bold')}>
        {sign && <span className="mr-1.5 inline-block w-3 text-muted-foreground">{sign}</span>}
        {label}
      </span>
      <span className={cn('tabular whitespace-nowrap', strong ? 'text-base font-bold' : 'text-sm font-semibold')}>
        {formatMoney(value)}
      </span>
    </div>
  );
}

function PurchaseReceipt({ id }: { id: string }) {
  const params = useSearchParams();
  const [view, setView] = useUrlState({ landed: false as boolean });
  const query = useGetPurchaseQuery({ id });
  const purchase = query.data?.purchase;
  // The seller's phone and address are on their own record, not on the purchase.
  const payee = useGetPayeeQuery({ id: purchase?.payee ?? '' }, { skip: !purchase });
  const brand = useBrand().data?.settings;

  useAutoPrint(query.isSuccess && !payee.isFetching, params.get('auto') === '1');

  // Fixed on first render, so a refetch does not move the time on the paper.
  const [printedAt] = useState(() => new Date());

  const bar = <PrintBar back="/owner/purchases" />;

  if (query.isError && !purchase) {
    return (
      <>
        {bar}
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
      </>
    );
  }

  if (!purchase) {
    return (
      <>
        {bar}
        <ListSkeleton />
      </>
    );
  }

  const cancelled = purchase.status === 'cancelled';
  const seller = payee.data?.payee;
  const sellerCharges = purchase.payeeTotal - purchase.goodsCost;
  const showLanded = view.landed;

  return (
    <>
      {bar}

      <div className="print-hide mx-auto mb-4 max-w-[210mm]">
        <Switch
          checked={showLanded}
          onChange={(on) => setView({ landed: on })}
          label={t('receipt.showLanded')}
          hint={t('receipt.showLandedHint')}
        />
      </div>

      <ReportSheet
        eyebrow={t('receipt.eyebrow')}
        title={t('receipt.title')}
        details={[
          { label: t('receipt.no'), value: <span className="tabular">{purchase.purchaseCode}</span> },
          { label: t('receipt.date'), value: formatDate(purchase.businessDate) },
          {
            label: t('receipt.memo'),
            value: <span className="tabular">{purchase.invoiceNo || '—'}</span>,
          },
          {
            label: t('receipt.status'),
            value: (
              <span className={cn(cancelled && 'text-danger-ink')}>
                {cancelled ? t('purchase.cancelled') : t('purchase.received')}
              </span>
            ),
          },
        ]}
      >
        <div className="relative">
          {/*
           * A cancelled purchase still prints, because the paper copy may already
           * be in someone's file, but it says so across the page where it cannot
           * be missed or trimmed off.
           */}
          {cancelled && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-24 z-10 flex justify-center"
            >
              <span className="-rotate-12 rounded-xl border-4 border-danger px-6 py-1 text-5xl font-black text-danger opacity-30">
                {t('receipt.cancelledStamp')}
              </span>
            </div>
          )}

          {cancelled && (
            <Alert tone="danger" className="mb-6">
              {t('receipt.cancelledNote')}
              {purchase.cancelReason && (
                <span className="mt-1 block">
                  {t('purchase.cancelledReasonLabel')}: {purchase.cancelReason}
                </span>
              )}
            </Alert>
          )}

          <div className="print-block mb-7 grid gap-3 sm:grid-cols-2 print:mb-5 print:grid-cols-2">
            <Party
              label={t('receipt.seller')}
              name={purchase.payeeNameBn}
              lines={[seller?.phone, seller?.address]}
            />
            <Party label={t('receipt.buyer')} name={brandName(brand)} lines={[brand?.supportPhone]} />
          </div>

          <ReportSection title={t('purchase.lines')}>
            <ReportTable
              head={
                <>
                  <RTh className="w-px whitespace-nowrap">{t('receipt.sl')}</RTh>
                  <RTh className="min-w-[7rem]">{t('receipt.item')}</RTh>
                  <RTh align="right">{t('receipt.qty')}</RTh>
                  <RTh align="right">{t('receipt.rate')}</RTh>
                  <RTh align="right">{t('receipt.amount')}</RTh>
                  {showLanded && <RTh align="right">{t('receipt.landed')}</RTh>}
                </>
              }
            >
              {purchase.lines.map((line, index) => (
                <tr key={line.id}>
                  <RTd className="tabular text-muted-foreground">{formatNumber(index + 1)}</RTd>
                  <RTd className="min-w-[7rem] font-medium">{line.supplyNameBn}</RTd>
                  <RTd align="right">
                    {formatNumber(line.quantity)} {tUnit(line.unit)}
                  </RTd>
                  <RTd align="right">{formatMoney(line.unitCost)}</RTd>
                  <RTd align="right" className="font-semibold">
                    {formatMoney(line.lineCost)}
                  </RTd>
                  {showLanded && (
                    <RTd align="right" className="font-bold">
                      {formatMoney(line.landedUnitCost)}
                    </RTd>
                  )}
                </tr>
              ))}
              <RTotalRow>
                <RTd />
                <RTd>{t('receipt.goodsSubtotal')}</RTd>
                <RTd />
                <RTd />
                <RTd align="right">{formatMoney(purchase.goodsCost)}</RTd>
                {showLanded && <RTd />}
              </RTotalRow>
            </ReportTable>
          </ReportSection>

          {purchase.charges.length > 0 && (
            <ReportSection title={t('purchase.charges')}>
              <ReportTable
                head={
                  <>
                    <RTh>{t('purchase.chargeKind')}</RTh>
                    <RTh>{t('purchase.paidTo')}</RTh>
                    <RTh align="right">{t('receipt.amount')}</RTh>
                  </>
                }
              >
                {purchase.charges.map((charge) => (
                  <tr key={charge.id}>
                    <RTd className="font-medium">
                      {tChargeKind(charge.kind)}
                      {charge.note && (
                        <span className="block text-xs font-normal text-muted-foreground">{charge.note}</span>
                      )}
                    </RTd>
                    <RTd>
                      {charge.paidTo === 'payee'
                        ? t('receipt.chargeBySeller')
                        : charge.payeeName || t('receipt.chargeByOther')}
                      {!charge.allocate && (
                        <span className="block text-xs text-muted-foreground">{t('receipt.chargeNotAdded')}</span>
                      )}
                    </RTd>
                    <RTd align="right">{formatMoney(charge.amount)}</RTd>
                  </tr>
                ))}
              </ReportTable>
            </ReportSection>
          )}

          {/*
           * The money, as a sum written down a column. The seller's line is the
           * one this receipt exists for, so it is the heavy one; the grand total
           * under it is the purchase's cost to the business.
           */}
          <div className="print-block mb-8 grid gap-5 sm:grid-cols-[1fr_minmax(0,20rem)] print:mb-4 print:grid-cols-[1fr_20rem]">
            <div className="min-w-0 self-end">
              <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('receipt.inWordsOf')}</p>
              <p className="mt-0.5 text-sm font-semibold leading-relaxed">{amountInWords(purchase.payeeTotal)}</p>
              {purchase.note && (
                <>
                  <p className="mt-3 text-[0.6875rem] font-medium text-muted-foreground">{t('receipt.note')}</p>
                  <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{purchase.note}</p>
                </>
              )}
            </div>

            <div className="min-w-0 overflow-hidden rounded-xl border border-border">
              <SumLine label={t('receipt.goodsSubtotal')} value={purchase.goodsCost} />
              {sellerCharges > 0 && (
                <SumLine sign="+" label={t('receipt.chargeBySeller')} value={sellerCharges} />
              )}
              <SumLine sign="=" label={t('receipt.payable')} value={purchase.payeeTotal} strong />
              {purchase.otherCharge > 0 && (
                <>
                  <SumLine sign="+" label={t('receipt.handPaid')} value={purchase.otherCharge} muted />
                  <SumLine sign="=" label={t('receipt.grandTotal')} value={purchase.total} />
                </>
              )}
            </div>
          </div>
        </div>

        <ReportFooter
          signatures={[t('receipt.sellerSign'), t('receipt.buyerSign')]}
          note={`${t('receipt.printed')}: ${formatDateTime(printedAt)}`}
          closing={t('receipt.closing')}
        />
      </ReportSheet>
    </>
  );
}
