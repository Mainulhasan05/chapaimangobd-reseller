'use client';

/**
 * The orchard report: every source side by side, worst record first.
 *
 * The sheet this whole feature exists to produce. It is read before a buying
 * trip, which is why it prints: the person deciding what to buy is standing in
 * a market, not sitting at the screen where the complaints were logged.
 *
 * Sorted by rate rather than by count. An orchard that sent two bad crates out
 * of three is a worse bet than one that sent five bad out of four hundred, and
 * sorting by count puts them the wrong way round.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tComplaintKind } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { SourcesReport } from '@/lib/types';
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

/**
 * The same judgement the orchard screen makes, kept identical on purpose: a
 * sheet that disagreed with the screen it was printed from would be worse than
 * no sheet. Five orders is the floor — two complaints out of two is a hundred
 * per cent and means almost nothing.
 */
const MIN_ORDERS_TO_JUDGE = 5;
const AVOID_RATE = 25;
const WATCH_RATE = 10;

export default function SourcesReportPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <SourcesReportView />
    </Suspense>
  );
}

function SourcesReportView() {
  const params = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRange = from && to ? { from, to } : null;

  const report = useQuery({
    queryKey: ['owner', 'sources-report', from, to],
    queryFn: () =>
      api.get<SourcesReport>(`/owner/reports/sources${range ? `?${rangeParams(range)}` : ''}`),
  });

  useAutoPrint(report.isSuccess, params.get('auto') === '1');

  if (report.isError) {
    return (
      <>
        <PrintBar back="/owner/sources" />
        <ErrorState
          onRetry={() => report.refetch()}
          isRetrying={report.isFetching}
          error={report.error}
        />
      </>
    );
  }

  const data = report.data;
  const supplying = data?.sources.filter((row) => row.orders > 0) ?? [];
  const quiet = data?.sources.filter((row) => row.orders === 0) ?? [];
  const avoid = supplying.filter(
    (row) => row.orders >= MIN_ORDERS_TO_JUDGE && (row.complaintRate ?? 0) >= AVOID_RATE
  );

  return (
    <>
      <PrintBar back="/owner/sources" />

      {report.isLoading && <ListSkeleton />}

      {data && (
        <ReportSheet
          title={t('report.sources')}
          subtitle={t('report.sourcesHint')}
          range={range ? formatRange(range) : t('range.all')}
          meta={t('report.rowCount').replace('{n}', formatNumber(supplying.length))}
        >
          <KeyFigures>
            <Figure label={t('nav.sources')} value={formatNumber(data.totals.supplying)} />
            <Figure label={t('nav.orders')} value={formatNumber(data.totals.orders)} />
            <Figure
              label={t('complaint.plural')}
              value={formatNumber(data.totals.complaints)}
              hint={
                data.totals.openComplaints > 0
                  ? t('complaint.openCount').replace(
                      '{n}',
                      formatNumber(data.totals.openComplaints)
                    )
                  : undefined
              }
              tone={data.totals.complaints > 0 ? 'danger' : undefined}
            />
            <Figure
              label={t('source.avoid')}
              value={formatNumber(avoid.length)}
              tone={avoid.length > 0 ? 'danger' : 'success'}
            />
          </KeyFigures>

          {/*
           * The conclusion, at the top, in words. Everything below is the
           * working: somebody about to spend money on fruit should not have to
           * derive the answer from a table while standing in a market.
           */}
          {avoid.length > 0 && (
            <ReportSection title={t('source.avoid')} hint={t('source.avoidHint')}>
              <ul className="space-y-1">
                {avoid.map((row) => (
                  <li
                    key={row.id}
                    className="print-block flex items-baseline justify-between gap-3 rounded-lg border border-danger/40 px-3 py-2"
                  >
                    <span className="font-bold">{row.name}</span>
                    <span className="tabular text-sm">
                      {formatNumber(row.complaintRate ?? 0)}% ·{' '}
                      {formatNumber(row.fruitComplaints)} / {formatNumber(row.orders)}
                    </span>
                  </li>
                ))}
              </ul>
            </ReportSection>
          )}

          <ReportSection title={t('source.record')}>
            {supplying.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>
            ) : (
              <ReportTable
                head={
                  <>
                    <RTh>{t('nav.sources')}</RTh>
                    <RTh align="right">{t('nav.orders')}</RTh>
                    <RTh align="right">{t('source.supplied')}</RTh>
                    <RTh align="right">{t('complaint.plural')}</RTh>
                    <RTh align="right">{t('source.complaintRate')}</RTh>
                    <RTh align="right">{t('order.returned')}</RTh>
                  </>
                }
              >
                {supplying.map((row) => {
                  const judged = row.orders >= MIN_ORDERS_TO_JUDGE;
                  const rate = row.complaintRate ?? 0;
                  return (
                    <tr key={row.id}>
                      <RTd className="font-medium">
                        {row.name}
                        {row.isArchived && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({t('app.inactive')})
                          </span>
                        )}
                        {/*
                         * Which kinds, in words, because "six complaints" and
                         * "six complaints, all of them short weight" lead to
                         * two completely different conversations.
                         */}
                        {row.complaints > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {Object.entries(row.byKind)
                              .map(
                                ([kind, count]) =>
                                  `${tComplaintKind(kind)} ${formatNumber(count as number)}`
                              )
                              .join(' · ')}
                          </span>
                        )}
                      </RTd>
                      <RTd align="right" className="tabular">
                        {formatNumber(row.orders)}
                      </RTd>
                      <RTd align="right" className="tabular">
                        {formatNumber(row.quantity)}
                        <span className="block text-xs text-muted-foreground">
                          {formatMoney(row.cost)}
                        </span>
                      </RTd>
                      <RTd align="right" className="tabular">
                        {formatNumber(row.complaints)}
                      </RTd>
                      <RTd
                        align="right"
                        className={`tabular font-semibold ${
                          judged && rate >= AVOID_RATE
                            ? 'text-danger'
                            : judged && rate >= WATCH_RATE
                              ? 'text-warning-ink'
                              : ''
                        }`}
                      >
                        {row.complaintRate === null ? '—' : `${formatNumber(rate)}%`}
                        {/*
                         * Too few orders to draw a conclusion from. Said rather
                         * than hidden: a blank would read as a clean record.
                         */}
                        {!judged && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {t('source.noRecord')}
                          </span>
                        )}
                      </RTd>
                      <RTd align="right" className="tabular">
                        {formatNumber(row.returned)}
                      </RTd>
                    </tr>
                  );
                })}
                <RTotalRow>
                  <RTd>{t('report.total')}</RTd>
                  <RTd align="right" className="tabular">
                    {formatNumber(data.totals.orders)}
                  </RTd>
                  <RTd />
                  <RTd align="right" className="tabular">
                    {formatNumber(data.totals.complaints)}
                  </RTd>
                  <RTd />
                  <RTd align="right" className="tabular">
                    {formatNumber(data.totals.returned)}
                  </RTd>
                </RTotalRow>
              </ReportTable>
            )}
          </ReportSection>

          {quiet.length > 0 && (
            <ReportSection title={t('source.noRecord')} hint={formatNumber(quiet.length)}>
              <p className="text-sm text-muted-foreground">
                {quiet.map((row) => row.name).join(' · ')}
              </p>
            </ReportSection>
          )}

          <ReportFooter />
        </ReportSheet>
      )}
    </>
  );
}
