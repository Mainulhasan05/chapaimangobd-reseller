'use client';

/**
 * The stock report: what is on the shelf, against what has been leaving it.
 *
 * Neither number is a decision on its own. Forty kilos in stock is comfortable
 * or alarming depending entirely on whether forty kilos went out last week, and
 * until now those two figures lived on different screens.
 *
 * "Days left" is arithmetic, not a forecast — stock divided by the average day
 * in the range — so it is printed next to the average it came from rather than
 * on its own, where it would read as a promise.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { ProductsReport } from '@/lib/types';
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

export default function ProductsReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ProductsReportView />
    </Suspense>
  );
}

function ProductsReportView() {
  const params = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRange = from && to ? { from, to } : null;

  const report = useQuery({
    queryKey: ['owner', 'products-report', from, to],
    queryFn: () =>
      api.get<ProductsReport>(`/owner/reports/products${range ? `?${rangeParams(range)}` : ''}`),
  });

  useAutoPrint(report.isSuccess, params.get('auto') === '1');

  if (report.isError) {
    return (
      <>
        <PrintBar back="/owner/products" />
        <ErrorState
          onRetry={() => report.refetch()}
          isRetrying={report.isFetching}
          error={report.error}
        />
      </>
    );
  }

  const data = report.data;
  const rows = data?.products ?? [];
  const out = rows.filter((row) => row.trackStock && (row.stock ?? 0) <= 0);

  return (
    <>
      <PrintBar back="/owner/products" />

      {report.isLoading && <ListSkeleton />}

      {data && (
        <ReportSheet
          title={t('report.products')}
          subtitle={t('report.productsHint')}
          range={formatRange(range ?? { from: data.from, to: data.to })}
          meta={t('report.rowCount').replace('{n}', formatNumber(rows.length))}
        >
          <KeyFigures>
            <Figure label={t('nav.products')} value={formatNumber(rows.length)} />
            <Figure
              label={t('owner.lowStock')}
              value={formatNumber(out.length)}
              tone={out.length > 0 ? 'danger' : undefined}
            />
            <Figure
              label={t('owner.goodsValue')}
              value={formatMoney(rows.reduce((sum, row) => sum + row.goods, 0))}
            />
            <Figure
              label={t('owner.customerValue')}
              value={formatMoney(rows.reduce((sum, row) => sum + row.customerTotal, 0))}
            />
          </KeyFigures>

          <ReportSection title={t('nav.products')}>
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('nav.products')}</RTh>
                    <RTh align="right">{t('report.stock')}</RTh>
                    <RTh align="right">{t('order.quantity')}</RTh>
                    <RTh align="right">{t('report.perDay')}</RTh>
                    <RTh align="right">{t('report.daysLeft')}</RTh>
                    <RTh align="right">{t('owner.goodsValue')}</RTh>
                  </>
                }
              >
                {rows.map((row) => {
                  const outOfStock = row.trackStock && (row.stock ?? 0) <= 0;
                  return (
                    <tr key={row.product}>
                      <RTd className="font-medium">
                        {row.name}
                        {!row.isAvailable && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({t('app.inactive')})
                          </span>
                        )}
                      </RTd>
                      {/*
                       * Untracked stock is said in words. A dash or a zero here
                       * both read as "none left", and unlimited stock is the
                       * opposite of that. See Product.trackStock.
                       */}
                      <RTd
                        align="right"
                        className={`tabular ${outOfStock ? 'font-bold text-danger' : ''}`}
                      >
                        {row.trackStock ? (
                          `${formatNumber(row.stock ?? 0)} ${tUnit(row.unit)}`
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t('report.untracked')}
                          </span>
                        )}
                      </RTd>
                      <RTd align="right" className="tabular font-semibold">
                        {formatNumber(row.quantity)} {tUnit(row.unit)}
                      </RTd>
                      <RTd align="right" className="tabular">
                        {formatNumber(row.perDay)}
                      </RTd>
                      <RTd
                        align="right"
                        className={`tabular ${
                          row.daysLeft !== null && row.daysLeft <= 2 ? 'font-semibold text-danger' : ''
                        }`}
                      >
                        {row.daysLeft === null ? '—' : formatNumber(row.daysLeft)}
                      </RTd>
                      <RTd align="right" className="tabular">
                        {formatMoney(row.goods)}
                      </RTd>
                    </tr>
                  );
                })}
                <RTotalRow>
                  <RTd>{t('report.total')}</RTd>
                  <RTd />
                  <RTd />
                  <RTd />
                  <RTd />
                  <RTd align="right" className="tabular">
                    {formatMoney(rows.reduce((sum, row) => sum + row.goods, 0))}
                  </RTd>
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          <ReportFooter />
        </ReportSheet>
      )}
    </>
  );
}
