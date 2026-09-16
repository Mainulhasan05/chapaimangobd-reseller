'use client';

/**
 * The due report: who owes what, right now.
 *
 * The only report here with no date range, deliberately. A balance is not a
 * property of a period — it is where a wallet stands at the moment the sheet is
 * printed — so offering dates would invite the reading "what was owed in
 * March", which this cannot answer and the ledger export can.
 *
 * Debts and credits are both printed, in two sections rather than one signed
 * column, because they are two different conversations: one is money to chase
 * and the other is money to pay out. Every figure comes from the ledger rather
 * than the cached balance (docs/adr/0002), and a reseller whose cache disagrees
 * with its ledger is flagged rather than quietly printed.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
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
import { Alert, ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';

type Receivables = {
  totalOwed: number;
  totalPayable: number;
  openOrders: number;
  resellers: {
    id: string;
    shopName: string;
    user?: { name: string; phoneE164: string };
    balance: number;
    owed: number;
    payable: number;
    creditLimit: number;
    atLimit: boolean;
    drift: boolean;
  }[];
};

export default function DueReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <DueReportView />
    </Suspense>
  );
}

function DueReportView() {
  const params = useSearchParams();

  const report = useQuery({
    queryKey: ['owner', 'receivables'],
    queryFn: () => api.get<Receivables>('/owner/reports/receivables'),
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
  const debtors = data?.resellers.filter((row) => row.owed > 0) ?? [];
  const creditors = data?.resellers.filter((row) => row.payable > 0) ?? [];
  const drifted = data?.resellers.filter((row) => row.drift) ?? [];

  return (
    <>
      <PrintBar back="/owner/reports" />

      {report.isLoading && <ListSkeleton />}

      {data && (
        <ReportSheet
          title={t('report.due')}
          subtitle={t('report.dueHint')}
          meta={t('report.rowCount').replace('{n}', formatNumber(data.resellers.length))}
        >
          <KeyFigures>
            <Figure
              label={t('owner.receivable')}
              value={formatMoney(data.totalOwed)}
              tone={data.totalOwed > 0 ? 'danger' : undefined}
              hint={`${formatNumber(debtors.length)} ${t('nav.resellers')}`}
            />
            <Figure
              label={t('reports.payable')}
              value={formatMoney(data.totalPayable)}
              hint={`${formatNumber(creditors.length)} ${t('nav.resellers')}`}
            />
            <Figure label={t('nav.orders')} value={formatNumber(data.openOrders)} />
            <Figure
              label={t('reports.atLimit')}
              value={formatNumber(data.resellers.filter((row) => row.atLimit).length)}
              tone={data.resellers.some((row) => row.atLimit) ? 'danger' : undefined}
            />
          </KeyFigures>

          {/*
           * A wallet whose cached balance disagrees with its ledger. Rare and
           * serious: it means one of the two numbers in this report is wrong,
           * so it is said at the top rather than as a mark in a column.
           */}
          {drifted.length > 0 && (
            <Alert tone="warning">{t('reports.driftHint')}</Alert>
          )}

          <ReportSection title={t('wallet.owed')} hint={formatMoney(data.totalOwed)}>
            {debtors.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('auth.shopName')}</RTh>
                    <RTh>{t('auth.phone')}</RTh>
                    <RTh align="right">{t('wallet.owed')}</RTh>
                    <RTh align="right">{t('wallet.creditLimit')}</RTh>
                    <RTh>{t('app.status')}</RTh>
                  </>
                }
              >
                {debtors.map((row) => (
                  <tr key={row.id}>
                    <RTd className="font-medium">{row.shopName}</RTd>
                    <RTd className="tabular">{row.user?.phoneE164}</RTd>
                    <RTd align="right" className="tabular font-bold text-danger">
                      {formatMoney(row.owed)}
                    </RTd>
                    <RTd align="right" className="tabular">
                      {formatMoney(row.creditLimit)}
                    </RTd>
                    <RTd className="text-xs">
                      {row.atLimit && (
                        <span className="font-semibold text-danger">{t('reports.atLimit')}</span>
                      )}
                      {row.drift && (
                        <span className="ml-1 text-warning-ink">{t('reports.drift')}</span>
                      )}
                    </RTd>
                  </tr>
                ))}
                <RTotalRow>
                  <RTd>{t('report.total')}</RTd>
                  <RTd />
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totalOwed)}
                  </RTd>
                  <RTd />
                  <RTd />
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          {creditors.length > 0 && (
            <ReportSection title={t('reports.payable')} hint={formatMoney(data.totalPayable)}>
              <ReportTable
                head={
                  <>
                    <RTh>{t('auth.shopName')}</RTh>
                    <RTh>{t('auth.phone')}</RTh>
                    <RTh align="right">{t('reports.payable')}</RTh>
                  </>
                }
              >
                {creditors.map((row) => (
                  <tr key={row.id}>
                    <RTd className="font-medium">{row.shopName}</RTd>
                    <RTd className="tabular">{row.user?.phoneE164}</RTd>
                    <RTd align="right" className="tabular font-semibold text-success">
                      {formatMoney(row.payable)}
                    </RTd>
                  </tr>
                ))}
                <RTotalRow>
                  <RTd>{t('report.total')}</RTd>
                  <RTd />
                  <RTd align="right" className="tabular">
                    {formatMoney(data.totalPayable)}
                  </RTd>
                </RTotalRow>
              </ReportTable>
            </ReportSection>
          )}

          <ReportFooter note={`${t('report.checkedBy')}: ______________________`} />
        </ReportSheet>
      )}
    </>
  );
}
