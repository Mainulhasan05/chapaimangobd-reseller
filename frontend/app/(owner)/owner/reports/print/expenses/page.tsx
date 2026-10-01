'use client';

/**
 * The expense report: what the money went on, by category.
 *
 * Split by scope and kept split (docs/adr/0027). An order expense belongs to one
 * parcel - the courier, the extra for home delivery - and is already inside that
 * order's cost. A period expense - labour, the van, rent - belongs to the day and
 * is never divided across orders. They are added into a single total at the
 * bottom of the summary, deliberately below the two figures that lead the sheet,
 * because the one number a reader should not walk away with is the sum: it
 * answers no question they were asking.
 *
 * The unpaid figure is a slice of the total rather than an addition to it, so it
 * sits outside the totals rule with its own note. What is unpaid is also sitting
 * in a payee's due, where the payables sheet counts it.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { ExpenseReport } from '@/lib/types';
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
import { ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';

type Row = ExpenseReport['byCategory'][number];

export default function ExpenseReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ExpenseReportView />
    </Suspense>
  );
}

function ExpenseReportView() {
  const params = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRange = from && to ? { from, to } : null;

  const report = useQuery({
    queryKey: ['owner', 'expense-report', from, to],
    queryFn: () =>
      api.get<ExpenseReport>(`/owner/reports/expenses${range ? `?${rangeParams(range)}` : ''}`),
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
  const orderScope = data.byCategory.filter((row) => row.scope === 'order');
  const periodScope = data.byCategory.filter((row) => row.scope === 'period');

  return (
    <>
      <PrintBar back="/owner/reports" />

      <ReportSheet
        title={t('report.expenses')}
        subtitle={t('report.expensesHint')}
        range={covered ? formatRange(covered) : t('range.all')}
        meta={t('report.rowCount').replace('{n}', formatNumber(data.byCategory.length))}
      >
        <KeyFigures>
          <Figure
            label={t('expense.totalOrder')}
            value={formatMoney(totals.order)}
            hint={t('expense.scopeOrderHint')}
          />
          <Figure
            label={t('expense.totalPeriod')}
            value={formatMoney(totals.period)}
            hint={t('expense.scopePeriodHint')}
          />
          <Figure
            label={t('expense.totalUnpaid')}
            value={formatMoney(totals.unpaid)}
            hint={t('expense.unpaidHint')}
            tone={totals.unpaid > 0 ? 'danger' : undefined}
          />
          <Figure label={t('expense.categories')} value={formatNumber(data.byCategory.length)} />
        </KeyFigures>

        <ReportSection title={t('report.summary')}>
          <ReportTable
            head={
              <>
                <RTh>{t('expense.scope')}</RTh>
                <RTh align="right">{t('expense.amount')}</RTh>
              </>
            }
          >
            <tr>
              <RTd className="font-semibold">
                {t('expense.totalOrder')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('expense.scopeOrderHint')}
                </span>
              </RTd>
              <RTd align="right" className="tabular font-semibold">
                {formatMoney(totals.order)}
              </RTd>
            </tr>
            <tr>
              <RTd className="font-semibold">
                {t('expense.totalPeriod')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('expense.scopePeriodHint')}
                </span>
              </RTd>
              <RTd align="right" className="tabular font-semibold">
                {formatMoney(totals.period)}
              </RTd>
            </tr>
            <RTotalRow>
              <RTd>{t('expense.totalAll')}</RTd>
              <RTd align="right" className="tabular">
                {formatMoney(totals.all)}
              </RTd>
            </RTotalRow>
            {/* A slice of the total above, not an addition to it. */}
            <tr>
              <RTd className="font-semibold">
                {t('expense.totalUnpaid')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('expense.unpaidHint')}
                </span>
              </RTd>
              <RTd
                align="right"
                className={`tabular font-semibold ${totals.unpaid > 0 ? 'text-danger' : ''}`}
              >
                {formatMoney(totals.unpaid)}
              </RTd>
            </tr>
          </ReportTable>
        </ReportSection>

        <ReportSection title={t('expense.scopeOrder')} hint={t('expense.scopeOrderHint')}>
          <ScopeTable rows={orderScope} total={totals.order} />
        </ReportSection>

        <ReportSection title={t('expense.scopePeriod')} hint={t('expense.scopePeriodHint')}>
          <ScopeTable rows={periodScope} total={totals.period} />
        </ReportSection>

        <ReportFooter note={t('expense.scopePeriodHint')} />
      </ReportSheet>
    </>
  );
}

/** One scope's categories. Identical shape both times, so the two compare. */
function ScopeTable({ rows, total }: { rows: Row[]; total: number }) {
  if (rows.length === 0) {
    return <ReportEmpty />;
  }

  return (
    <ReportTable
      head={
        <>
          <RTh>{t('expense.category')}</RTh>
          <RTh align="right">{t('expense.amount')}</RTh>
        </>
      }
    >
      {rows.map((row) => (
        <tr key={row.categoryId}>
          <RTd className="font-medium">
            {row.nameBn}
            <span className="block text-xs font-normal text-muted-foreground">
              {t('report.rowCount').replace('{n}', formatNumber(row.count))}
            </span>
          </RTd>
          <RTd align="right" className="tabular">
            {formatMoney(row.amount)}
          </RTd>
        </tr>
      ))}
      <RTotalRow>
        <RTd>{t('report.total')}</RTd>
        <RTd align="right" className="tabular">
          {formatMoney(total)}
        </RTd>
      </RTotalRow>
    </ReportTable>
  );
}
