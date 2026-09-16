'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ClipboardList, Download, FileText, TrendingDown } from 'lucide-react';
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
import { DownloadMenu, reportHref } from '@/components/report/download-menu';

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

/**
 * One report, as a card. A card rather than a link, because on a phone this is
 * the tap target and a line of text is not one.
 */
function ReportCard({
  kind,
  label,
  hint,
  range,
}: {
  kind: Parameters<typeof reportHref>[0];
  label: string;
  hint: string;
  range: DateRange;
}) {
  return (
    <Link href={reportHref(kind, range)} className="card-interactive">
      <Card className="flex h-full items-start gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle">
          <FileText className="h-4 w-4 text-primary-ink" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{label}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </Card>
    </Link>
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
       * someone opens when they do not already know which one they want.
       */}
      <section className="mb-6">
        <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('report.reports')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ReportCard kind="sales" label={t('report.sales')} hint={t('report.salesHint')} range={range} />
          <ReportCard
            kind="resellers"
            label={t('report.resellers')}
            hint={t('report.resellersHint')}
            range={range}
          />
          <ReportCard kind="due" label={t('report.due')} hint={t('report.dueHint')} range={range} />
          <ReportCard
            kind="orders"
            label={t('report.orderSheet')}
            hint={t('report.orderSheetHint')}
            range={range}
          />
          <ReportCard
            kind="pick-list"
            label={t('report.pickList')}
            hint={t('report.pickListHint')}
            range={range}
          />

          {/*
           * The two CSVs, which are a different thing from a report: a file to
           * open in a spreadsheet rather than a sheet to print. They now carry
           * the range above them, which is the whole reason they are here and
           * not in the header.
           */}
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-sm font-semibold">CSV</p>
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
        </div>
      </section>

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
                        {row.atLimit && (
                          <span className="text-danger">{t('reports.atLimit')}</span>
                        )}
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
          <ErrorState onRetry={() => sold.refetch()} isRetrying={sold.isFetching} error={sold.error} />
        )}

        {sold.data?.products.length === 0 && <EmptyState icon={ClipboardList} title={t('app.none')} />}

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
