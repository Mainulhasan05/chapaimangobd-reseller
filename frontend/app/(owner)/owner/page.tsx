'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Package,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatAge } from '@/lib/format';
import type { Order, OwnerDashboard, Paged, ResellerSummary } from '@/lib/types';
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
   * Who owes the most, for the rail. The receivable figure at the top of the
   * page says how much is outstanding; this says who to ring about it, which is
   * the question the figure immediately raises.
   */
  const resellers = useQuery({
    queryKey: ['owner', 'resellers', 'debtors'],
    queryFn: () => api.get<Paged<'resellers', ResellerSummary>>('/owner/resellers?limit=50'),
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
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ShoppingBag}
          tone="primary"
          label={t('owner.ordersToday')}
          value={formatNumber(data?.ordersToday ?? 0)}
          href="/owner/orders"
        />
        <Stat
          icon={ClipboardCheck}
          label={t('owner.awaitingAcceptance')}
          value={formatNumber(data?.awaitingAcceptance ?? 0)}
          tone={(data?.awaitingAcceptance ?? 0) > 0 ? 'warning' : 'neutral'}
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
        <Stat
          icon={Wallet}
          label={t('owner.pendingDeposits')}
          value={formatNumber(data?.pendingDeposits ?? 0)}
          tone={(data?.pendingDeposits ?? 0) > 0 ? 'warning' : 'neutral'}
          href="/owner/finance"
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
            label={t('nav.reports')}
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
            caption={`${t('owner.ordersToday')} ${formatNumber(data?.ordersToday ?? 0)}`}
          />

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
          </QueuePanel>
        </Rail>
      </DashboardGrid>
    </>
  );
}
