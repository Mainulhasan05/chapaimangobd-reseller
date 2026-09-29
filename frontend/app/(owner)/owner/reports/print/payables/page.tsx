'use client';

/**
 * The payables sheet: who is owed money, right now.
 *
 * No date range, for the same reason the reseller due report has none: a balance
 * is not a property of a period but where an account stands at the moment the
 * sheet leaves the printer. "What was owed in March" is a question for the
 * ledger, and this sheet does not pretend to answer it.
 *
 * Dues and advances are two tables and two totals, never one netted figure. They
 * are different facts (docs/adr/0025): a due is money to hand over, an advance is
 * money already handed over against goods still to come. Subtracting one from the
 * other would produce a number that is nobody's obligation, and a printed sheet
 * is exactly where such a number would get believed.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tPayeeKind } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { PayablesReport } from '@/lib/types';
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

export default function PayablesReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <PayablesReportView />
    </Suspense>
  );
}

function PayablesReportView() {
  const params = useSearchParams();

  const report = useQuery({
    queryKey: ['owner', 'payables-report'],
    queryFn: () => api.get<PayablesReport>('/owner/reports/payables'),
  });

  useAutoPrint(report.isSuccess, params.get('auto') === '1');

  if (report.isError) {
    return (
      <>
        <PrintBar back="/owner/payees" />
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
        <PrintBar back="/owner/payees" />
        <ListSkeleton />
      </>
    );
  }

  const totals = data.totals;

  return (
    <>
      <PrintBar back="/owner/payees" />

      {/* No `range` prop: this sheet covers no period, only this moment. */}
      <ReportSheet
        title={t('report.payables')}
        subtitle={t('report.payablesHint')}
        meta={t('report.rowCount').replace('{n}', formatNumber(totals.payeeCount))}
      >
        <KeyFigures>
          <Figure
            label={t('payee.totalDue')}
            value={formatMoney(totals.due)}
            hint={t('payee.dueHint')}
            tone={totals.due > 0 ? 'danger' : undefined}
          />
          <Figure
            label={t('payee.totalAdvance')}
            value={formatMoney(totals.advance)}
            hint={t('payee.advanceHint')}
          />
          <Figure label={t('nav.payees')} value={formatNumber(totals.payeeCount)} />
          <Figure label={t('payee.owingOnly')} value={formatNumber(data.payables.length)} />
        </KeyFigures>

        <ReportSection title={t('payee.due')} hint={t('payee.dueHint')}>
          {data.payables.length === 0 ? (
            <Empty />
          ) : (
            <ReportTable
              head={
                <>
                  <RTh>{t('payee.name')}</RTh>
                  <RTh>{t('payee.kind')}</RTh>
                  <RTh>{t('auth.phone')}</RTh>
                  <RTh align="right">{t('payee.due')}</RTh>
                </>
              }
            >
              {data.payables.map((row) => (
                <tr key={row.payeeId}>
                  <RTd className="font-medium">
                    {row.nameBn}
                    {row.isArchived && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({t('app.inactive')})
                      </span>
                    )}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t('report.rowCount').replace('{n}', formatNumber(row.entries))}
                    </span>
                  </RTd>
                  <RTd className="text-xs">{tPayeeKind(row.kind)}</RTd>
                  <RTd className="tabular">{row.phone ?? '-'}</RTd>
                  <RTd align="right" className="tabular font-bold text-danger">
                    {formatMoney(row.due)}
                  </RTd>
                </tr>
              ))}
              <RTotalRow>
                <RTd>{t('payee.totalDue')}</RTd>
                <RTd />
                <RTd />
                <RTd align="right" className="tabular">
                  {formatMoney(totals.due)}
                </RTd>
              </RTotalRow>
            </ReportTable>
          )}
        </ReportSection>

        {/*
         * Advances, kept whole on their own sheet where they can be: handing this
         * page to somebody as the list of what to pay must not risk the two
         * tables running together across a fold.
         */}
        <ReportSection title={t('payee.advance')} hint={t('payee.advanceHint')} breakBefore>
          {data.advances.length === 0 ? (
            <Empty />
          ) : (
            <ReportTable
              head={
                <>
                  <RTh>{t('payee.name')}</RTh>
                  <RTh>{t('payee.kind')}</RTh>
                  <RTh>{t('auth.phone')}</RTh>
                  <RTh align="right">{t('payee.advance')}</RTh>
                </>
              }
            >
              {data.advances.map((row) => (
                <tr key={row.payeeId}>
                  <RTd className="font-medium">
                    {row.nameBn}
                    {row.isArchived && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({t('app.inactive')})
                      </span>
                    )}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t('report.rowCount').replace('{n}', formatNumber(row.entries))}
                    </span>
                  </RTd>
                  <RTd className="text-xs">{tPayeeKind(row.kind)}</RTd>
                  <RTd className="tabular">{row.phone ?? '-'}</RTd>
                  <RTd align="right" className="tabular font-semibold text-success">
                    {formatMoney(row.advance)}
                  </RTd>
                </tr>
              ))}
              <RTotalRow>
                <RTd>{t('payee.totalAdvance')}</RTd>
                <RTd />
                <RTd />
                <RTd align="right" className="tabular">
                  {formatMoney(totals.advance)}
                </RTd>
              </RTotalRow>
            </ReportTable>
          )}
        </ReportSection>

        <ReportFooter note={`${t('report.checkedBy')}: ______________________`} />
      </ReportSheet>
    </>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>;
}
