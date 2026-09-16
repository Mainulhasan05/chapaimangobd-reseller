'use client';

/**
 * The sales report: what the business traded over a range.
 *
 * Built around one distinction that is easy to get wrong and expensive to get
 * wrong. The owner's revenue is the wallet debit — goods at cost price plus the
 * delivery charge — and not the customer total, which includes the resellers'
 * margin and is therefore somebody else's money. Both are printed, next to each
 * other and labelled, so the sheet cannot be misread either way.
 *
 * Cancellations and returns are printed too. A sales report that omits them
 * flatters the period it covers, and the owner is the one person who cannot
 * afford a flattering version.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { SalesReport } from '@/lib/types';
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

export default function SalesReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <SalesView />
    </Suspense>
  );
}

function SalesView() {
  const params = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRange = from && to ? { from, to } : null;

  const report = useQuery({
    queryKey: ['owner', 'sales', from, to],
    queryFn: () =>
      api.get<SalesReport>(`/owner/reports/sales${range ? `?${rangeParams(range)}` : ''}`),
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

  return (
    <>
      <PrintBar back="/owner/reports" />

      {report.isLoading && <ListSkeleton />}

      {data && (
        <ReportSheet
          title={t('report.sales')}
          subtitle={t('report.salesHint')}
          range={formatRange(range ?? { from: data.from, to: data.to })}
          meta={t('report.orderCount').replace('{n}', formatNumber(data.totals.orders))}
        >
          <KeyFigures>
            <Figure
              label={t('owner.ownerRevenue')}
              value={formatMoney(data.totals.ownerRevenue)}
              hint={t('owner.ownerRevenueHint')}
            />
            <Figure label={t('owner.goodsValue')} value={formatMoney(data.totals.goods)} />
            <Figure
              label={t('owner.deliveryCollected')}
              value={formatMoney(data.totals.delivery)}
            />
            <Figure
              label={t('owner.customerValue')}
              value={formatMoney(data.totals.customerTotal)}
              hint={t('owner.resellerMargin') + ' ' + formatMoney(data.totals.resellerMargin)}
            />
          </KeyFigures>

          <ReportSection title={t('report.byDay')}>
            {data.days.length === 0 ? (
              <Empty />
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('app.date')}</RTh>
                    <RTh align="right">{t('nav.orders')}</RTh>
                    <RTh align="right">{t('owner.goodsValue')}</RTh>
                    <RTh align="right">{t('owner.deliveryCollected')}</RTh>
                    <RTh align="right">{t('owner.ownerRevenue')}</RTh>
                    <RTh align="right">{t('owner.customerValue')}</RTh>
                  </>
                }
              >
                {data.days.map((day) => (
                  <tr key={day.date}>
                    <RTd className="whitespace-nowrap">{formatDate(day.date)}</RTd>
                    <RTd align="right" className="tabular">
                      {formatNumber(day.orders)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(day.goods)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(day.delivery)}
                    </RTd>
                    <RTd align="right" className="tabular font-semibold">
                      {formatMoney(day.ownerRevenue)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(day.customerTotal)}
                    </RTd>
                  </tr>
                ))}
                <RTotalRow>
                  <RTd>{t('report.total')}</RTd>
                  <RTd align="right" className="tabular">
                    {formatNumber(data.totals.orders)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totals.goods)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totals.delivery)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totals.ownerRevenue)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totals.customerTotal)}
                  </RTd>
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          <ReportSection title={t('report.byProduct')}>
            {data.products.length === 0 ? (
              <Empty />
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('nav.products')}</RTh>
                    <RTh align="right">{t('order.quantity')}</RTh>
                    <RTh align="right">{t('nav.orders')}</RTh>
                    <RTh align="right">{t('owner.goodsValue')}</RTh>
                    <RTh align="right">{t('owner.customerValue')}</RTh>
                  </>
                }
              >
                {data.products.map((product) => (
                  <tr key={product.product}>
                    <RTd className="font-medium">{product.name}</RTd>
                    <RTd align="right" className="tabular">
                      {formatNumber(product.quantity)} {tUnit(product.unit)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatNumber(product.orders)}
                    </RTd>
                    <RTd align="right" className="tabular font-semibold">
                      {formatMoney(product.goods)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(product.customerTotal)}
                    </RTd>
                  </tr>
                ))}
              </ReportTable>
            )}
          </ReportSection>

          <ReportSection title={t('report.byPayment')}>
            <ReportTable
              head={
                <>
                  <RTh>{t('order.paymentMode')}</RTh>
                  <RTh align="right">{t('nav.orders')}</RTh>
                  <RTh align="right">{t('owner.ownerRevenue')}</RTh>
                  <RTh align="right">{t('owner.customerValue')}</RTh>
                </>
              }
            >
              {data.paymentModes.map((mode) => (
                <tr key={mode.mode}>
                  <RTd>{mode.mode === 'cod' ? t('order.cod') : t('order.prepaid')}</RTd>
                  <RTd align="right" className="tabular">
                    {formatNumber(mode.orders)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(mode.ownerRevenue)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(mode.customerTotal)}
                  </RTd>
                </tr>
              ))}
              {data.paymentModes.length === 0 && (
                <tr>
                  <RTd className="text-muted-foreground">{t('report.noRows')}</RTd>
                  <RTd />
                  <RTd />
                  <RTd />
                </tr>
              )}
            </ReportTable>
          </ReportSection>

          {/*
           * What did not trade, on the same sheet rather than in a separate
           * report nobody opens. These are the two numbers that turn a good
           * month into an average one, so they are not allowed to be elsewhere.
           */}
          <ReportSection title={t('report.notTraded')}>
            <ReportTable
              head={
                <>
                  <RTh>{t('app.status')}</RTh>
                  <RTh align="right">{t('nav.orders')}</RTh>
                  <RTh align="right">{t('owner.customerValue')}</RTh>
                </>
              }
            >
              <tr>
                <RTd>{t('order.cancelled')}</RTd>
                <RTd align="right" className="tabular">
                  {formatNumber(data.cancelled.orders)}
                </RTd>
                <RTd align="right" className="tabular">
                  {formatMoney(data.cancelled.customerTotal)}
                </RTd>
              </tr>
              <tr>
                <RTd>{t('order.returned')}</RTd>
                <RTd align="right" className="tabular">
                  {formatNumber(data.returned.orders)}
                </RTd>
                <RTd align="right" className="tabular">
                  {formatMoney(data.returned.customerTotal)}
                </RTd>
              </tr>
            </ReportTable>
          </ReportSection>

          <ReportFooter />
        </ReportSheet>
      )}
    </>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>;
}
