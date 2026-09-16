'use client';

/**
 * The customer report: who buys, and who costs money to sell to.
 *
 * No date range, like the due report. A customer record here is a standing
 * projection of every order a number has ever placed rather than a property of
 * a period — the phone number is the identity and the name is not, because the
 * same person orders for themselves on Monday and their brother on Friday. See
 * models/Customer.js.
 *
 * The refusal list is the reason this report exists. A number that orders ten
 * times and refuses six on delivery is not a good customer: on cash on delivery
 * that is the courier paid six times for nothing, and an order count alone
 * cannot show it.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { CustomerReportRow, CustomersReport } from '@/lib/types';
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
  useAutoPrint,
} from '@/components/report/sheet';
import { ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function CustomersReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <CustomersReportView />
    </Suspense>
  );
}

function CustomersReportView() {
  const params = useSearchParams();

  const report = useQuery({
    queryKey: ['owner', 'customers-report'],
    queryFn: () => api.get<CustomersReport>('/owner/reports/customers'),
  });

  useAutoPrint(report.isSuccess, params.get('auto') === '1');

  if (report.isError) {
    return (
      <>
        <PrintBar back="/owner/customers" />
        <ErrorState
          onRetry={() => report.refetch()}
          isRetrying={report.isFetching}
          error={report.error}
        />
      </>
    );
  }

  const data = report.data;
  const totals = data?.totals;
  const refused = (totals?.cancelled ?? 0) + (totals?.returned ?? 0);

  return (
    <>
      <PrintBar back="/owner/customers" />

      {report.isLoading && <ListSkeleton />}

      {data && totals && (
        <ReportSheet
          title={t('report.customers')}
          subtitle={t('report.customersHint')}
          meta={t('report.rowCount').replace('{n}', formatNumber(totals.customers))}
        >
          <KeyFigures>
            <Figure label={t('nav.customers')} value={formatNumber(totals.customers)} />
            <Figure label={t('nav.orders')} value={formatNumber(totals.orders)} />
            <Figure
              label={t('report.delivered')}
              value={formatNumber(totals.delivered)}
              tone="success"
            />
            {/*
             * Refusals as one figure, because cancelled and returned cost the
             * same thing on cash on delivery: a courier paid for nothing.
             */}
            <Figure
              label={t('report.riskyCustomers')}
              value={formatNumber(refused)}
              tone={refused > 0 ? 'danger' : undefined}
              hint={t('report.riskyHint')}
            />
          </KeyFigures>

          <ReportSection title={t('report.topCustomers')}>
            {data.top.length === 0 ? (
              <Empty />
            ) : (
              <ReportTable head={<Head />}>
                {data.top.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ReportTable>
            )}
          </ReportSection>

          {data.risky.length > 0 && (
            <ReportSection title={t('report.riskyCustomers')} hint={t('report.riskyHint')}>
              <ReportTable head={<Head />}>
                {data.risky.map((row) => (
                  <Row key={row.id} row={row} risky />
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

function Head() {
  return (
    <>
      <RTh>{t('order.customer')}</RTh>
      <RTh>{t('auth.phone')}</RTh>
      <RTh align="right">{t('nav.orders')}</RTh>
      <RTh align="right">{t('report.delivered')}</RTh>
      <RTh align="right">{t('order.cancelled')}</RTh>
      <RTh align="right">{t('order.returned')}</RTh>
      <RTh align="right">{t('report.spend')}</RTh>
      <RTh>{t('report.lastOrder')}</RTh>
    </>
  );
}

function Row({ row, risky }: { row: CustomerReportRow; risky?: boolean }) {
  const refused = row.cancelled + row.returned;

  return (
    <tr>
      <RTd className="font-medium">
        {row.name || '—'}
        {/*
         * How many different names this number has ordered under. Not noise:
         * eleven orders under four names is one buyer, and it is worth being
         * able to see that from the sheet.
         */}
        {row.nameCount > 1 && (
          <span className="ml-1 text-xs text-muted-foreground">+{formatNumber(row.nameCount - 1)}</span>
        )}
      </RTd>
      <RTd className="tabular">{row.phone}</RTd>
      <RTd align="right" className="tabular">
        {formatNumber(row.orders)}
      </RTd>
      <RTd align="right" className="tabular">
        {formatNumber(row.delivered)}
      </RTd>
      <RTd align="right" className={`tabular ${risky && row.cancelled > 0 ? 'text-danger' : ''}`}>
        {formatNumber(row.cancelled)}
      </RTd>
      <RTd align="right" className={`tabular ${risky && row.returned > 0 ? 'text-danger' : ''}`}>
        {formatNumber(row.returned)}
      </RTd>
      <RTd align="right" className={`tabular ${refused > 0 && risky ? '' : 'font-semibold'}`}>
        {formatMoney(row.spend)}
      </RTd>
      <RTd className="whitespace-nowrap text-xs">
        {row.lastOrderAt ? formatDate(row.lastOrderAt) : '—'}
      </RTd>
    </tr>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>;
}
