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
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { PurchaseReport } from '@/lib/types';
import { formatRange, rangeParams, type DateRange } from '@/components/ui/date-range';
import {
  Figure,
  KeyFigures,
  PrintBar,
  ReportFooter,
  ReportSection,
  ReportSheet,
  ReportTable,
  RTd,
  RTh,
  RTotalRow,
  useAutoPrint,
} from '@/components/report/sheet';
import { ErrorState } from '@/components/ui/layout';
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
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRange = from && to ? { from, to } : null;

  const report = useQuery({
    queryKey: ['owner', 'purchase-report', from, to],
    queryFn: () =>
      api.get<PurchaseReport>(`/owner/reports/purchases${range ? `?${rangeParams(range)}` : ''}`),
  });

  useAutoPrint(report.isSuccess, params.get('auto') === '1');

  if (report.isError) {
    return (
      <>
        <PrintBar back="/owner/reports" />
        <ErrorState
          onRetry={() => report.refetch()}
          isRetrying={report.isFetching}
          error={report.error}
        />
      </>
    );
  }

  const data = report.data;
  if (!data) {
    return (
      <>
        <PrintBar back="/owner/reports" />
        <ListSkeleton />
      </>
    );
  }

  const totals = data.totals;
  const covered: DateRange =
    range ??
    (data.range.from && data.range.to ? { from: data.range.from, to: data.range.to } : null);

  return (
    <>
      <PrintBar back="/owner/reports" />

      <ReportSheet
        title={t('report.purchases')}
        subtitle={t('report.purchasesHint')}
        range={covered ? formatRange(covered) : t('range.all')}
        meta={t('report.rowCount').replace('{n}', formatNumber(totals.purchases))}
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
              <RTd align="right" className="tabular">
                {formatMoney(totals.goodsCost)}
              </RTd>
            </tr>
            <tr>
              <RTd>
                {t('purchase.chargeTotal')}
                <span className="block text-xs text-muted-foreground">
                  {t('purchase.landedHint')}
                </span>
              </RTd>
              <RTd align="right" className="tabular">
                {formatMoney(totals.chargeTotal)}
              </RTd>
            </tr>
            <RTotalRow>
              <RTd>{t('purchase.spent')}</RTd>
              <RTd align="right" className="tabular">
                {formatMoney(totals.spent)}
              </RTd>
            </RTotalRow>
            <tr>
              <RTd className="font-semibold">
                {t('purchase.payeeTotal')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('payee.dueHint')}
                </span>
              </RTd>
              <RTd align="right" className="tabular font-semibold">
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
              <RTd align="right" className="tabular font-semibold">
                {formatMoney(totals.otherCharge)}
              </RTd>
            </tr>
          </ReportTable>
        </ReportSection>

        <ReportSection title={t('purchase.payee')}>
          {data.byPayee.length === 0 ? (
            <Empty />
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
                  <RTd align="right" className="tabular">
                    {formatNumber(row.purchases)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(row.goodsCost)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(row.chargeTotal)}
                  </RTd>
                  <RTd align="right" className="tabular font-semibold">
                    {formatMoney(row.spent)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(row.billed)}
                  </RTd>
                </tr>
              ))}
              <RTotalRow>
                <RTd>{t('report.total')}</RTd>
                <RTd align="right" className="tabular">
                  {formatNumber(totals.purchases)}
                </RTd>
                <RTd align="right" className="tabular">
                  {formatMoney(totals.goodsCost)}
                </RTd>
                <RTd align="right" className="tabular">
                  {formatMoney(totals.chargeTotal)}
                </RTd>
                <RTd align="right" className="tabular">
                  {formatMoney(totals.spent)}
                </RTd>
                <RTd align="right" className="tabular">
                  {formatMoney(totals.billedByPayees)}
                </RTd>
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
            <Empty />
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
                  <RTd align="right" className="tabular">
                    {formatNumber(row.quantity)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(row.goodsCost)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(row.landedCost)}
                  </RTd>
                  <RTd align="right" className="tabular font-bold">
                    {formatMoney(row.avgLandedUnitCost)}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {tUnit(row.unit)}
                    </span>
                  </RTd>
                </tr>
              ))}
            </ReportTable>
          )}
        </ReportSection>

        <ReportFooter note={t('purchase.landedHint')} />
      </ReportSheet>
    </>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>;
}
