'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Clock,
  MessageSquareWarning,
  HandCoins,
  Package,
  ShoppingBag,
  Truck,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/session';
import { t, tUnit } from '@/lib/i18n/bn';
import { businessDate, formatMoney, formatNumber, formatAge } from '@/lib/format';
import { startOfMonth } from '@/components/ui/date-range';
import type {
  Order,
  OwnerDashboard,
  PickList,
  Paged,
  Position,
  ProfitReport,
  ResellerSummary,
  SupplyReport,
} from '@/lib/types';
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
import { Button } from '@/components/ui/button';
import { ListSkeleton, Skeleton, StatSkeleton } from '@/components/ui/skeleton';
import { CountUp, Greeting, HeroCard } from '@/components/dashboard/metrics';
import { ActionCard, ActionGrid } from '@/components/dashboard/actions';
import { PipelineBar } from '@/components/dashboard/pipeline-bar';
import { QueuePanel, QueueTile, RailList, RailRow } from '@/components/dashboard/rail';
import { IncomeCostChart, type DayMoney } from '@/components/dashboard/income-cost-chart';
import { daysAgo, rangeParams } from '@/components/ui/date-range';
import { ReportButton } from '@/components/report/download-menu';

export default function OwnerDashboardPage() {
  const { data: session } = useSession();

  const dashboard = useQuery({
    queryKey: ['owner', 'dashboard'],
    queryFn: () => api.get<OwnerDashboard>('/owner/reports/dashboard'),
    refetchInterval: 60_000,
  });

  /**
   * Confirmed orders going stale is a business risk here, not a vanity metric:
   * mangoes do not wait, so this list sits on the dashboard rather than inside
   * a report someone has to remember to open.
   */
  const aging = useQuery({
    queryKey: ['owner', 'aging'],
    queryFn: () => api.get<Paged<'orders', Order>>('/owner/orders?aging=true&limit=8'),
  });

  /*
   * What has to be collected today, and from which orchard.
   *
   * The owner's first job of the morning is not a screen of orders, it is a
   * quantity per product and somewhere to drive to. It was derivable from the
   * order lines all along and appeared on no screen, so the morning started by
   * opening orders one at a time and adding kilos up by hand.
   */
  const pick = useQuery({
    queryKey: ['owner', 'pick-list', 'today'],
    queryFn: () => api.get<PickList>('/owner/reports/pick-list'),
    refetchInterval: 5 * 60_000,
  });

  /*
   * The last seven days of trade, as a line.
   *
   * The endpoint has existed since the first reports were written and nothing
   * called it, so the dashboard could say what happened today and never whether
   * that was a good day or a quiet one.
   */
  const trend = useQuery({
    queryKey: ['owner', 'orders-by-day', 'week'],
    queryFn: () =>
      api.get<{ days: { date: string; orders: number; customerTotal: number }[] }>(
        `/owner/reports/orders-by-day?${rangeParams({ from: daysAgo(6), to: businessDate() })}`
      ),
    staleTime: 5 * 60_000,
  });

  /*
   * Who owes the most, for the rail. The receivable figure at the top of the
   * page says how much is outstanding; this says who to ring about it, which is
   * the question the figure immediately raises.
   */
  const resellers = useQuery({
    queryKey: ['owner', 'resellers', 'debtors'],
    // The whole list: `limit` would page it, and the deepest debtor may be on any page.
    queryFn: () => api.get<{ resellers: ResellerSummary[] }>('/owner/resellers'),
    staleTime: 5 * 60_000,
  });

  /*
   * The cost side, which this screen did not show at all.
   *
   * Every figure above is revenue: what was ordered, what is owed to us, what the
   * couriers are carrying. None of it answers the question the owner actually
   * asks at the end of a month, which is whether any of it was worth doing. These
   * three are the cheapest honest answer — what is owed both ways, what the month
   * made after every cost, and what is about to run out and stop the packing.
   */
  const position = useQuery({
    queryKey: ['owner', 'position'],
    queryFn: () => api.get<Position>('/owner/reports/position'),
    staleTime: 5 * 60_000,
  });

  const profit = useQuery({
    queryKey: ['owner', 'profit', 'month'],
    queryFn: () =>
      api.get<ProfitReport>(
        `/owner/reports/profit?${rangeParams({ from: startOfMonth(), to: businessDate() })}`
      ),
    staleTime: 5 * 60_000,
  });

  const supplies = useQuery({
    queryKey: ['owner', 'supplies-report'],
    queryFn: () => api.get<SupplyReport>('/owner/reports/supplies'),
    staleTime: 5 * 60_000,
  });

  /*
   * The same report over the last week, for the chart.
   *
   * A second call rather than slicing the monthly one: the card above wants a
   * month and the chart wants seven days, and deriving one from the other would
   * mean the chart silently changing length on the first of the month.
   */
  const week = useQuery({
    queryKey: ['owner', 'profit', 'week'],
    queryFn: () =>
      api.get<ProfitReport>(
        `/owner/reports/profit?${rangeParams({ from: daysAgo(6), to: businessDate() })}`
      ),
    staleTime: 5 * 60_000,
  });

  const data = dashboard.data;

  /*
   * Today against yesterday, taken from the seven days the trend chart already
   * fetched rather than from a field the dashboard endpoint does not have. A
   * delta invented from a single day's number would be a decoration; this one is
   * two real days being compared.
   */
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

  const days = trend.data?.days ?? [];
  const todayRow = days[days.length - 1];
  const yesterdayRow = days[days.length - 2];
  const orderDelta =
    todayRow && yesterdayRow && yesterdayRow.orders > 0
      ? {
          value: `${formatNumber(
            Math.abs(Math.round(((todayRow.orders - yesterdayRow.orders) / yesterdayRow.orders) * 100))
          )}%`,
          direction: (todayRow.orders >= yesterdayRow.orders ? 'up' : 'down') as 'up' | 'down',
        }
      : undefined;

  if (dashboard.isLoading) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <Skeleton className="mb-4 h-36 w-full rounded-2xl" />
        <StatSkeleton count={4} />
        <ListSkeleton rows={3} />
      </>
    );
  }

  if (dashboard.isError) {
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

  const receivable = data?.totalReceivable ?? 0;
  const money = data?.money;
  const health = data?.health;

  /*
   * Anything quietly broken. A dead SMS gateway stops registrations, a product
   * out of stock stops a form from taking an order, and a dead-lettered message
   * is a notification nobody will ever receive. All three were invisible: the
   * only way to learn about any of them was for somebody to complain.
   */
  const problems =
    (health?.lowStock ?? 0) + (health?.deadLetters ?? 0) + (health?.smsEnabled === false ? 1 : 0);

  /*
   * Everyone in the red, deepest first. The balance is the reseller's net
   * position, so a negative number is what they owe; sorting ascending puts the
   * largest debt at the top.
   */
  /*
   * Everything waiting on the owner personally. One number, because it decides
   * two things at once: whether the queue panel says "nothing waiting", and
   * whether it is allowed to shout.
   */
  const waiting =
    (data?.pendingDeposits ?? 0) +
    (data?.pendingWithdrawals ?? 0) +
    (data?.awaitingAcceptance ?? 0) +
    (data?.agingOrders ?? 0) +
    (data?.pendingKyc ?? 0) +
    (data?.openComplaints ?? 0);

  const debtors = (resellers.data?.resellers ?? [])
    .filter((reseller) => reseller.balance < 0)
    .sort((left, right) => left.balance - right.balance)
    .slice(0, 5);

  return (
    <>
      <header className="mb-7">
        <Greeting name={session?.user.name} />
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.dashboard')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data?.today}</p>
      </header>

      {/*
       * Money first, then work, then what is owed in both directions.
       *
       * Today's takings lead because that is the figure the owner opens the app
       * for. The owner's revenue is the wallet debit — goods at cost plus
       * delivery — and deliberately not the customer total, which carries the
       * resellers' margin and is therefore not the owner's money.
       */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Wallet}
          tone="primary"
          label={t('dash.todaySales')}
          value={formatMoney(money?.ownerRevenue ?? 0)}
          hint={t('dash.todaySalesHint')}
          href="/owner/orders"
        />
        <Stat
          icon={ShoppingBag}
          label={t('owner.ordersToday')}
          value={formatNumber(data?.ordersToday ?? 0)}
          delta={orderDelta}
          hint={
            (data?.closedToday.cancelled ?? 0) > 0
              ? `${t('order.cancelled')} ${formatNumber(data?.closedToday.cancelled ?? 0)}`
              : undefined
          }
          href="/owner/orders"
        />
        <Stat
          icon={ArrowDownToLine}
          label={t('position.receivable')}
          value={formatMoney(position.data?.receivable ?? 0)}
          hint={t('position.receivableHint')}
          href="/owner/resellers"
        />
        <Stat
          icon={HandCoins}
          label={t('position.payable')}
          value={formatMoney(position.data?.payable ?? 0)}
          hint={t('position.payableHint')}
          tone={(position.data?.payable ?? 0) > 0 ? 'warning' : 'neutral'}
          href="/owner/payees"
        />
      </div>

      {/*
       * What came in against what went out, beside the month it adds up to.
       *
       * The chart is the wider of the two because reading it is a comparison
       * across seven days; the breakdown beside it is a column of five figures
       * and needs no room to breathe.
       */}
      <section className="mb-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <CardHeader title={t('dash.incomeVsSpend')} subtitle={t('owner.trend')} />
          <div className="mt-2">
            {week.isLoading && <Skeleton className="h-56 w-full rounded-xl" />}
            {week.isSuccess && <IncomeCostChart days={dayMoney} />}
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title={t('dash.profitBreakdown')} href="/owner/reports" />
          {profit.isLoading ? (
            <ListSkeleton rows={4} />
          ) : (
            <div className="mt-2">
              <PlRow label={t('profit.revenue')} value={profit.data?.totals.revenue ?? 0} />
              <PlRow label={t('cost.goods')} value={-(profit.data?.totals.goods ?? 0)} />
              <PlRow label={t('cost.packaging')} value={-(profit.data?.totals.packaging ?? 0)} />
              <PlRow
                label={t('expense.totalOrder')}
                value={-(profit.data?.totals.orderExpenses ?? 0)}
              />
              <PlRow
                label={t('profit.periodExpenses')}
                value={-(profit.data?.totals.periodExpenses ?? 0)}
                hint={t('profit.periodHint')}
              />

              {/*
               * The one figure that may be called profit without saying whose or
               * before what, so it is labelled as a loss when it is one rather
               * than shown as a negative profit. See docs/adr/0027.
               */}
              {(() => {
                const net = profit.data?.totals.netProfit ?? 0;
                const loss = net < 0;
                return (
                  <div
                    className={cn(
                      'mt-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3',
                      loss ? 'bg-danger-soft' : 'bg-success-soft'
                    )}
                  >
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        loss ? 'text-danger-ink' : 'text-success-ink'
                      )}
                    >
                      {loss ? t('dash.monthLoss') : t('dash.monthProfit')}
                    </span>
                    <span
                      className={cn(
                        'tabular text-xl font-bold',
                        loss ? 'text-danger-ink' : 'text-success-ink'
                      )}
                    >
                      {formatMoney(Math.abs(net))}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </Card>
      </section>

      {/*
       * What is about to stop the packing table.
       *
       * Only rendered when something is actually wrong. A card that is always
       * present and usually empty teaches the reader to skip it, and this is the
       * one that must not be skipped. A negative count outranks a low one: the
       * first is a wrong number, the second is a correct number that is small.
       */}
      {(() => {
        const rows = supplies.data?.supplies ?? [];
        const bad = rows.filter((r) => r.isNegative);
        const low = rows.filter((r) => r.isLow && !r.isNegative);
        if (bad.length === 0 && low.length === 0) return null;

        return (
          <Card className="mb-5 p-5">
            <CardHeader
              title={t('supply.low')}
              subtitle={t('packaging.shortageHint')}
              href="/owner/supplies"
            />
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {[...bad, ...low].slice(0, 4).map((r) => (
                <li key={r.supplyId}>
                  <Link
                    href={`/owner/supplies/${r.supplyId}`}
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

      {/*
       * What to do next, directly under what is happening. Placed above the fold
       * on a phone deliberately: the figures say a decision is needed and this is
       * the row that starts it, so putting it below the panels would mean reading
       * a number and then scrolling back up to the navigation to act on it.
       */}
      <section className="mb-5">
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
            label={t('nav.deposits')}
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
        <div className="flex flex-col gap-5">
          {/*
           * Where the orders in flight are sitting. This is the owner's actual
           * job in one bar, and it replaces four separate counts that had to be
           * added up in the reader's head.
           */}
          <Card>
            <CardHeader
              title={t('dash.stuckOrders')}
              subtitle={t('dash.stuckHint')}
              href="/owner/orders"
              hrefLabel={t('nav.orders')}
            />
            <PipelineBar byStatus={data?.byStatus ?? {}} />

            {/*
             * The two figures that used to sit in the lead row. They belong
             * beside the bar rather than above it: both are about orders in
             * flight, which is what the bar is showing, and in the lead row they
             * competed with the money for the first glance.
             */}
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
              <Link
                href="/owner/orders"
                className="rounded-xl bg-muted px-3 py-2.5 transition-colors hover:bg-subtle"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Truck className="h-3.5 w-3.5" />
                  {t('owner.codInFlight')}
                </span>
                <span className="tabular mt-0.5 block text-base font-bold">
                  {formatMoney(data?.codInFlight.amount ?? 0)}
                </span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {formatNumber(data?.codInFlight.orders ?? 0)} {t('nav.orders')}
                </span>
              </Link>

              <Link
                href="/owner/orders"
                className={cn(
                  'rounded-xl px-3 py-2.5 transition-colors',
                  (data?.agingOrders ?? 0) > 0
                    ? 'bg-danger-soft hover:brightness-95'
                    : 'bg-muted hover:bg-subtle'
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {t('owner.agingOrders')}
                </span>
                <span
                  className={cn(
                    'tabular mt-0.5 block text-base font-bold',
                    (data?.agingOrders ?? 0) > 0 && 'text-danger-ink'
                  )}
                >
                  {formatNumber(data?.agingOrders ?? 0)}
                </span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {t('dash.agingHint').replace('{n}', formatNumber(data?.agingThresholdHours ?? 24))}
                </span>
              </Link>
            </div>
          </Card>


          <Card>
            <CardHeader
              title={t('owner.agingOrders')}
              subtitle={t('order.aging')}
              action={
                <Link href="/owner/orders">
                  <Button variant="outline" size="sm">
                    {t('nav.orders')}
                  </Button>
                </Link>
              }
            />

            {aging.isLoading && <ListSkeleton rows={3} />}

            {aging.isError && (
              <ErrorState
                onRetry={() => aging.refetch()}
                isRetrying={aging.isFetching}
                error={aging.error}
              />
            )}

            {aging.isSuccess && aging.data.orders.length === 0 && (
              <EmptyState icon={ClipboardList} title={t('app.none')} />
            )}

            {aging.isSuccess && aging.data.orders.length > 0 && (
              <ul className="-my-1 divide-y divide-border">
                {aging.data.orders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href="/owner/orders"
                      className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="tabular truncate font-semibold">{order.orderCode}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {typeof order.reseller === 'object' ? order.reseller.shopName : ''}
                        </p>
                      </div>
                      <Badge tone={statusTone(order.status)} dot>
                        {formatAge(order.confirmedAt)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Rail>
          {/*
           * Money owed leads the rail, but it does not wear the brand fill. A
           * receivable is not good news, and painting it in the same mango as a
           * reseller's earnings would say it is.
           */}
          <HeroCard
            tone="alert"
            label={t('owner.receivable')}
            value={<CountUp value={receivable} format={formatMoney} />}
            caption={
              money && money.orders > 0
                ? `${t('owner.salesToday')} ${formatMoney(money.ownerRevenue)}`
                : t('owner.noMoneyToday')
            }
          />

          {/*
           * What to collect, at the top of the rail, because it is the first
           * thing done and the only panel here that sends somebody out of the
           * building. The sheet beside it is the one they take with them.
           */}
          <Panel
            title={t('owner.pickToday')}
            href="/owner/orders"
            hrefLabel={t('nav.orders')}
          >
            {pick.isLoading && <Skeleton className="h-20 w-full" />}

            {pick.isSuccess && pick.data.products.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">{t('app.none')}</p>
            )}

            {pick.isSuccess && pick.data.products.length > 0 && (
              <>
                <RailList>
                  {pick.data.products.slice(0, 5).map((product) => (
                    <RailRow
                      key={product.product}
                      name={product.name}
                      caption={
                        // The orchard, once one is decided. A confirmed order
                        // has none: it is chosen at accept. See docs/adr/0006.
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
                    className="block [&>button]:w-full"
                  />
                </div>
              </>
            )}
          </Panel>

          <Panel title={t('dash.topDebtors')} href="/owner/resellers" hrefLabel={t('nav.resellers')}>
            {resellers.isLoading && (
              <div className="space-y-3 py-1">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            )}

            {resellers.isSuccess && debtors.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">{t('app.none')}</p>
            )}

            {debtors.length > 0 && (
              <RailList>
                {debtors.map((reseller) => (
                  <RailRow
                    key={reseller.id}
                    name={reseller.shopName}
                    caption={reseller.user?.name}
                    href="/owner/resellers"
                    trailing={
                      <Badge tone="danger">{formatMoney(Math.abs(reseller.balance))}</Badge>
                    }
                  />
                ))}
              </RailList>
            )}
          </Panel>

          {/*
           * Everything waiting on the owner personally, as one block. These four
           * counts were previously scattered across the page and a banner; a
           * queue is what they actually are.
           */}
          <QueuePanel
            title={t('dash.queue')}
            subtitle={waiting > 0 ? t('dash.queueHelp') : undefined}
            href="/owner/finance"
            waiting={waiting}
            footer={waiting === 0 ? t('dash.queueEmpty') : undefined}
          >
            <QueueTile
              icon={ArrowDownToLine}
              label={t('nav.deposits')}
              count={formatNumber(data?.pendingDeposits ?? 0)}
              href="/owner/finance"
            />
            <QueueTile
              icon={ArrowUpFromLine}
              label={t('nav.withdrawals')}
              count={formatNumber(data?.pendingWithdrawals ?? 0)}
              href="/owner/finance"
            />
            <QueueTile
              icon={ClipboardCheck}
              label={t('owner.awaitingAcceptance')}
              count={formatNumber(data?.awaitingAcceptance ?? 0)}
              href="/owner/orders"
            />
            <QueueTile
              icon={Clock}
              label={t('owner.agingOrders')}
              count={formatNumber(data?.agingOrders ?? 0)}
              href="/owner/orders"
            />
            {/*
             * A reseller stuck in KYC cannot trade at all, and nothing on this
             * screen counted them: the only way to find out was to open the KYC
             * page on the off chance.
             */}
            <QueueTile
              icon={BadgeCheck}
              label={t('owner.pendingKyc')}
              count={formatNumber(data?.pendingKyc ?? 0)}
              href="/owner/kyc"
            />
            {/*
             * A customer who took the parcel, paid, and then rang to say the
             * fruit was bad leaves no other mark anywhere: the order reads as a
             * clean delivery for ever. This is the only place it shows.
             */}
            <QueueTile
              icon={MessageSquareWarning}
              label={t('complaint.title')}
              count={formatNumber(data?.openComplaints ?? 0)}
              href="/owner/complaints"
            />
          </QueuePanel>

          {/*
           * Things that are quietly broken, as one panel that is silent when
           * there is nothing to say. Each of these used to surface only as a
           * complaint: a customer who never got their SMS, a form that refused
           * an order because a product had run out.
           */}
          <Panel title={t('owner.health')} href="/owner/settings" hrefLabel={t('nav.settings')}>
            {problems === 0 ? (
              <p className="py-4 text-center text-sm text-success">{t('owner.healthOk')}</p>
            ) : (
              <RailList>
                {(health?.lowStock ?? 0) > 0 && (
                  <RailRow
                    name={t('owner.lowStock')}
                    href="/owner/products"
                    trailing={<Badge tone="warning">{formatNumber(health?.lowStock ?? 0)}</Badge>}
                  />
                )}
                {health?.smsEnabled === false && (
                  <RailRow
                    name={t('owner.smsOff')}
                    href="/owner/sms"
                    trailing={<TriangleAlert className="h-4 w-4 text-warning-ink" />}
                  />
                )}
                {(health?.deadLetters ?? 0) > 0 && (
                  <RailRow
                    name={t('owner.deadLetters')}
                    href="/owner/notifications"
                    trailing={<Badge tone="danger">{formatNumber(health?.deadLetters ?? 0)}</Badge>}
                  />
                )}
              </RailList>
            )}
          </Panel>
        </Rail>
      </DashboardGrid>
    </>
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
