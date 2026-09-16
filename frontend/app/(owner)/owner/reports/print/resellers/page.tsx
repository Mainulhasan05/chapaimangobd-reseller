'use client';

/**
 * The reseller report: who sold what over a range, against where they stand now.
 *
 * Two halves that are useless apart. Trade belongs to the range; the balance and
 * the credit limit belong to today. The question an owner actually asks about a
 * reseller is some version of "are they worth the credit I am extending them",
 * and neither half answers that alone.
 *
 * Everyone appears, including a reseller who sold nothing in the range, because
 * "sold nothing this month" is itself the finding and a report that quietly
 * dropped them would hide it.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatSignedMoney } from '@/lib/format';
import type { ResellerReport } from '@/lib/types';
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

export default function ResellerReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ResellerReportView />
    </Suspense>
  );
}

function ResellerReportView() {
  const params = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRange = from && to ? { from, to } : null;

  const report = useQuery({
    queryKey: ['owner', 'reseller-report', from, to],
    queryFn: () =>
      api.get<ResellerReport>(`/owner/reports/resellers${range ? `?${rangeParams(range)}` : ''}`),
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
  // Resellers who traded lead; the rest are listed after, not dropped.
  const traded = data?.resellers.filter((r) => r.orders > 0) ?? [];
  const quiet = data?.resellers.filter((r) => r.orders === 0) ?? [];

  return (
    <>
      <PrintBar back="/owner/reports" />

      {report.isLoading && <ListSkeleton />}

      {data && (
        <ReportSheet
          title={t('report.resellers')}
          subtitle={t('report.resellersHint')}
          range={formatRange(range ?? { from: data.from, to: data.to })}
          meta={`${formatNumber(traded.length)} / ${formatNumber(data.resellers.length)}`}
        >
          <KeyFigures>
            <Figure label={t('nav.resellers')} value={formatNumber(traded.length)} />
            <Figure label={t('nav.orders')} value={formatNumber(data.totals.orders)} />
            <Figure
              label={t('owner.ownerRevenue')}
              value={formatMoney(data.totals.ownerRevenue)}
              hint={t('owner.ownerRevenueHint')}
            />
            <Figure
              label={t('owner.resellerMargin')}
              value={formatMoney(data.totals.resellerMargin)}
            />
          </KeyFigures>

          <ReportSection title={t('nav.resellers')}>
            {traded.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('auth.shopName')}</RTh>
                    <RTh align="right">{t('nav.orders')}</RTh>
                    <RTh align="right">{t('owner.ownerRevenue')}</RTh>
                    <RTh align="right">{t('owner.resellerMargin')}</RTh>
                    <RTh align="right">{t('wallet.balance')}</RTh>
                    <RTh align="right">{t('wallet.creditLimit')}</RTh>
                  </>
                }
              >
                {traded.map((row) => (
                  <tr key={row.id}>
                    <RTd>
                      <div className="font-medium">{row.shopName}</div>
                      <div className="tabular text-xs text-muted-foreground">
                        {row.user?.phoneE164}
                        {!row.isActive && ` · ${t('app.inactive')}`}
                      </div>
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatNumber(row.orders)}
                      {row.cancelled > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          −{formatNumber(row.cancelled)}
                        </span>
                      )}
                    </RTd>
                    <RTd align="right" className="tabular font-semibold">
                      {formatMoney(row.ownerRevenue)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.resellerMargin)}
                    </RTd>
                    {/*
                     * Signed, and the sign is the point: negative is what they
                     * owe. Printing an absolute value here would turn a debt and
                     * a credit into the same mark on the page.
                     */}
                    <RTd
                      align="right"
                      className={`tabular ${row.balance < 0 ? 'font-semibold text-danger' : ''}`}
                    >
                      {formatSignedMoney(row.balance)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.creditLimit)}
                    </RTd>
                  </tr>
                ))}
                <RTotalRow>
                  <RTd>{t('report.total')}</RTd>
                  <RTd align="right" className="tabular">
                    {formatNumber(data.totals.orders)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totals.ownerRevenue)}
                  </RTd>
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totals.resellerMargin)}
                  </RTd>
                  <RTd />
                  <RTd />
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          {quiet.length > 0 && (
            <ReportSection
              title={t('report.noRows')}
              hint={formatNumber(quiet.length)}
            >
              <ReportTable
                head={
                  <>
                    <RTh>{t('auth.shopName')}</RTh>
                    <RTh align="right">{t('wallet.balance')}</RTh>
                  </>
                }
              >
                {quiet.map((row) => (
                  <tr key={row.id}>
                    <RTd>
                      <span className="font-medium">{row.shopName}</span>
                      <span className="tabular ml-2 text-xs text-muted-foreground">
                        {row.user?.phoneE164}
                      </span>
                    </RTd>
                    <RTd
                      align="right"
                      className={`tabular ${row.balance < 0 ? 'text-danger' : ''}`}
                    >
                      {formatSignedMoney(row.balance)}
                    </RTd>
                  </tr>
                ))}
              </ReportTable>
            </ReportSection>
          )}

          <ReportFooter />
        </ReportSheet>
      )}
    </>
  );
}
