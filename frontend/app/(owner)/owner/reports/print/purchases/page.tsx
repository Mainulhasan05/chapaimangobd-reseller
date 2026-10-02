'use client';

/**
 * The purchase report: what was bought, from whom, and what it really cost.
 *
 * The column worth printing the sheet for is `avgLandedUnitCost` (docs/adr/0023):
 * the rate on the memo is not what a crate cost, because the van that brought it
 * and the labour that unloaded it are part of the price. It is printed beside the
 * goods cost and the landed cost so the difference between the two is visible
 * rather than asserted.
 *
 * The money side keeps two figures apart that a single "spent" total would merge:
 * what the sellers billed, which lands in their dues and will be paid later, and
 * what went to third parties, which is already gone and is owed to nobody.
 *
 * It honours the purchase list's filters (seller, status), so the sheet printed
 * from a filtered list is that list on paper, and it ends with every purchase
 * itemised: a summary nobody can check line by line is not evidence.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { t, tf, tUnit } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useGetPurchaseReportQuery } from '@/lib/store/endpoints/reports';
import { formatRange, type DateRange } from '@/components/ui/date-range';
import {
  Figure,
  KeyFigures,
  PrintBar,
  ReportEmpty,
  ReportFooter,
  ReportSection,
  ReportSheet,
  ReportTable,
  RTd,
  RTh,
  RTotalRow,
  SheetBody,
  useAutoPrint,
  useSheetRange,
} from '@/components/report/sheet';
import { Alert, ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function PurchaseReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <PurchaseReportView />
    </Suspense>
  );
}

function PurchaseReportView() {
  const params = useSearchParams();
  const sheet = useSheetRange();
  const payeeId = params.get('payeeId') ?? '';
  const supplyId = params.get('supplyId') ?? '';
  const status = params.get('status') ?? '';

  const report = useGetPurchaseReportQuery({ ...(sheet.range ?? {}), payeeId, supplyId, status });

  useAutoPrint(report.isSuccess && !report.isFetching, sheet.auto);

  const bar = <PrintBar back="/owner/purchases" range={sheet} />;

  if (report.isError && !report.data) {
    return (
      <>
        {bar}
        <ErrorState onRetry={() => report.refetch()} isRetrying={report.isFetching} error={report.error} />
      </>
    );
  }

  const data = report.data;
  if (!data) {
    return (
      <>
        {bar}
        <ListSkeleton />
      </>
    );
  }

  const totals = data.totals;
  const covered: DateRange =
    sheet.range ??
    (data.range.from && data.range.to ? { from: data.range.from, to: data.range.to } : null);
  const rows = data.rows ?? [];

  // The filters in words, from the rows they selected, so the paper says what it is a slice of.
  const filterWords = [
    payeeId ? (data.byPayee[0]?.nameBn ?? rows[0]?.payeeNameBn) : undefined,
    supplyId ? data.bySupply[0]?.nameBn : undefined,
    status === 'cancelled' ? t('purchase.cancelled') : status === 'received' ? t('purchase.recorded') : undefined,
  ].filter(Boolean);

  return (
    <>
      {bar}

      <SheetBody busy={report.isFetching}>
        <ReportSheet
          title={t('report.purchases')}
          subtitle={
            filterWords.length
              ? tf('report.filteredBy', { list: filterWords.join(' · ') })
              : t('report.purchasesHint')
          }
          range={covered ? formatRange(covered) : t('range.all')}
          meta={tf('report.rowCount', { n: formatNumber(totals.purchases) })}
        >
          <KeyFigures>
            <Figure label={t('nav.purchases')} value={formatNumber(totals.purchases)} />
            <Figure label={t('purchase.goodsCost')} value={formatMoney(totals.goodsCost)} />
            <Figure
              label={t('purchase.chargeTotal')}
              value={formatMoney(totals.chargeTotal)}
              hint={t('purchase.landedHint')}
            />
            <Figure label={t('purchase.spent')} value={formatMoney(totals.spent)} />
          </KeyFigures>

          {/*
           * Where the money went, split by who is owed. The two rows at the bottom
           * are not two views of the same total: one is a debt the sellers carry on
           * the books, the other is cash that left and is owed to nobody.
           */}
          <ReportSection title={t('report.summary')}>
            <ReportTable
              head={
                <>
                  <RTh>{t('report.summary')}</RTh>
                  <RTh align="right">{t('expense.amount')}</RTh>
                </>
              }
            >
              <tr>
                <RTd>{t('purchase.goodsCost')}</RTd>
                <RTd align="right">{formatMoney(totals.goodsCost)}</RTd>
              </tr>
              <tr>
                <RTd>
                  {t('purchase.chargeTotal')}
                  <span className="block text-xs text-muted-foreground">{t('purchase.landedHint')}</span>
                </RTd>
                <RTd align="right">{formatMoney(totals.chargeTotal)}</RTd>
              </tr>
              <RTotalRow>
                <RTd>{t('purchase.spent')}</RTd>
                <RTd align="right">{formatMoney(totals.spent)}</RTd>
              </RTotalRow>
              <tr>
                <RTd className="font-semibold">
                  {t('purchase.payeeTotal')}
                  <span className="block text-xs font-normal text-muted-foreground">{t('payee.dueHint')}</span>
                </RTd>
                <RTd align="right" className="font-semibold">
                  {formatMoney(totals.billedByPayees)}
                </RTd>
              </tr>
              <tr>
                <RTd className="font-semibold">
                  {t('purchase.otherCharge')}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t('purchase.paidToHint')}
                  </span>
                </RTd>
                <RTd align="right" className="font-semibold">
                  {formatMoney(totals.otherCharge)}
                </RTd>
              </tr>
            </ReportTable>
          </ReportSection>

          <ReportSection title={t('purchase.payee')}>
            {data.byPayee.length === 0 ? (
              <ReportEmpty />
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('payee.name')}</RTh>
                    <RTh align="right">{t('nav.purchases')}</RTh>
                    <RTh align="right">{t('purchase.goodsCost')}</RTh>
                    <RTh align="right">{t('purchase.chargeTotal')}</RTh>
                    <RTh align="right">{t('purchase.spent')}</RTh>
                    <RTh align="right">{t('purchase.payeeTotal')}</RTh>
                  </>
                }
              >
                {data.byPayee.map((row) => (
                  <tr key={row.payeeId}>
                    <RTd className="font-medium">{row.nameBn}</RTd>
                    <RTd align="right">{formatNumber(row.purchases)}</RTd>
                    <RTd align="right">{formatMoney(row.goodsCost)}</RTd>
                    <RTd align="right">{formatMoney(row.chargeTotal)}</RTd>
                    <RTd align="right" className="font-semibold">
                      {formatMoney(row.spent)}
                    </RTd>
                    <RTd align="right">{formatMoney(row.billed)}</RTd>
                  </tr>
                ))}
                <RTotalRow>
                  <RTd>{t('report.total')}</RTd>
                  <RTd align="right">{formatNumber(totals.purchases)}</RTd>
                  <RTd align="right">{formatMoney(totals.goodsCost)}</RTd>
                  <RTd align="right">{formatMoney(totals.chargeTotal)}</RTd>
                  <RTd align="right">{formatMoney(totals.spent)}</RTd>
                  <RTd align="right">{formatMoney(totals.billedByPayees)}</RTd>
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          {/*
           * The buying decision lives in the last column, which is why the section
           * gets its own sheet: a unit rate and a landed unit cost can be far apart,
           * and it is the second one that says whether the crate was cheap.
           */}
          <ReportSection title={t('nav.supplies')} hint={t('purchase.landedHint')} breakBefore>
            {data.bySupply.length === 0 ? (
              <ReportEmpty />
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('supply.name')}</RTh>
                    <RTh>{t('supply.unit')}</RTh>
                    <RTh align="right">{t('purchase.quantity')}</RTh>
                    <RTh align="right">{t('purchase.goodsCost')}</RTh>
                    <RTh align="right">{t('purchase.total')}</RTh>
                    <RTh align="right">{t('purchase.landedUnitCost')}</RTh>
                  </>
                }
              >
                {data.bySupply.map((row) => (
                  <tr key={row.supplyId}>
                    <RTd className="font-medium">{row.nameBn}</RTd>
                    <RTd>{tUnit(row.unit)}</RTd>
                    <RTd align="right">{formatNumber(row.quantity)}</RTd>
                    <RTd align="right">{formatMoney(row.goodsCost)}</RTd>
                    <RTd align="right">{formatMoney(row.landedCost)}</RTd>
                    <RTd align="right" className="font-bold">
                      {formatMoney(row.avgLandedUnitCost)}
                      <span className="block text-xs font-normal text-muted-foreground">{tUnit(row.unit)}</span>
                    </RTd>
                  </tr>
                ))}
              </ReportTable>
            )}
          </ReportSection>

          {/*
           * Every purchase, oldest first, so the sheet can be ticked off against the
           * memos. A cancelled one is listed, struck through and labelled, and never
           * added: the totals above count received purchases only.
           */}
          <ReportSection title={t('report.purchaseRows')} breakBefore>
            {data.truncated && (
              <Alert tone="warning">
                {tf('report.rowsTruncated', {
                  n: formatNumber(rows.length),
                  total: formatNumber(data.rowCount ?? rows.length),
                })}
              </Alert>
            )}
            {rows.length === 0 ? (
              <ReportEmpty />
            ) : (
              <>
                <ReportTable
                  head={
                    <>
                      <RTh>{t('app.date')}</RTh>
                      <RTh>{t('purchase.code')}</RTh>
                      <RTh>{t('payee.name')}</RTh>
                      <RTh align="right">{t('purchase.spent')}</RTh>
                      <RTh align="right">{t('purchase.payeeTotal')}</RTh>
                    </>
                  }
                >
                  {rows.map((row) => {
                    const cancelled = row.status === 'cancelled';
                    return (
                      <tr key={row.id} className={cn(cancelled && 'text-muted-foreground')}>
                        <RTd className="whitespace-nowrap">{formatDate(row.businessDate)}</RTd>
                        <RTd className="tabular">
                          <span className={cn('font-medium', cancelled && 'line-through')}>{row.purchaseCode}</span>
                          {row.invoiceNo && <span className="block text-xs text-muted-foreground">{row.invoiceNo}</span>}
                          {cancelled && <span className="block text-xs font-semibold">{t('purchase.cancelled')}</span>}
                        </RTd>
                        <RTd>
                          {row.payeeNameBn}
                          <span className="block text-xs text-muted-foreground">{row.supplies.join(', ')}</span>
                        </RTd>
                        <RTd align="right" className={cn(cancelled && 'line-through')}>
                          {formatMoney(row.spent)}
                        </RTd>
                        <RTd align="right" className={cn(cancelled && 'line-through')}>
                          {formatMoney(row.billed)}
                        </RTd>
                      </tr>
                    );
                  })}
                  <RTotalRow>
                    <RTd>{t('report.total')}</RTd>
                    <RTd />
                    <RTd />
                    <RTd align="right">{formatMoney(totals.spent)}</RTd>
                    <RTd align="right">{formatMoney(totals.billedByPayees)}</RTd>
                  </RTotalRow>
                </ReportTable>
                {rows.some((row) => row.status === 'cancelled') && (
                  <p className="mt-2 text-xs text-muted-foreground">{t('report.cancelledNotCounted')}</p>
                )}
              </>
            )}
          </ReportSection>

          <ReportFooter note={t('purchase.landedHint')} />
        </ReportSheet>
      </SheetBody>
    </>
  );
}
