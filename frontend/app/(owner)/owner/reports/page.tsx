'use client';

/**
 * Every report, the figures worth a glance, and the spreadsheet exports.
 *
 * One range for the whole screen, kept in the URL. It drives the figures, every
 * report card and every export. They each used to decide for themselves — the
 * table read two date fields and the exports read nothing at all, so pressing
 * "orders CSV" under a one-day view downloaded the entire history. A reporting
 * screen with more than one idea of which days it is showing is a screen that
 * cannot be trusted. It opens on this month, like every cost screen.
 *
 * A card opens its sheet to read; nothing prints until a print or download
 * button is pressed. The cards used to fire the print dialog on arrival, which
 * on a phone meant an Android print sheet over a report nobody had seen yet.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight, ClipboardList, Download, FileSpreadsheet, TrendingDown } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tf, tUnit, type DictKey } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatSignedMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUrlRange } from '@/lib/use-url-state';
import {
  exportHref,
  useGetPayablesReportQuery,
  useGetProductsSoldQuery,
  useGetProfitReportQuery,
  useGetReceivablesQuery,
  useLazyGetReconcileQuery,
} from '@/lib/store/endpoints/reports';
import { useGetExpensesInfiniteQuery, useGetPurchasesInfiniteQuery } from '@/lib/store/endpoints/cost';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button, ButtonLink, buttonVariants } from '@/components/ui/button';
import { Skeleton, ListSkeleton } from '@/components/ui/skeleton';
import { DateRangeFilter, formatRange, type DateRange, type PresetKey } from '@/components/ui/date-range';
import {
  REPORTS,
  reportHref,
  type ReportGroup,
  type ReportInfo,
} from '@/components/report/download-menu';

const GROUPS: { group: ReportGroup; titleKey: DictKey }[] = [
  { group: 'sales', titleKey: 'report.groupSales' },
  { group: 'people', titleKey: 'report.groupPeople' },
  { group: 'cost', titleKey: 'report.groupCost' },
];

/**
 * One report, as a card. A card rather than a link, because on a phone this is
 * the tap target and a line of text is not one.
 *
 * Each card says whether it follows the range above or is a snapshot of today,
 * because "due" and "payables" ignore the dates on purpose and a person who
 * picked last week would otherwise think the sheet was wrong.
 */
function ReportCard({
  report,
  range,
  preset,
}: {
  report: ReportInfo;
  range: DateRange;
  preset: PresetKey | 'custom';
}) {
  const Icon = report.icon;

  return (
    <Link
      href={reportHref(report.kind, range, { preset, auto: false })}
      className="card card-interactive group flex h-full min-w-0 items-start gap-3 p-4"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-softer">
        <Icon className="h-5 w-5 text-primary-ink" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{t(report.labelKey)}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{t(report.hintKey)}</span>
        <Badge tone={report.ranged ? 'neutral' : 'warning'} className="mt-2 px-2 py-0.5">
          {report.ranged ? t('report.ranged') : t('report.snapshot')}
        </Badge>
      </span>
      <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** A labelled block of the page. */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** A figure that is loading shows a bar, a failed one a dash: never a ৳০ that was not counted. */
function figure(ready: boolean, failed: boolean, value: () => string): React.ReactNode {
  if (ready) return value();
  if (failed) return t('app.notAvailable');
  return <Skeleton className="h-8 w-28" />;
}

export default function OwnerReportsPage() {
  const { preset, range, setRange } = useUrlRange('thisMonth');
  const rangeArgs = range ?? {};

  const receivables = useGetReceivablesQuery();
  const sold = useGetProductsSoldQuery(rangeArgs);
  const [runReconcile, reconcile] = useLazyGetReconcileQuery();

  // The cost glance: three figures, each read from the cheapest source that has it.
  const profit = useGetProfitReportQuery(rangeArgs);
  const payables = useGetPayablesReportQuery();
  const purchaseTotals = useGetPurchasesInfiniteQuery({ ...rangeArgs, limit: 1 });
  const expenseTotals = useGetExpensesInfiniteQuery({ ...rangeArgs, limit: 1 });
  const spentPurchases = purchaseTotals.data?.pages[0]?.totals.spent;
  const spentExpenses = expenseTotals.data?.pages[0]?.totals.all;

  const netProfit = profit.data?.totals.netProfit ?? 0;
  const isLoss = netProfit < 0;
  const preview = (kind: Parameters<typeof reportHref>[0]) => reportHref(kind, range, { preset, auto: false });
  const query = range ? { from: range.from, to: range.to } : undefined;
  const shopOf = (id: string) => receivables.data?.resellers.find((row) => row.id === id)?.shopName;

  return (
    <>
      <PageHeader title={t('nav.reports')} subtitle={formatRange(range)} />

      {/* The range every figure, card and export on this page is built from. */}
      <DateRangeFilter className="mb-5" preset={preset} range={range} onChange={setRange} />

      {/*
       * Where the business stands on the cost side, before the long list of
       * sheets: what is left after every cost, who is waiting to be paid, and
       * how much went out in these days. Each opens its sheet.
       */}
      <Section title={t('report.costGlance')} hint={formatRange(range)}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat
            className="col-span-2 sm:col-span-1"
            label={isLoss ? t('profit.netLoss') : t('profit.net')}
            value={figure(profit.isSuccess, profit.isError, () => formatMoney(Math.abs(netProfit)))}
            hint={t('profit.netHint')}
            tone={profit.isSuccess ? (isLoss ? 'danger' : 'success') : 'neutral'}
            href={preview('profit')}
          />
          <Stat
            label={t('payee.totalDue')}
            value={figure(payables.isSuccess, payables.isError, () => formatMoney(payables.data!.totals.due))}
            hint={t('report.snapshot')}
            tone={(payables.data?.totals.due ?? 0) > 0 ? 'warning' : 'neutral'}
            href={preview('payables')}
          />
          <Stat
            label={t('report.spendInRange')}
            value={figure(
              spentPurchases !== undefined && spentExpenses !== undefined,
              purchaseTotals.isError || expenseTotals.isError,
              () => formatMoney((spentPurchases ?? 0) + (spentExpenses ?? 0))
            )}
            hint={
              spentPurchases !== undefined && spentExpenses !== undefined
                ? tf('report.spendSplit', {
                    purchases: formatMoney(spentPurchases),
                    expenses: formatMoney(spentExpenses),
                  })
                : undefined
            }
            href={preview('purchases')}
          />
        </div>
      </Section>

      {/*
       * Every report, as cards rather than a menu, because this is the screen
       * someone opens when they do not already know which one they want. Grouped
       * the way the business is: what was sold, who it was sold through, and
       * what it cost.
       */}
      {GROUPS.map(({ group, titleKey }) => (
        <Section key={group} title={t(titleKey)}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {REPORTS.filter((report) => report.group === group).map((report) => (
              <ReportCard key={report.kind} report={report} range={range} preset={preset} />
            ))}
          </div>
        </Section>
      ))}

      {/*
       * The CSVs, which are a different thing from a report: a file to open in a
       * spreadsheet rather than a sheet to print. They carry the range above them,
       * which is the whole reason they are here and not in the header.
       */}
      <Section title={t('report.export')}>
        <Card className="p-4 sm:p-4">
          <div className="mb-3 flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft">
              <FileSpreadsheet className="h-5 w-5 text-success-ink" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">CSV</span>
              <span className="block text-xs text-muted-foreground">{t('report.exportHint')}</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {(
              [
                ['orders.csv', t('nav.orders')],
                ['ledger.csv', t('wallet.ledger')],
                ['purchases.csv', t('nav.purchases')],
                ['expenses.csv', t('nav.expenses')],
              ] as const
            ).map(([file, label]) => (
              <a
                key={file}
                href={exportHref(file, query)}
                download
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Download className="h-4 w-4" />
                {label}
              </a>
            ))}
          </div>
        </Card>
      </Section>

      <Section title={t('report.glance')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat
            icon={TrendingDown}
            label={t('owner.receivable')}
            value={figure(receivables.isSuccess, receivables.isError, () =>
              formatMoney(receivables.data!.totalOwed)
            )}
            tone={(receivables.data?.totalOwed ?? 0) > 0 ? 'danger' : 'neutral'}
          />
          <Stat
            icon={ClipboardList}
            tone="primary"
            label={t('report.openOrders')}
            value={figure(receivables.isSuccess, receivables.isError, () =>
              formatNumber(receivables.data!.openOrders)
            )}
            href="/owner/orders?status=accepted,packed,shipped"
          />
          {/* The check and its answer together, not the answer at the foot of the page. */}
          <Card className="col-span-2 flex flex-col justify-center p-4 sm:col-span-1">
            <Button variant="outline" loading={reconcile.isFetching} onClick={() => runReconcile()}>
              {t('owner.reconcile')}
            </Button>
            {reconcile.data && !reconcile.isFetching && (
              <div role="status" className="mt-2 text-sm">
                {reconcile.data.drifted.length === 0 ? (
                  <p className="font-medium text-success-ink">
                    {tf('reconcile.checkedOk', { n: formatNumber(reconcile.data.checked) })}
                  </p>
                ) : (
                  <>
                    <p className="font-semibold text-danger-ink">
                      {tf('reconcile.drifted', { n: formatNumber(reconcile.data.drifted.length) })}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {reconcile.data.drifted.map((row) => (
                        <li key={row.reseller}>
                          <Link
                            href={`/owner/resellers/${row.reseller}` as Route}
                            className="tap inline-flex items-center font-semibold text-primary-ink underline"
                          >
                            {shopOf(row.reseller) ?? t('nav.resellers')}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-muted-foreground">{t('reports.driftHint')}</p>
                  </>
                )}
              </div>
            )}
            {reconcile.isError && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {errorMessage(reconcile.error)}
              </p>
            )}
          </Card>
        </div>
      </Section>

      <Card className="mb-6 p-4 sm:p-6">
        <CardHeader
          title={t('wallet.owed')}
          subtitle={
            receivables.isSuccess
              ? `${t('owner.receivable')} ${formatMoney(receivables.data.totalOwed)} · ${t('reports.payable')} ${formatMoney(receivables.data.totalPayable ?? 0)}`
              : t('owner.receivable')
          }
          href={reportHref('due', null, { auto: false })}
          hrefLabel={t('report.due')}
        />
        {receivables.isLoading && <ListSkeleton rows={3} />}

        {receivables.isError && (
          <ErrorState
            onRetry={() => receivables.refetch()}
            isRetrying={receivables.isFetching}
            error={receivables.error}
          />
        )}

        {receivables.isSuccess && receivables.data.resellers.length === 0 && (
          <EmptyState compact title={t('app.none')} />
        )}

        {/* A tooltip does not exist on a phone, so the hint is said once, in full. */}
        {receivables.isSuccess && receivables.data.resellers.some((row) => row.drift) && (
          <Alert tone="warning">{t('reports.driftHint')}</Alert>
        )}

        {receivables.isSuccess && receivables.data.resellers.length > 0 && (
          <>
            <ul className="-my-1 divide-y divide-border sm:hidden">
              {receivables.data.resellers.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/owner/resellers/${row.id}` as Route}
                      className="block truncate font-semibold text-primary-ink hover:underline"
                    >
                      {row.shopName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t('wallet.creditLimit')} <span className="tabular">{formatMoney(row.creditLimit)}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {row.atLimit && <Badge tone="danger">{t('reports.atLimit')}</Badge>}
                      {row.drift && (
                        <Badge tone="warning" dot>
                          {t('reports.drift')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        'tabular font-bold',
                        row.balance < 0 ? 'text-danger-ink' : row.balance > 0 ? 'text-success-ink' : ''
                      )}
                    >
                      {formatSignedMoney(row.balance)}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('wallet.balance')}</p>
                  </div>
                </li>
              ))}
            </ul>

            {/* Inside a card already, so a bare table rather than a second card around it. */}
            <div className="scroll-x hidden sm:block">
              <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr>
                  <Th>{t('auth.shopName')}</Th>
                  <Th className="text-right">{t('wallet.balance')}</Th>
                  <Th className="text-right">{t('wallet.creditLimit')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {receivables.data.resellers.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/owner/resellers/${row.id}` as Route} className="font-medium hover:underline">
                        {row.shopName}
                      </Link>
                    </Td>
                    <Td
                      className={cn(
                        'tabular text-right',
                        row.balance < 0 ? 'text-danger' : row.balance > 0 ? 'text-success' : ''
                      )}
                    >
                      {formatSignedMoney(row.balance)}
                    </Td>
                    <Td className="tabular text-right">{formatMoney(row.creditLimit)}</Td>
                    <Td className="text-right text-xs">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {row.atLimit && <Badge tone="danger">{t('reports.atLimit')}</Badge>}
                        {/*
                         * A wallet whose cached balance does not match its
                         * ledger. Rare and serious, so it gets a badge rather
                         * than a word, and the hint above says what to do.
                         */}
                        {row.drift && (
                          <Badge tone="warning" dot>
                            {t('reports.drift')}
                          </Badge>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      <Card className="p-4 sm:p-6">
        <CardHeader
          title={t('nav.products')}
          subtitle={formatRange(range)}
          action={
            // The products sheet, which is what this table is a slice of.
            <ButtonLink
              href={reportHref('products', range, { preset })}
              variant="outline"
              size="sm"
              title={t('report.downloadHint')}
            >
              <Download className="h-4 w-4" />
              {t('report.download')}
            </ButtonLink>
          }
        />

        {sold.isLoading && <ListSkeleton rows={3} />}

        {sold.isError && !sold.data && (
          <ErrorState onRetry={() => sold.refetch()} isRetrying={sold.isFetching} error={sold.error} />
        )}

        {sold.data?.products.length === 0 && <EmptyState compact title={t('report.noRows')} />}

        {sold.data && sold.data.products.length > 0 && (
          <div className={cn('transition-opacity', sold.isFetching && 'opacity-60')}>
            <ul className="-my-1 divide-y divide-border sm:hidden">
              {sold.data.products.map((row) => (
                <li key={row.product} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold">{row.name}</p>
                    <p className="tabular shrink-0 font-bold">{formatMoney(row.revenue)}</p>
                  </div>
                  <p className="tabular text-xs text-muted-foreground">
                    {formatNumber(row.quantity)} {tUnit(row.unit)} · {formatNumber(row.orders)} {t('nav.orders')} ·{' '}
                    {t('catalog.costPrice')} {formatMoney(row.cost)}
                  </p>
                </li>
              ))}
            </ul>

            {/* Inside a card already, so a bare table rather than a second card around it. */}
            <div className="scroll-x hidden sm:block">
              <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr>
                  <Th>{t('nav.products')}</Th>
                  <Th className="text-right">{t('order.quantity')}</Th>
                  <Th className="text-right">{t('nav.orders')}</Th>
                  <Th className="text-right">{t('catalog.costPrice')}</Th>
                  <Th className="text-right">{t('app.total')}</Th>
                </tr>
              </thead>
              <tbody>
                {sold.data.products.map((row) => (
                  <Tr key={row.product}>
                    <Td className="font-medium">{row.name}</Td>
                    <Td className="tabular text-right">
                      {formatNumber(row.quantity)} {tUnit(row.unit)}
                    </Td>
                    <Td className="tabular text-right">{formatNumber(row.orders)}</Td>
                    <Td className="tabular text-right">{formatMoney(row.cost)}</Td>
                    <Td className="tabular text-right">{formatMoney(row.revenue)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
