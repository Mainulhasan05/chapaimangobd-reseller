'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useSyncExternalStore } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Clock,
  HandCoins,
  MessageSquareWarning,
  Package,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Truck,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/session';
import { LIVE } from '@/lib/store/api';
import {
  useGetDashboardQuery,
  useGetPositionQuery,
} from '@/lib/store/endpoints/dashboard';
import { useGetOwnerOrdersInfiniteQuery } from '@/lib/store/endpoints/orders';
import {
  useGetPickListQuery,
  useGetProfitReportQuery,
  useGetSupplyReportQuery,
} from '@/lib/store/endpoints/reports';
import { t, tf, tUnit } from '@/lib/i18n/bn';
import { businessDate, formatMoney, formatNumber, formatAge } from '@/lib/format';
import { daysAgo, startOfMonth } from '@/components/ui/date-range';
import type { OrderStatus } from '@/lib/types';
import {
  Badge,
  Card,
  CardHeader,
  DashboardGrid,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Rail,
  Stat,
  statusTone,
} from '@/components/ui/layout';
import { ListSkeleton, Skeleton, StatSkeleton } from '@/components/ui/skeleton';
import { Greeting } from '@/components/dashboard/metrics';
import { ActionCard, ActionGrid } from '@/components/dashboard/actions';
import { PipelineBar } from '@/components/dashboard/pipeline-bar';
import { QueuePanel, QueueTile, RailList, RailRow } from '@/components/dashboard/rail';
import { IncomeCostChart, type DayMoney } from '@/components/dashboard/income-cost-chart';
import { ReportButton } from '@/components/report/download-menu';

/** Reports change slowly; five minutes old is fresh enough for a glance. */
const SLOW = { refetchOnMountOrArgChange: 300 } as const;

/** The orders list opened already filtered, as the owner would have set it. */
const ordersHref = (query: string) => `/owner/orders?${query}` as Route;

/*
 * A clock that ticks once a minute, read as an external source so "updated 3
 * minutes ago" moves on its own without a re-render loop. The server snapshot is
 * 0 and nothing reads it before the dashboard's own data has arrived.
 */
const subscribeMinute = (notify: () => void) => {
  const id = setInterval(notify, 30_000);
  return () => clearInterval(id);
};
const currentMinute = () => Math.floor(Date.now() / 60_000);

/** The business day as a person says it: "বৃহস্পতিবার, ২ অক্টোবর ২০২৬". */
function longDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat('bn-BD', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day, 12));
}

export default function OwnerDashboardPage() {
  const { data: session } = useSession();

  const dashboard = useGetDashboardQuery(undefined, LIVE);

  /**
   * Confirmed orders going stale is a business risk here, not a vanity metric:
   * mangoes do not wait, so this list sits on the dashboard rather than inside
   * a report someone has to remember to open.
   */
  const aging = useGetOwnerOrdersInfiniteQuery({ aging: true, limit: 8 });

  /*
   * What has to be collected today, and from which orchard.
   *
   * The owner's first job of the morning is not a screen of orders, it is a
   * quantity per product and somewhere to drive to. It was derivable from the
   * order lines all along and appeared on no screen, so the morning started by
   * opening orders one at a time and adding kilos up by hand.
   */
  const pick = useGetPickListQuery(
    {},
    { pollingInterval: 300_000, skipPollingIfUnfocused: true }
  );

  /*
   * The cost side, which this screen did not show at all.
   *
   * Every figure from the payload is revenue: what was ordered, what is owed to
   * us, what the couriers are carrying. None of it answers the question the
   * owner actually asks at the end of a month, which is whether any of it was
   * worth doing. These three are the cheapest honest answer — what is owed both
   * ways, what the month made after every cost, and what is about to run out and
   * stop the packing.
   */
  const position = useGetPositionQuery(undefined, SLOW);
  const profit = useGetProfitReportQuery({ from: startOfMonth(), to: businessDate() }, SLOW);
  const supplies = useGetSupplyReportQuery({}, SLOW);

  /*
   * The same report over the last week, for the chart.
   *
   * A second call rather than slicing the monthly one: the card above wants a
   * month and the chart wants seven days, and deriving one from the other would
   * mean the chart silently changing length on the first of the month.
   */
  const week = useGetProfitReportQuery({ from: daysAgo(6), to: businessDate() }, SLOW);

  const minute = useSyncExternalStore(subscribeMinute, currentMinute, () => 0);

  const data = dashboard.data;

  if (dashboard.isLoading) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <StatSkeleton count={4} />
        <div className="mt-5">
          <ListSkeleton rows={4} />
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <ErrorState
          onRetry={() => dashboard.refetch()}
          isRetrying={dashboard.isFetching}
          error={dashboard.error}
        />
      </>
    );
  }

  const money = data.money;
  const health = data.health;

  /*
   * Income against cost, a day at a time, folded up from the per-order rows the
   * profit report already returns. Days with no trade still appear, because a
   * quiet Friday is information and a chart that silently skips it makes the
   * week look busier than it was.
   */
  const dayMoney: DayMoney[] = (() => {
    const byDate = new Map<string, DayMoney>();
    for (let i = 6; i >= 0; i -= 1) {
      const date = daysAgo(i);
      byDate.set(date, { date, income: 0, cost: 0 });
    }
    (week.data?.orders ?? []).forEach((o) => {
      const row = byDate.get(o.businessDate);
      if (!row) return;
      row.income += o.revenue;
      row.cost += o.cost;
    });
    return [...byDate.values()];
  })();

  /*
   * Today against yesterday up to the same time. Held against all of yesterday,
   * every morning read as a collapse: twelve orders by eleven against yesterday's
   * full forty is not a bad day, it is an unfinished one.
   */
  const yesterday = data.ordersYesterdaySameTime;
  const orderDelta =
    yesterday != null && yesterday > 0
      ? {
          value: `${formatNumber(
            Math.abs(Math.round(((data.ordersToday - yesterday) / yesterday) * 100))
          )}%`,
          direction: (data.ordersToday >= yesterday ? 'up' : 'down') as 'up' | 'down',
        }
      : undefined;

  /*
   * Everything waiting on the owner personally. One number, because it decides
   * two things at once: whether the queue panel says "nothing waiting", and
   * whether it is allowed to shout (and, on a phone, to lead the page).
   */
  const waiting =
    data.pendingDeposits +
    data.pendingWithdrawals +
    data.awaitingAcceptance +
    data.agingOrders +
    data.pendingKyc +
    data.openComplaints;
  const busy = waiting > 0;

  /*
   * Anything quietly broken. A failing SMS gateway stops registrations and
   * customer messages, a product out of stock stops a form from taking an order,
   * and a dead-lettered message is a notification nobody will ever receive. The
   * reseller SMS switch is not here: switching it off is a choice, not a fault.
   */
  const smsProblem =
    health.smsGateway === 'error' || health.smsGateway === 'not_configured' || health.smsBalanceLow;
  const problems = health.lowStock + health.deadLetters + (smsProblem ? 1 : 0);

  const updatedMinutes =
    dashboard.fulfilledTimeStamp && minute
      ? Math.max(0, minute - Math.floor(dashboard.fulfilledTimeStamp / 60_000))
      : 0;

  /* ------------------------------------------------------------ blocks -- */

  const queue = (
    <QueuePanel
      title={t('dash.queue')}
      subtitle={busy ? t('dash.queueHelp') : undefined}
      waiting={waiting}
      footer={busy ? undefined : t('dash.queueEmpty')}
    >
      <QueueTile
        icon={ArrowDownToLine}
        label={t('nav.deposits')}
        count={formatNumber(data.pendingDeposits)}
        href={'/owner/finance?tab=deposits&status=pending' as Route}
      />
      <QueueTile
        icon={ArrowUpFromLine}
        label={t('nav.withdrawals')}
        count={formatNumber(data.pendingWithdrawals)}
        href={'/owner/finance?tab=withdrawals&status=pending' as Route}
      />
      <QueueTile
        icon={ClipboardCheck}
        label={t('owner.awaitingAcceptance')}
        count={formatNumber(data.awaitingAcceptance)}
        href={ordersHref('status=confirmed')}
      />
      <QueueTile
        icon={Clock}
        label={t('owner.agingOrders')}
        count={formatNumber(data.agingOrders)}
        href={ordersHref('aging=1')}
      />
      {/*
       * A reseller stuck in KYC cannot trade at all, and nothing on this screen
       * counted them: the only way to find out was to open the KYC page on the
       * off chance.
       */}
      <QueueTile
        icon={BadgeCheck}
        label={t('dash.pendingKyc')}
        count={formatNumber(data.pendingKyc)}
        href={'/owner/kyc?status=pending' as Route}
      />
      {/*
       * A customer who took the parcel, paid, and then rang to say the fruit was
       * bad leaves no other mark anywhere: the order reads as a clean delivery
       * for ever. This is the only place it shows.
       */}
      <QueueTile
        icon={MessageSquareWarning}
        label={t('complaint.title')}
        count={formatNumber(data.openComplaints)}
        href="/owner/complaints"
      />
    </QueuePanel>
  );

  /*
   * What to collect. First thing done in the morning and the only panel here
   * that sends somebody out of the building; the sheet under it is the one they
   * take with them.
   */
  const pickPanel = (
    <Panel title={t('owner.pickToday')}>
      {pick.isLoading && <Skeleton className="h-20 w-full" />}
      {pick.isError && !pick.data && (
        <LoadFailed onRetry={() => pick.refetch()} retrying={pick.isFetching} />
      )}
      {pick.data && pick.data.products.length === 0 && (
        <p className="py-3 text-sm text-muted-foreground">{t('dash.pickNone')}</p>
      )}
      {pick.data && pick.data.products.length > 0 && (
        <>
          <RailList>
            {pick.data.products.slice(0, 5).map((product) => (
              <RailRow
                key={product.product}
                name={product.name}
                caption={
                  // The orchard, once one is decided. A confirmed order has none:
                  // it is chosen at accept. See docs/adr/0006.
                  product.sources
                    .map((source) => source.sourceName ?? t('owner.pickUndecided'))
                    .join(', ')
                }
                trailing={
                  <Badge tone="primary">
                    {formatNumber(product.quantity)} {tUnit(product.unit)}
                  </Badge>
                }
              />
            ))}
          </RailList>
          <div className="mt-3">
            <ReportButton
              kind="pick-list"
              range={null}
              label={t('report.pickList')}
              full
            />
          </div>
        </>
      )}
    </Panel>
  );

  // Who to ring about the receivable figure: the question that figure raises.
  const debtors = data.debtors ?? [];
  const debtorsPanel = (
    <Panel title={t('dash.topDebtors')} href="/owner/resellers" hrefLabel={t('nav.resellers')}>
      {debtors.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('dash.debtorsNone')}</p>
      ) : (
        <RailList>
          {debtors.map((debtor) => (
            <RailRow
              key={debtor.id}
              name={debtor.shopName}
              href={`/owner/resellers/${debtor.id}` as Route}
              trailing={
<Badge tone="danger">{formatMoney(debtor.owed)}</Badge>
              }
            />
          ))}
        </RailList>
      )}
    </Panel>
  );

  /*
   * Things that are quietly broken, as one panel that is calm when there is
   * nothing to say. Each of these used to surface only as a complaint: a
   * customer who never got their SMS, a form that refused an order because a
   * product had run out.
   */
  const healthPanel = (
    <Panel title={t('owner.health')}>
      {problems === 0 ? (
        <p className="py-3 text-sm text-success-ink">{t('owner.healthOk')}</p>
      ) : (
        <RailList>
          {health.lowStock > 0 && (
            <RailRow
              name={t('owner.lowStock')}
              href="/owner/products"
              trailing={<Badge tone="warning">{formatNumber(health.lowStock)}</Badge>}
            />
          )}
          {health.smsGateway === 'error' && (
            <RailRow
              name={t('dash.smsGatewayError')}
              href="/owner/sms"
              trailing={<Badge tone="danger">{t('app.error')}</Badge>}
            />
          )}
          {health.smsGateway === 'not_configured' && (
            <RailRow name={t('dash.smsNotConfigured')} href="/owner/sms" />
          )}
          {health.smsGateway === 'ok' && health.smsBalanceLow && (
            <RailRow
              name={tf('dash.smsBalanceLow', { count: formatNumber(health.smsBalance ?? 0) })}
              href="/owner/sms"
            />
          )}
          {health.deadLetters > 0 && (
            <RailRow
              name={t('dash.failedDeliveries')}
              href={'/owner/notifications/failed' as Route}
              trailing={<Badge tone="danger">{formatNumber(health.deadLetters)}</Badge>}
            />
          )}
        </RailList>
      )}
    </Panel>
  );

  return (
    <>
      <header className="mb-6">
        <Greeting name={session?.user.name} />
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.dashboard')}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span>{longDay(data.today)}</span>
          {/*
           * How fresh the figures are, and the way to make them fresher. The page
           * polls every minute, but on a phone that was asleep in a pocket the
           * owner has no other way to know whether a number is from now or from
           * breakfast.
           */}
          <button
            type="button"
            onClick={() => dashboard.refetch()}
            disabled={dashboard.isFetching}
            aria-label={t('dash.refresh')}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw
              aria-hidden
              className={cn('h-3.5 w-3.5', dashboard.isFetching && 'animate-spin')}
            />
            {tf('dash.updated', {
              time:
                updatedMinutes < 1
                  ? t('app.justNow')
                  : tf('app.minutesAgo', { count: formatNumber(updatedMinutes) }),
            })}
          </button>
        </div>
      </header>

      {/*
       * The order of a phone's first screen: what is waiting on the owner (when
       * anything is), what to collect today, the day's figures, then the doors
       * into the work. Analytics come last. On a wide screen the queue and the
       * pick list live in the rail instead, so they render twice and CSS shows
       * one of each; they read the same cache, so it costs nothing.
       */}
      <div className="flex flex-col gap-5">
        {busy && <div className="lg:hidden">{queue}</div>}
        <div className="lg:hidden">{pickPanel}</div>

        {/*
         * Money first, then work, then what is owed in both directions.
         *
         * Today's takings lead because that is the figure the owner opens the app
         * for. The owner's revenue is the wallet debit — goods at cost plus
         * delivery — and deliberately not the customer total, which carries the
         * resellers' margin and is therefore not the owner's money. Two columns
         * on a phone, so all four fit on one screen.
         */}
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            icon={Wallet}
            tone="primary"
            label={t('dash.todaySales')}
            value={wholeTaka(money.ownerRevenue)}
            hint={t('dash.todaySalesHint')}
            href={ordersHref('range=today')}
            className={STAT_COMPACT}
          />
          <Stat
            icon={ShoppingBag}
            label={t('owner.ordersToday')}
            value={formatNumber(data.ordersToday)}
            delta={orderDelta}
            hint={
              yesterday != null
                ? tf('dash.vsYesterday', { count: formatNumber(yesterday) })
                : undefined
            }
            href={ordersHref('range=today')}
            className={STAT_COMPACT}
          />
          <QueryStat
            icon={ArrowDownToLine}
            label={t('position.receivable')}
            hint={t('position.receivableHint')}
            href="/owner/resellers"
            query={position}
            pick={(p) => p.receivable}
          />
          <QueryStat
            icon={HandCoins}
            label={t('position.payable')}
            hint={t('position.payableHint')}
            href="/owner/payees"
            query={position}
            pick={(p) => p.payable}
            toneFor={(value) => (value > 0 ? 'warning' : 'neutral')}
          />
        </section>

        {/*
         * What to do next, directly under what is happening: the figures say a
         * decision is needed and this is the row that starts it.
         */}
        <section>
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dash.actions')}
          </h2>
          <ActionGrid>
            <ActionCard
              icon={ClipboardList}
              tone="primary"
              label={t('nav.orders')}
              hint={t('dash.actionOrders')}
              href="/owner/orders"
            />
            <ActionCard
              icon={Package}
              tone="brand"
              label={t('nav.products')}
              hint={t('dash.actionProducts')}
              href="/owner/products"
            />
            <ActionCard
              icon={Wallet}
              tone="success"
              label={t('nav.finance')}
              hint={t('dash.actionFinance')}
              href="/owner/finance"
            />
            <ActionCard
              icon={ChartColumn}
              tone="warning"
              label={t('report.reports')}
              hint={t('dash.actionReports')}
              href="/owner/reports"
            />
          </ActionGrid>
        </section>

        <DashboardGrid>
          <div className="flex min-w-0 flex-col gap-5">
            {/*
             * Where the orders in flight are sitting: the owner's actual job in
             * one bar, replacing four counts that had to be added up in the
             * reader's head. Each stage opens the list at that stage.
             */}
            <Card>
              <CardHeader title={t('dash.inFlight')} subtitle={t('dash.inFlightHint')} />
              <PipelineBar
                byStatus={data.byStatus}
                hrefFor={(stage: OrderStatus) => ordersHref(`status=${stage}`)}
              />

              {/*
               * Beside the bar, the two ends of the journey it does not show: the
               * cash the couriers are carrying, and what reached customers today.
               */}
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
                <Link
                  href={ordersHref('status=shipped')}
                  className="rounded-xl bg-muted px-3 py-2.5 transition-colors hover:bg-subtle"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Truck aria-hidden className="h-3.5 w-3.5" />
                    {t('owner.codInFlight')}
                  </span>
                  <span className="tabular mt-0.5 block text-base font-bold">
                    {formatMoney(data.codInFlight.amount)}
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {formatNumber(data.codInFlight.orders)} {t('nav.orders')}
                  </span>
                </Link>

                <Link
                  href={ordersHref('status=delivered&range=today')}
                  className="rounded-xl bg-muted px-3 py-2.5 transition-colors hover:bg-subtle"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <PackageCheck aria-hidden className="h-3.5 w-3.5" />
                    {t('dash.deliveredToday')}
                  </span>
                  <span className="tabular mt-0.5 block text-base font-bold">
                    {data.deliveredToday != null ? formatNumber(data.deliveredToday) : t('app.notAvailable')}
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {t('dash.deliveredTodayHint')}
                  </span>
                </Link>
              </div>
            </Card>

            <Card>
              <CardHeader
                title={t('dash.agingTitle')}
                subtitle={t('dash.agingHint').replace(
                  '{n}',
                  formatNumber(data.agingThresholdHours)
                )}
                href={ordersHref('aging=1')}
                hrefLabel={t('dash.agingAll')}
              />

              {aging.isLoading && <ListSkeleton rows={3} />}

              {aging.isError && !aging.data && (
                <LoadFailed onRetry={() => aging.refetch()} retrying={aging.isFetching} />
              )}

              {(() => {
                const rows = aging.data?.pages[0]?.orders;
                if (!rows) return null;
                if (rows.length === 0) {
                  return <EmptyState compact icon={ClipboardList} title={t('dash.agingNone')} />;
                }
                return (
                  <ul className="-my-1 divide-y divide-border">
                    {rows.map((order) => (
                      <li key={order.id}>
                        <Link
                          href={`/owner/orders/${order.id}` as Route}
                          className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"
                        >
                          <div className="min-w-0">
                            <p className="tabular truncate font-semibold">{order.orderCode}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {typeof order.reseller === 'object' ? order.reseller?.shopName : ''}
                            </p>
                          </div>
                          <Badge tone={statusTone(order.status)} dot>
                            {formatAge(order.confirmedAt)}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </Card>

            {/*
             * What is about to stop the packing table. Only rendered when
             * something is actually wrong: a card that is always present and
             * usually empty teaches the reader to skip it, and this is the one
             * that must not be skipped. A negative count outranks a low one.
             */}
            {supplies.isError && !supplies.data && (
              <Card>
                <CardHeader title={t('supply.low')} href="/owner/supplies" hrefLabel={t('nav.supplies')} />
                <LoadFailed onRetry={() => supplies.refetch()} retrying={supplies.isFetching} />
              </Card>
            )}
            {(() => {
              const rows = supplies.data?.supplies ?? [];
              const bad = rows.filter((r) => r.isNegative);
              const low = rows.filter((r) => r.isLow && !r.isNegative);
              if (bad.length === 0 && low.length === 0) return null;

              return (
                <Card>
                  <CardHeader
                    title={t('supply.low')}
                    subtitle={t('packaging.shortageHint')}
                    href="/owner/supplies"
                    hrefLabel={t('nav.supplies')}
                  />
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {[...bad, ...low].slice(0, 4).map((r) => (
                      <li key={r.supplyId}>
                        <Link
                          href={`/owner/supplies/${r.supplyId}` as Route}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted px-3 py-2.5 transition-colors hover:bg-subtle"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{r.nameBn}</span>
                            <span className="text-xs text-muted-foreground">
                              {r.isNegative ? t('supply.negativeHint') : t('supply.reorderHint')}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span
                              className={cn(
                                'tabular block text-sm font-bold',
                                r.isNegative ? 'text-danger-ink' : 'text-warning-ink'
                              )}
                            >
                              {formatNumber(r.onHand)} {tUnit(r.unit)}
                            </span>
                            <Badge tone={r.isNegative ? 'danger' : 'warning'}>
                              {r.isNegative ? t('supply.negative') : t('supply.low')}
                            </Badge>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })()}
          </div>

          {/*
           * The rail. On a wide screen it carries the queue and the pick list as
           * well; below `lg` those two have already been shown at the top.
           */}
          <Rail>
            <div className="hidden lg:block">{queue}</div>
            <div className="hidden lg:block">{pickPanel}</div>
            {!busy && <div className="lg:hidden">{queue}</div>}
            {debtorsPanel}
            {healthPanel}
          </Rail>
        </DashboardGrid>

        {/*
         * What came in against what the orders cost, beside the month it adds up
         * to. Last, because it is read to understand the season, not to decide
         * what to do in the next hour.
         */}
        <section className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-5">
            <CardHeader title={t('dash.incomeVsSpend')} subtitle={t('owner.trend')} className="mb-3" />
            {week.isLoading && <Skeleton className="h-56 w-full rounded-xl" />}
            {week.isError && !week.data && (
              <LoadFailed onRetry={() => week.refetch()} retrying={week.isFetching} />
            )}
            {week.data && <IncomeCostChart days={dayMoney} />}
          </Card>

          <Card className="p-5">
            <CardHeader title={t('dash.profitBreakdown')} href="/owner/reports" hrefLabel={t('report.reports')} className="mb-3" />
            {profit.isLoading && <ListSkeleton rows={4} />}
            {profit.isError && !profit.data && (
              <LoadFailed onRetry={() => profit.refetch()} retrying={profit.isFetching} />
            )}
            {profit.data && (
              <div>
                <PlRow label={t('profit.revenue')} value={profit.data.totals.revenue} />
                <PlRow label={t('cost.goods')} value={-profit.data.totals.goods} />
                <PlRow label={t('cost.packaging')} value={-profit.data.totals.packaging} />
                <PlRow label={t('expense.totalOrder')} value={-profit.data.totals.orderExpenses} />
                <PlRow
                  label={t('dash.periodExpenses')}
                  value={-profit.data.totals.periodExpenses}
                  hint={t('profit.periodHint')}
                />
                <NetProfit value={profit.data.totals.netProfit} />
              </div>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}

/*
 * A stat card at half width on a phone: smaller figure and padding below `sm`,
 * the full size above. Reaches into the value through the `tabular` class the
 * card puts on it, because the card has no size prop.
 */
const STAT_COMPACT = 'p-4 sm:p-5 [&>.tabular]:text-[1.375rem] sm:[&>.tabular]:text-[2rem]';

/** Tile money in whole taka: paisa add two characters a half-width tile cannot spare. */
const wholeTaka = (value: number) => formatMoney(Math.round(value));

/**
 * A stat whose figure comes from its own query, so it never shows ৳০ for a
 * number it does not have: a skeleton while it loads, and "—" with a retry when
 * it failed. A failed card drops its link, because the retry is a button and a
 * button may not sit inside a link.
 */
function QueryStat<T>({
  icon,
  label,
  hint,
  href,
  query,
  pick,
  toneFor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  href: Route;
  query: { data?: T; isLoading: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown };
  pick: (data: T) => number;
  toneFor?: (value: number) => 'warning' | 'neutral';
}) {
  if (query.data === undefined && query.isError) {
    return (
      <Stat
        icon={icon}
        label={label}
        className={STAT_COMPACT}
        value={
          <span className="flex flex-wrap items-center gap-2">
            {t('app.notAvailable')}
            <button
              type="button"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="tap rounded-lg border border-input px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            >
              {t('dash.retryLoad')}
            </button>
          </span>
        }
        hint={t('app.loadFailed')}
      />
    );
  }

  const value = query.data === undefined ? undefined : pick(query.data);
  return (
    <Stat
      icon={icon}
      label={label}
      hint={hint}
      href={href}
      tone={value !== undefined && toneFor ? toneFor(value) : 'neutral'}
      className={STAT_COMPACT}
      value={value === undefined ? <Skeleton className="h-7 w-24" /> : wholeTaka(value)}
    />
  );
}

/** A panel's own failure: one quiet line and a retry, never a fake zero. */
function LoadFailed({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm text-muted-foreground">
      <span>{t('app.loadFailed')}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="tap rounded-lg border border-input px-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
      >
        {t('app.retry')}
      </button>
    </div>
  );
}

/**
 * One line of the month's arithmetic: a label, and a signed figure.
 *
 * Negative values are drawn with a real minus and in ink rather than in red —
 * every line below the first is a cost, so colouring them all as bad would say
 * nothing and only make the column shout. The one figure that earns a colour is
 * the net, and it gets it in the block underneath.
 */
function PlRow({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-2 last:border-0">
      <span>
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint && <span className="block text-[0.6875rem] text-muted-foreground/80">{hint}</span>}
      </span>
      <span className="tabular shrink-0 text-sm font-semibold">
        {value < 0 ? '−' : ''}
        {formatMoney(Math.abs(value))}
      </span>
    </div>
  );
}

/**
 * The one figure that may be called profit without saying whose or before what,
 * so it is labelled as a loss when it is one rather than shown as a negative
 * profit. See docs/adr/0027.
 */
function NetProfit({ value }: { value: number }) {
  const loss = value < 0;
  return (
    <div
      className={cn(
        'mt-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3',
        loss ? 'bg-danger-soft' : 'bg-success-soft'
      )}
    >
      <span className={cn('text-sm font-semibold', loss ? 'text-danger-ink' : 'text-success-ink')}>
        {loss ? t('dash.monthLoss') : t('dash.monthProfit')}
      </span>
      <span className={cn('tabular text-xl font-bold', loss ? 'text-danger-ink' : 'text-success-ink')}>
        {formatMoney(Math.abs(value))}
      </span>
    </div>
  );
}
