'use client';

/**
 * The inventory sheet: what is on the shelf, what it is worth, what to buy.
 *
 * Two states are worth printing this for, and they are not the same state:
 *
 *   - `isNegative` means the records say less than nothing is on the shelf, so
 *     more was consumed than was ever recorded as received. It is not a warning
 *     about the future, it is a statement that the count is already wrong, and it
 *     is the one thing here that needs acting on. Said at the top, in words,
 *     before any table.
 *   - `isLow` is an ordinary warning: still true, still positive, buy some soon.
 *
 * `estimatedUsed` is the part of consumption a packaging recipe worked out rather
 * than anybody counting (docs/adr/0026). It is printed in its own column and
 * labelled an estimate, because a reader holding a sheet in a storeroom must be
 * able to tell which of these numbers somebody measured.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { SupplyReport } from '@/lib/types';
import { formatRange, rangeParams, type DateRange } from '@/components/ui/date-range';
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
  useAutoPrint,
} from '@/components/report/sheet';
import { Alert, ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function SupplyReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <SupplyReportView />
    </Suspense>
  );
}

function SupplyReportView() {
  const params = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRange = from && to ? { from, to } : null;

  const report = useQuery({
    queryKey: ['owner', 'supply-report', from, to],
    queryFn: () =>
      api.get<SupplyReport>(`/owner/reports/supplies${range ? `?${rangeParams(range)}` : ''}`),
  });

  useAutoPrint(report.isSuccess, params.get('auto') === '1');

  if (report.isError) {
    return (
      <>
        <PrintBar back="/owner/supplies" />
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
        <PrintBar back="/owner/supplies" />
        <ListSkeleton />
      </>
    );
  }

  const totals = data.totals;
  const covered: DateRange =
    range ??
    (data.range.from && data.range.to ? { from: data.range.from, to: data.range.to } : null);
  const negative = data.supplies.filter((row) => row.isNegative);
  const low = data.supplies.filter((row) => row.isLow && !row.isNegative);

  return (
    <>
      <PrintBar back="/owner/supplies" />

      <ReportSheet
        title={t('report.supplies')}
        subtitle={t('report.suppliesHint')}
        range={covered ? formatRange(covered) : t('range.all')}
        meta={t('report.rowCount').replace('{n}', formatNumber(data.supplies.length))}
      >
        <KeyFigures>
          <Figure label={t('supply.itemCount')} value={formatNumber(totals.items)} />
          <Figure label={t('supply.value')} value={formatMoney(totals.value)} />
          <Figure label={t('supply.low')} value={formatNumber(totals.lowCount)} />
          <Figure
            label={t('supply.negative')}
            value={formatNumber(totals.negativeCount)}
            hint={totals.negativeCount > 0 ? t('supply.negativeHint') : undefined}
            tone={totals.negativeCount > 0 ? 'danger' : 'success'}
          />
        </KeyFigures>

        {/*
         * The conclusion first, in words. A count that has gone below zero is not
         * a column to spot: it means a shelf and a record disagree, and somebody
         * has to go and count. The items are named so the walk is short.
         */}
        {negative.length > 0 && (
          <>
            <Alert tone="danger">{t('supply.negativeHint')}</Alert>
            <ReportSection title={t('supply.negative')} hint={t('supply.stockTake')}>
              <ul className="space-y-1">
                {negative.map((row) => (
                  <li
                    key={row.supplyId}
                    className="print-block flex items-baseline justify-between gap-3 rounded-lg border border-danger/40 px-3 py-2"
                  >
                    <span className="font-bold">{row.nameBn}</span>
                    <span className="tabular text-sm font-semibold text-danger">
                      {formatNumber(row.onHand)} {tUnit(row.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            </ReportSection>
          </>
        )}

        {low.length > 0 && (
          <ReportSection title={t('supply.low')} hint={t('supply.reorderHint')}>
            <p className="text-sm text-muted-foreground">
              {low.map((row) => row.nameBn).join(' / ')}
            </p>
          </ReportSection>
        )}

        {/*
         * One table, every column, no exceptions: a storeroom sheet missing the
         * estimate column would read as if every figure on it had been counted.
         */}
        <ReportSection title={t('supply.title')} hint={t('supply.estimatedHint')}>
          {data.supplies.length === 0 ? (
            <ReportEmpty />
          ) : (
            <ReportTable
              head={
                <>
                  <RTh>{t('supply.name')}</RTh>
                  <RTh>{t('supply.unit')}</RTh>
                  <RTh align="right">{t('supply.onHand')}</RTh>
                  <RTh align="right">{t('supply.reorderLevel')}</RTh>
                  <RTh align="right">{t('supply.avgCost')}</RTh>
                  <RTh align="right">{t('supply.value')}</RTh>
                  <RTh align="right">{t('movement.PURCHASE')}</RTh>
                  <RTh align="right">{t('movement.CONSUMED')}</RTh>
                  <RTh align="right">{t('supply.estimated')}</RTh>
                </>
              }
            >
              {data.supplies.map((row) => (
                <tr key={row.supplyId}>
                  <RTd className="font-medium">
                    {row.nameBn}
                    {row.isNegative && (
                      <span className="block text-xs font-bold text-danger">
                        {t('supply.negative')}
                      </span>
                    )}
                    {!row.isNegative && row.isLow && (
                      <span className="block text-xs font-semibold text-warning-ink">
                        {t('supply.low')}
                      </span>
                    )}
                  </RTd>
                  <RTd>{tUnit(row.unit)}</RTd>
                  <RTd
                    align="right"
                    className={`tabular font-semibold ${
                      row.isNegative ? 'text-danger' : row.isLow ? 'text-warning-ink' : ''
                    }`}
                  >
                    {formatNumber(row.onHand)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {row.reorderLevel > 0 ? formatNumber(row.reorderLevel) : '-'}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(row.avgCost)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(row.value)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatNumber(row.received)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatNumber(row.used)}
                  </RTd>
                  {/*
                   * The estimated share of the column beside it, repeated as a
                   * word rather than left to a footnote nobody reads standing up.
                   */}
                  <RTd align="right" className="tabular text-muted-foreground">
                    {formatNumber(row.estimatedUsed)}
                    <span className="block text-xs">{t('supply.estimated')}</span>
                  </RTd>
                </tr>
              ))}
              <RTotalRow>
                <RTd>{t('report.total')}</RTd>
                <RTd />
                <RTd />
                <RTd />
                <RTd />
                <RTd align="right" className="tabular">
                  {formatMoney(totals.value)}
                </RTd>
                <RTd />
                <RTd />
                <RTd />
              </RTotalRow>
            </ReportTable>
          )}
        </ReportSection>

        <ReportFooter note={t('supply.estimatedHint')} />
      </ReportSheet>
    </>
  );
}
