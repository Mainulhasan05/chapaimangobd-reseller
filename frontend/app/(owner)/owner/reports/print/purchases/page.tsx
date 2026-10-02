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
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { t, tf, tUnit } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useGetPurchaseReportQuery } from '@/lib/store/endpoints/reports';
import { useGetPayeesQuery } from '@/lib/store/endpoints/cost';
import { useGetSuppliesQuery } from '@/lib/store/endpoints/catalog';
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
  const sheet = useSheetRange('thisMonth');
  const payeeId = params.get('payeeId') ?? '';
  const supplyId = params.get('supplyId') ?? '';
  const status = params.get('status') ?? '';

  const report = useGetPurchaseReportQuery({ ...(sheet.range ?? {}), payeeId, supplyId, status });

  /*
   * The filters are named from their own records, not from the rows they
   * selected: a filter that matched nothing would otherwise print as an
   * unfiltered, empty sheet. Each read is skipped unless its filter is on.
   */
  const payees = useGetPayeesQuery({ includeArchived: true }, { skip: !payeeId });
  const supplies = useGetSuppliesQuery({ includeArchived: true }, { skip: !supplyId });

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

  // The filters in words, so the paper says what it is a slice of.
  const filterWords = [
    payeeId ? (payees.data?.payees.find((item) => item.id === payeeId)?.nameBn ?? t('app.loading')) : undefined,
    supplyId
      ? (supplies.data?.supplies.find((item) => item.id === supplyId)?.nameBn ?? t('app.loading'))
      : undefined,
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
          {/*
           * Where the money went, split by who is owed. The middle two are not two
           * views of the same total: one is a debt the sellers carry on the books,
           * the other is cash that left and is owed to nobody. The first one says
           * what it is made of, which is what the old summary table under these
           * boxes used to repeat line for line.
           */}
          <KeyFigures>
            <Figure
              label={t('purchase.spent')}
              value={formatMoney(totals.spent)}
              hint={tf('purchase.breakdownLine', {
                goods: formatMoney(totals.goodsCost),
                charges: formatMoney(totals.chargeTotal),
              })}
            />
            <Figure
              label={t('purchase.payeeTotal')}
              value={formatMoney(totals.billedByPayees)}
              hint={t('payee.dueHint')}
            />
            <Figure label={t('purchase.otherCharge')} value={formatMoney(totals.otherCharge)} />
            <Figure label={t('nav.purchases')} value={formatNumber(totals.purchases)} />
          </KeyFigures>

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
           * The buying decision lives in the last column: a unit rate and a landed
           * unit cost can be far apart, and it is the second one that says whether
           * the crate was cheap. Not forced onto a sheet of its own any more: a
           * month with one purchase printed three mostly empty pages.
           */}
          <ReportSection title={t('nav.supplies')} hint={t('purchase.landedHint')}>
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
                    {/* The unit is in its own column; repeating it here doubled every row's height. */}
                    <RTd align="right" className="font-bold">
                      {formatMoney(row.avgLandedUnitCost)}
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
          <ReportSection title={t('report.purchaseRows')}>
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
                          {/* On screen, the way to that purchase's own receipt. On paper, just the number. */}
                          <Link
                            href={`/owner/reports/print/purchase/${row.id}`}
                            className={cn('font-medium text-primary-ink hover:underline', cancelled && 'line-through')}
                          >
                            {row.purchaseCode}
                          </Link>
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

          <ReportFooter />
        </ReportSheet>
      </SheetBody>
    </>
  );
}
