'use client';

/**
 * The expense report: what the money went on, by category, then every expense.
 *
 * Split by scope and kept split (docs/adr/0027). An order expense belongs to one
 * parcel - the courier, the extra for home delivery - and is already inside that
 * order's cost. A general expense (সাধারণ খরচ) - labour, the van, rent - belongs
 * to the business and is never divided across orders. The two are added into a
 * total under them, the same rule the expenses screen follows, so a figure on
 * paper can always be found on the screen.
 *
 * The unpaid figure is a slice of the total rather than an addition to it, so it
 * sits outside the totals rule with its own note. What is unpaid is also sitting
 * in a payee's due, where the payables sheet counts it.
 *
 * It honours the expense list's filters, so a sheet printed from a filtered list
 * is that list on paper.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { t, tf, tMethod } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { skipToken } from '@reduxjs/toolkit/query';
import { useGetExpenseReportQuery, type ExpenseReportView } from '@/lib/store/endpoints/reports';
import { useGetExpenseCategoriesQuery, useGetPayeesQuery } from '@/lib/store/endpoints/cost';
import { useGetOrderQuery } from '@/lib/store/endpoints/orders';
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

type Row = ExpenseReportView['byCategory'][number];

/** The two scopes in the words the expenses screen uses. */
const scopeWord = (scope: 'order' | 'period') =>
  scope === 'order' ? t('expense.scopeOrder') : t('expense.scopeGeneral');

export default function ExpenseReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ExpenseReportView />
    </Suspense>
  );
}

function ExpenseReportView() {
  const params = useSearchParams();
  const sheet = useSheetRange('thisMonth');
  const filters = {
    categoryId: params.get('categoryId') ?? '',
    payeeId: params.get('payeeId') ?? '',
    orderId: params.get('orderId') ?? '',
    scope: params.get('scope') ?? '',
    paymentStatus: params.get('paymentStatus') ?? '',
  };

  const report = useGetExpenseReportQuery({ ...(sheet.range ?? {}), ...filters });

  /*
   * The filters are named from their own records, not from the rows they
   * selected: a filter that matched nothing would otherwise print as an
   * unfiltered, empty sheet. Each read is skipped unless its filter is on.
   */
  const categories = useGetExpenseCategoriesQuery({ includeArchived: true }, { skip: !filters.categoryId });
  const payees = useGetPayeesQuery({ includeArchived: true }, { skip: !filters.payeeId });
  const order = useGetOrderQuery(filters.orderId ? { role: 'owner', id: filters.orderId } : skipToken);

  useAutoPrint(report.isSuccess && !report.isFetching, sheet.auto);

  const bar = <PrintBar back="/owner/expenses" range={sheet} />;

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
  const orderScope = data.byCategory.filter((row) => row.scope === 'order');
  const periodScope = data.byCategory.filter((row) => row.scope === 'period');
  const rows = data.rows ?? [];

  // The filters in words, so the paper says what it is a slice of.
  const filterWords = [
    filters.categoryId
      ? (categories.data?.categories.find((item) => item.id === filters.categoryId)?.nameBn ?? t('app.loading'))
      : undefined,
    filters.payeeId
      ? (payees.data?.payees.find((item) => item.id === filters.payeeId)?.nameBn ?? t('app.loading'))
      : undefined,
    filters.orderId ? (order.data?.order.orderCode ?? t('app.loading')) : undefined,
    filters.scope === 'order' || filters.scope === 'period' ? scopeWord(filters.scope) : undefined,
    filters.paymentStatus === 'paid'
      ? t('expense.paid')
      : filters.paymentStatus === 'unpaid'
        ? t('expense.unpaid')
        : undefined,
  ].filter(Boolean);

  return (
    <>
      {bar}

      <SheetBody busy={report.isFetching}>
        <ReportSheet
          title={t('report.expenses')}
          subtitle={
            filterWords.length
              ? tf('report.filteredBy', { list: filterWords.join(' · ') })
              : t('report.expensesHint')
          }
          range={covered ? formatRange(covered) : t('range.all')}
          meta={tf('report.rowCount', { n: formatNumber(data.rowCount ?? rows.length) })}
        >
          <KeyFigures>
            <Figure
              label={t('expense.totalOrder')}
              value={formatMoney(totals.order)}
              hint={t('expense.scopeOrderHint')}
            />
            <Figure label={t('expense.scopeGeneral')} value={formatMoney(totals.period)} />
            <Figure label={t('expense.totalAll')} value={formatMoney(totals.all)} />
            <Figure
              label={t('expense.totalUnpaid')}
              value={formatMoney(totals.unpaid)}
              hint={t('expense.unpaidHint')}
              tone={totals.unpaid > 0 ? 'danger' : undefined}
            />
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
                <RTd align="right" className="font-semibold">
                  {formatMoney(totals.order)}
                </RTd>
              </tr>
              <tr>
                <RTd className="font-semibold">
                  {t('expense.scopeGeneral')}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t('expense.scopeGeneralHint')}
                  </span>
                </RTd>
                <RTd align="right" className="font-semibold">
                  {formatMoney(totals.period)}
                </RTd>
              </tr>
              <RTotalRow>
                <RTd>{t('expense.totalAll')}</RTd>
                <RTd align="right">{formatMoney(totals.all)}</RTd>
              </RTotalRow>
              {/* A slice of the total above, not an addition to it. */}
              <tr>
                <RTd className="font-semibold">
                  {t('expense.totalUnpaid')}
                  <span className="block text-xs font-normal text-muted-foreground">{t('expense.unpaidHint')}</span>
                </RTd>
                <RTd align="right" className={`font-semibold ${totals.unpaid > 0 ? 'text-danger' : ''}`}>
                  {formatMoney(totals.unpaid)}
                </RTd>
              </tr>
            </ReportTable>
          </ReportSection>

          <ReportSection title={t('expense.scopeOrder')} hint={t('expense.scopeOrderHint')}>
            <ScopeTable rows={orderScope} total={totals.order} />
          </ReportSection>

          <ReportSection title={t('expense.scopeGeneral')} hint={t('expense.scopeGeneralHint')}>
            <ScopeTable rows={periodScope} total={totals.period} />
          </ReportSection>

          {/* Every expense, oldest first, so the sheet can be checked against the receipts. */}
          <ReportSection title={t('report.expenseRows')} breakBefore>
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
              <ReportTable
                head={
                  <>
                    <RTh>{t('app.date')}</RTh>
                    <RTh>{t('expense.category')}</RTh>
                    <RTh>{t('expense.payee')}</RTh>
                    <RTh>{t('expense.paymentStatus')}</RTh>
                    <RTh align="right">{t('expense.amount')}</RTh>
                  </>
                }
              >
                {rows.map((row) => (
                  <tr key={row.id}>
                    <RTd className="whitespace-nowrap">{formatDate(row.businessDate)}</RTd>
                    <RTd>
                      <span className="font-medium">{row.categoryNameBn}</span>
                      <span className="block text-xs text-muted-foreground">
                        {scopeWord(row.scope)}
                        {row.orderCode && ` · ${row.orderCode}`}
                      </span>
                      {row.note && <span className="block text-xs text-muted-foreground">{row.note}</span>}
                    </RTd>
                    <RTd>{row.payeeNameBn ?? '—'}</RTd>
                    <RTd className="text-xs">
                      {row.paymentStatus === 'paid' ? t('expense.paid') : t('expense.unpaid')}
                      {row.paidFrom && <span className="block text-muted-foreground">{tMethod(row.paidFrom)}</span>}
                    </RTd>
                    <RTd align="right">{formatMoney(row.amount)}</RTd>
                  </tr>
                ))}
                <RTotalRow>
                  <RTd>{t('expense.totalAll')}</RTd>
                  <RTd />
                  <RTd />
                  <RTd />
                  <RTd align="right">{formatMoney(totals.all)}</RTd>
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          <ReportFooter note={t('expense.scopeGeneralHint')} />
        </ReportSheet>
      </SheetBody>
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
              {tf('report.rowCount', { n: formatNumber(row.count) })}
            </span>
          </RTd>
          <RTd align="right">{formatMoney(row.amount)}</RTd>
        </tr>
      ))}
      <RTotalRow>
        <RTd>{t('report.total')}</RTd>
        <RTd align="right">{formatMoney(total)}</RTd>
      </RTotalRow>
    </ReportTable>
  );
}
