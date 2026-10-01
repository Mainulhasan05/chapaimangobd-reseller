'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ChevronRight, ClipboardList, Download, FileSpreadsheet, TrendingDown } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatSignedMoney } from '@/lib/format';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import {
  DateRangeFilter,
  formatRange,
  rangeOf,
  rangeParams,
  type DateRange,
  type PresetKey,
} from '@/components/ui/date-range';
import {
  DownloadMenu,
  REPORTS,
  reportHref,
  type ReportGroup,
  type ReportInfo,
} from '@/components/report/download-menu';
import type { DictKey } from '@/lib/i18n/bn';

type Receivables = {
  /** What resellers owe the owner: the negative ledger balances. */
  totalOwed: number;
  /** What the owner holds for resellers: the positive ledger balances. */
  totalPayable: number;
  openOrders: number;
  /** Every reseller not square with the ledger, or whose cached balance drifted. */
  resellers: {
    id: string;
    shopName: string;
    user?: { name: string; phoneE164: string };
    /** The ledger balance, signed: negative owes, positive is held for them. */
    balance: number;
    owed: number;
    payable: number;
    creditLimit: number;
    atLimit: boolean;
    /** The cached balance disagrees with the ledger. A reconcile says why. */
    drift: boolean;
  }[];
};

type ProductsSold = {
  from: string;
  to: string;
  products: {
    product: string;
    name: string;
    unit: string;
    quantity: number;
    revenue: number;
    cost: number;
    orders: number;
  }[];
};

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
function ReportCard({ report, range }: { report: ReportInfo; range: DateRange }) {
  const Icon = report.icon;

  return (
    <Link
      href={reportHref(report.kind, range)}
      className="card card-interactive group flex h-full min-w-0 items-start gap-3 p-4"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-softer">
        <Icon className="h-5 w-5 text-primary-ink" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{t(report.labelKey)}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {t(report.hintKey)}
        </span>
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

export default function OwnerReportsPage() {
  /*
   * One range for the whole screen.
   *
   * It drives the table below, every report link, and both CSV exports. They
   * each used to decide for themselves — the table read two date fields and the
   * exports read nothing at all, so pressing "orders CSV" under a one-day view
   * downloaded the entire history. A reporting screen with more than one idea of
   * which days it is showing is a screen that cannot be trusted.
   */
  const [preset, setPreset] = useState<PresetKey | 'custom'>('last7');
  const [range, setRange] = useState<DateRange>(() => rangeOf('last7'));
  const from = range?.from;
  const to = range?.to;
  const query = range ? `?${rangeParams(range)}` : '';

  const receivables = useQuery({
    queryKey: ['owner', 'receivables'],
    queryFn: () => api.get<Receivables>('/owner/reports/receivables'),
  });

  const sold = useQuery({
    queryKey: ['owner', 'sold', from, to],
    queryFn: () => api.get<ProductsSold>(`/owner/reports/products-sold${query}`),
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api.get<{ checked: number; drifted: { reseller: string; problems: string[] }[] }>(
        '/owner/reports/reconcile'
      ),
  });

  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        subtitle={formatRange(range)}
        action={<DownloadMenu range={range} />}
      />

      {/*
       * The range every figure and every link on this page is built from.
       * Opens on the last seven days: a reports screen asked about one day is
       * usually asked from the orders screen instead.
       */}
      <DateRangeFilter
        className="mb-5"
        preset={preset}
        range={range}
        onChange={(nextPreset, nextRange) => {
          setPreset(nextPreset);
          setRange(nextRange);
        }}
      />

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
              <ReportCard key={report.kind} report={report} range={range} />
            ))}
          </div>
        </Section>
      ))}

      {/*
       * The two CSVs, which are a different thing from a report: a file to open
       * in a spreadsheet rather than a sheet to print. They carry the range
       * above them, which is the whole reason they are here and not in the header.
       */}
      <Section title={t('report.export')}>
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-4">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft">
              <FileSpreadsheet className="h-5 w-5 text-success-ink" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">CSV</span>
              <span className="block text-xs text-muted-foreground">{t('report.exportHint')}</span>
            </span>
          </span>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/owner/exports/orders.csv${query}`} download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                {t('nav.orders')}
              </Button>
            </a>
            <a href={`/api/owner/exports/ledger.csv${query}`} download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                {t('wallet.ledger')}
              </Button>
            </a>
          </div>
        </Card>
      </Section>

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t('report.glance')}</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={TrendingDown}
          label={t('owner.receivable')}
          value={receivables.isSuccess ? formatMoney(receivables.data.totalOwed) : '—'}
          tone={(receivables.data?.totalOwed ?? 0) > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          icon={ClipboardList}
          tone="primary"
          label={t('nav.orders')}
          value={receivables.isSuccess ? formatNumber(receivables.data.openOrders) : '—'}
        />
        <Card className="flex flex-col justify-center">
          <Button
            variant="outline"
            size="sm"
            loading={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            {t('owner.reconcile')}
          </Button>
          {reconcile.data && (
            <p
              className={`mt-2 text-xs ${
                reconcile.data.drifted.length === 0 ? 'text-success' : 'text-danger'
              }`}
            >
              {reconcile.data.drifted.length === 0
                ? t('reconcile.checkedOk').replace('{n}', formatNumber(reconcile.data.checked))
                : t('reconcile.drifted').replace(
                    '{n}',
                    formatNumber(reconcile.data.drifted.length)
                  )}
            </p>
          )}
          {reconcile.error && (
            <p className="mt-2 text-xs text-danger">{errorMessage(reconcile.error)}</p>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title={t('wallet.owed')}
          subtitle={
            receivables.isSuccess
              ? `${t('owner.receivable')} ${formatMoney(receivables.data.totalOwed)} · ${t('reports.payable')} ${formatMoney(receivables.data.totalPayable ?? 0)}`
              : t('owner.receivable')
          }
        />
        {receivables.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {receivables.isError && (
          <ErrorState
            onRetry={() => receivables.refetch()}
            isRetrying={receivables.isFetching}
            error={receivables.error}
          />
        )}

        {receivables.isSuccess && receivables.data.resellers.length === 0 && (
          <EmptyState icon={ClipboardList} title={t('app.none')} />
        )}

        {/* A tooltip does not exist on a phone, so the hint is said once, in full. */}
        {receivables.isSuccess && receivables.data.resellers.some((row) => row.drift) && (
          <Alert tone="warning">{t('reports.driftHint')}</Alert>
        )}

        {receivables.isSuccess && receivables.data.resellers.length > 0 && (
          <div className="scroll-x">
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
                      <div className="font-medium">{row.shopName}</div>
                      <div className="tabular text-xs text-muted-foreground">
                        {row.user?.phoneE164}
                      </div>
                    </Td>
                    <Td
                      className={`tabular text-right ${
                        row.balance < 0 ? 'text-danger' : row.balance > 0 ? 'text-success' : ''
                      }`}
                    >
                      {formatSignedMoney(row.balance)}
                    </Td>
                    <Td className="tabular text-right">{formatMoney(row.creditLimit)}</Td>
                    <Td className="text-right text-xs">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {row.atLimit && <span className="text-danger">{t('reports.atLimit')}</span>}
                        {/*
                         * A wallet whose cached balance does not match its
                         * ledger. Rare and serious, so it gets a badge rather
                         * than a word, and the hint says what to do about it.
                         */}
                        {row.drift && (
                          <Badge tone="warning" dot title={t('reports.driftHint')}>
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
        )}
      </Card>

      <Card>
        <CardHeader
          title={t('nav.products')}
          subtitle={formatRange(range)}
          action={
            <Link href={reportHref('sales', range)}>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                {t('report.download')}
              </Button>
            </Link>
          }
        />

        {sold.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {sold.isError && (
          <ErrorState
            onRetry={() => sold.refetch()}
            isRetrying={sold.isFetching}
            error={sold.error}
          />
        )}

        {sold.data?.products.length === 0 && (
          <EmptyState icon={ClipboardList} title={t('app.none')} />
        )}

        {sold.data && sold.data.products.length > 0 && (
          <TableWrap alwaysVisible>
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
          </TableWrap>
        )}
      </Card>

      {reconcile.data && reconcile.data.drifted.length > 0 && (
        <Alert tone="danger" title={t('owner.reconcile')}>
          {reconcile.data.drifted.map((d) => (
            <p key={d.reseller} className="mt-1 text-xs">
              {d.reseller}: {d.problems.join('; ')}
            </p>
          ))}
        </Alert>
      )}
    </>
  );
}
