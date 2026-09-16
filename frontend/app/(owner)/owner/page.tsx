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
  Package,
  ShoppingBag,
  Truck,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t, tUnit } from '@/lib/i18n/bn';
import { businessDate, formatMoney, formatNumber, formatAge } from '@/lib/format';
import type { Order, OwnerDashboard, PickList, Paged, ResellerSummary } from '@/lib/types';
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
import { TrendChart, type TrendPoint } from '@/components/dashboard/trend-chart';
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

  const data = dashboard.data;

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

  const points: TrendPoint[] = (trend.data?.days ?? []).map((day) => ({
    date: day.date,
    value: day.customerTotal,
  }));

  /*
   * Everyone in the red, deepest first. The balance is the reseller's net
   * position, so a negative number is what they owe; sorting ascending puts the
   * largest debt at the top.
   */
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
       * The four figures lead, as a row of cards. The receivable used to be a
       * full-width block above them; it is now the first card in the row and the
       * hero has moved into the rail, because on a wide screen a single number
       * stretched across twelve hundred pixels is mostly empty space.
       */}
      {/*
       * Money leads, then work.
       *
       * This row used to be four counts and no taka figure at all, which meant
       * the screen could say forty orders came in and never what they were
       * worth. The owner's revenue is the wallet debit — goods at cost plus
       * delivery — and deliberately not the customer total, which carries the
       * resellers' margin and is therefore not the owner's money.
       */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ShoppingBag}
          tone="primary"
          label={t('owner.ordersToday')}
          value={formatNumber(data?.ordersToday ?? 0)}
          hint={
            (data?.closedToday.cancelled ?? 0) > 0
              ? `${t('order.cancelled')} ${formatNumber(data?.closedToday.cancelled ?? 0)}`
              : undefined
          }
          href="/owner/orders"
        />
        <Stat
          icon={ClipboardCheck}
          label={t('owner.awaitingAcceptance')}
          value={formatNumber(data?.awaitingAcceptance ?? 0)}
          tone={(data?.awaitingAcceptance ?? 0) > 0 ? 'warning' : 'neutral'}
          href="/owner/orders"
        />
        {/*
         * Cash the couriers are carrying. The credit only posts when an order
         * is marked delivered, so until then this is the owner's money out in
         * the world, and it appeared on no screen in the app.
         */}
        <Stat
          icon={Truck}
          label={t('owner.codInFlight')}
          value={formatMoney(data?.codInFlight.amount ?? 0)}
          hint={`${formatNumber(data?.codInFlight.orders ?? 0)} ${t('nav.orders')}`}
          tone={(data?.codInFlight.amount ?? 0) > 0 ? 'warning' : 'neutral'}
          href="/owner/orders"
        />
        <Stat
          icon={Clock}
          label={t('owner.agingOrders')}
          value={formatNumber(data?.agingOrders ?? 0)}
          hint={t('dash.agingHint').replace('{n}', formatNumber(data?.agingThresholdHours ?? 24))}
          tone={(data?.agingOrders ?? 0) > 0 ? 'danger' : 'neutral'}
          href="/owner/orders"
        />
      </div>

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
              title={t('dash.pipeline')}
              subtitle={data?.today}
              href="/owner/orders"
              hrefLabel={t('nav.orders')}
            />
            <PipelineBar byStatus={data?.byStatus ?? {}} />
          </Card>

          {/*
           * Seven days of trade. Placed under the pipeline, because the
           * pipeline says what is happening now and this says whether now is
           * normal — which is the question a single day's figure always raises
           * and never answers.
           */}
          <Card>
            <CardHeader
              title={t('owner.trend')}
              subtitle={t('owner.customerValue')}
              href="/owner/reports"
              hrefLabel={t('report.reports')}
            />
            {trend.isLoading && <Skeleton className="h-32 w-full" />}
            {trend.isSuccess && points.length > 0 && <TrendChart points={points} />}
            {trend.isSuccess && points.length === 0 && (
              <EmptyState icon={ChartColumn} title={t('app.none')} />
            )}
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
            subtitle={t('dash.queueHelp')}
            href="/owner/finance"
            footer={
              (data?.pendingDeposits ?? 0) +
                (data?.pendingWithdrawals ?? 0) +
                (data?.awaitingAcceptance ?? 0) +
                (data?.agingOrders ?? 0) ===
              0
                ? t('dash.queueEmpty')
                : undefined
            }
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
