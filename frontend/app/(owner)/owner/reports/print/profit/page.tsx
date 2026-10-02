'use client';

/**
 * The profit and loss sheet: what came in, what it cost, what is left.
 *
 * The one report in the cost family somebody will act on, so it is laid out as a
 * subtraction a reader can follow down the page rather than as four boxes they
 * have to reconcile in their head:
 *
 *     revenue - order cost - period expenses = net profit
 *
 * Three labels here carry the whole meaning, and each of them is a mistake the
 * app has already been careful about elsewhere (docs/adr/0027):
 *
 *   - `revenue` is what the owner BILLED the resellers: goods at cost plus the
 *     delivery charge. It is not the customer total, which contains the
 *     resellers' own margin and is somebody else's money.
 *   - `grossMargin` is struck BEFORE period costs and is therefore never called
 *     profit. A sheet that called it profit would read as a good month in a
 *     month that lost money on labour, so it says "সাধারণ খরচ বাদের আগে" —
 *     before the general costs — in so many words.
 *   - `netProfit` is the only figure allowed the word, and when it is negative
 *     the sheet says loss instead of printing profit with a minus in front of
 *     it, because a minus sign is the easiest thing on a page to miss.
 *
 * Period expenses (labour, the van) are subtracted ONCE, at the bottom, and are
 * never divided across orders. That is why the per-order table below does not
 * add up to the net figure, and why the sheet says so where it could mislead.
 */

import { Suspense } from 'react';
import { useGetProfitReportQuery } from '@/lib/store/endpoints/reports';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber, formatSignedMoney } from '@/lib/format';
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
import { ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function ProfitReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ProfitReportView />
    </Suspense>
  );
}

function ProfitReportView() {
  const sheet = useSheetRange('all');
  const range = sheet.range;
  const report = useGetProfitReportQuery(range ?? {});

  useAutoPrint(report.isSuccess && !report.isFetching, sheet.auto);

  if (report.isError && !report.data) {
    return (
      <>
        <PrintBar back="/owner/reports" range={sheet} />
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
        <PrintBar back="/owner/reports" range={sheet} />
        <ListSkeleton />
      </>
    );
  }

  const totals = data.totals;
  const covered: DateRange =
    range ??
    (data.range.from && data.range.to ? { from: data.range.from, to: data.range.to } : null);
  /*
   * A loss is announced as a loss. The figure itself is then printed unsigned
   * under that label, so the label and the number cannot contradict each other.
   */
  const isLoss = totals.netProfit < 0;

  return (
    <>
      <PrintBar back="/owner/reports" range={sheet} />

      <SheetBody busy={report.isFetching}>
        <ReportSheet
          title={t('report.profit')}
          subtitle={t('report.profitHint')}
          range={covered ? formatRange(covered) : t('range.all')}
          meta={t('report.orderCount').replace('{n}', formatNumber(totals.orders))}
        >
          <KeyFigures>
            <Figure
              label={t('profit.revenue')}
              value={formatMoney(totals.revenue)}
              hint={t('profit.revenueHint')}
            />
            <Figure label={t('profit.orderCost')} value={formatMoney(totals.orderCost)} />
            <Figure
              label={t('profit.grossMarginGeneral')}
              value={formatMoney(totals.grossMargin)}
              hint={t('profit.grossMarginHint')}
              tone={totals.grossMargin < 0 ? 'danger' : undefined}
            />
            <Figure
              label={isLoss ? t('profit.netLoss') : t('profit.net')}
              value={formatMoney(Math.abs(totals.netProfit))}
              hint={t('profit.periodHint')}
              tone={isLoss ? 'danger' : 'success'}
            />
          </KeyFigures>

          {/*
           * The working, as one column of signed figures. The three components of
           * order cost are indented under their subtotal rather than listed as
           * peers of it, so nothing on the page looks subtracted twice.
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
                <RTd className="font-semibold">
                  {t('profit.revenue')}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t('profit.revenueHint')}
                  </span>
                </RTd>
                <RTd align="right" className="tabular font-semibold">
                  {formatSignedMoney(totals.revenue)}
                </RTd>
              </tr>

              <tr>
                <RTd className="pl-6 text-muted-foreground">{t('cost.goods')}</RTd>
                <RTd align="right" className="tabular text-muted-foreground">
                  {formatSignedMoney(-totals.goods)}
                </RTd>
              </tr>
              <tr>
                <RTd className="pl-6 text-muted-foreground">{t('cost.packaging')}</RTd>
                <RTd align="right" className="tabular text-muted-foreground">
                  {formatSignedMoney(-totals.packaging)}
                </RTd>
              </tr>
              <tr>
                <RTd className="pl-6 text-muted-foreground">{t('cost.expenses')}</RTd>
                <RTd align="right" className="tabular text-muted-foreground">
                  {formatSignedMoney(-totals.orderExpenses)}
                </RTd>
              </tr>
              <tr>
                <RTd className="font-semibold">{t('profit.orderCost')}</RTd>
                <RTd align="right" className="tabular font-semibold">
                  {formatSignedMoney(-totals.orderCost)}
                </RTd>
              </tr>

              <RTotalRow>
                <RTd>
                  {t('profit.grossMarginGeneral')}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t('profit.grossMarginHint')}
                  </span>
                </RTd>
                <RTd
                  align="right"
                  className={`tabular ${totals.grossMargin < 0 ? 'text-danger' : ''}`}
                >
                  {formatMoney(totals.grossMargin)}
                </RTd>
              </RTotalRow>

              <tr>
                <RTd className="font-semibold">
                  {t('profit.generalExpenses')}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t('profit.periodHint')}
                  </span>
                </RTd>
                <RTd align="right" className="tabular font-semibold">
                  {formatSignedMoney(-totals.periodExpenses)}
                </RTd>
              </tr>

              <RTotalRow>
                <RTd>{isLoss ? t('profit.netLoss') : t('profit.net')}</RTd>
                <RTd
                  align="right"
                  className={`tabular text-base ${isLoss ? 'text-danger' : 'text-success'}`}
                >
                  {formatMoney(Math.abs(totals.netProfit))}
                </RTd>
              </RTotalRow>
            </ReportTable>
          </ReportSection>

          {/*
           * What was billed for delivery, on its own. Presented, not compared: what
           * the courier was paid is an order-scope expense already inside order
           * cost above, and a "delivery margin" invented here would be a second,
           * differently derived figure for the same thing.
           */}
          <ReportSection title={t('profit.deliveryGap')} hint={t('profit.deliveryGapHint')}>
            <p className="print-block tabular text-lg font-bold">
              {formatMoney(totals.deliveryCharged)}
            </p>
          </ReportSection>

          <ReportSection title={t('profit.generalExpenses')} hint={t('profit.periodHint')}>
            {data.periodExpenses.length === 0 ? (
              <ReportEmpty />
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('expense.category')}</RTh>
                    <RTh align="right">{t('expense.amount')}</RTh>
                  </>
                }
              >
                {data.periodExpenses.map((row) => (
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
                    {formatMoney(totals.periodExpenses)}
                  </RTd>
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          {/*
           * Worst margin first, as the API sorted it. Not re-sorted here: the
           * order is the point of the section, and its total column stops at gross
           * margin because the day's labour belongs to the period, not to a row.
           */}
          {/* Nine columns do not fit a portrait sheet; this section alone prints sideways. */}
          <ReportSection title={t('profit.perOrder')} hint={t('profit.worstFirst')} breakBefore landscape>
            {data.orders.length === 0 ? (
              <ReportEmpty />
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('order.code')}</RTh>
                    <RTh>{t('app.date')}</RTh>
                    <RTh>{t('app.status')}</RTh>
                    <RTh align="right">{t('profit.revenue')}</RTh>
                    <RTh align="right">{t('cost.goods')}</RTh>
                    <RTh align="right">{t('cost.packaging')}</RTh>
                    <RTh align="right">{t('cost.expenses')}</RTh>
                    <RTh align="right">{t('cost.total')}</RTh>
                    <RTh align="right">{t('cost.margin')}</RTh>
                  </>
                }
              >
                {data.orders.map((row) => (
                  <tr key={row.orderId}>
                    <RTd className="tabular whitespace-nowrap font-medium">{row.orderCode}</RTd>
                    <RTd className="whitespace-nowrap">{formatDate(row.businessDate)}</RTd>
                    <RTd className="text-xs">{tStatus(row.status)}</RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.revenue)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.goods)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.packaging)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.expenses)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.cost)}
                    </RTd>
                    <RTd
                      align="right"
                      className={`tabular font-semibold ${row.margin < 0 ? 'text-danger' : ''}`}
                    >
                      {formatSignedMoney(row.margin)}
                      {row.margin < 0 && (
                        <span className="block text-xs font-normal text-danger">
                          {t('cost.loss')}
                        </span>
                      )}
                    </RTd>
                  </tr>
                ))}
                <RTotalRow>
                  <RTd>{t('profit.grossMarginGeneral')}</RTd>
                  <RTd />
                  <RTd />
                  <RTd align="right" className="tabular">
                    {formatMoney(totals.revenue)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(totals.goods)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(totals.packaging)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(totals.orderExpenses)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(totals.orderCost)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(totals.grossMargin)}
                  </RTd>
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          <ReportFooter note={t('profit.periodHint')} />
        </ReportSheet>
      </SheetBody>
    </>
  );
}
