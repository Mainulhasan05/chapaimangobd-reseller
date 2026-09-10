'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatAge } from '@/lib/format';
import type { Order, OwnerDashboard, Paged } from '@/lib/types';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  statusTone,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ListSkeleton, Skeleton, StatSkeleton } from '@/components/ui/skeleton';
import { CountUp, Greeting, HeroCard } from '@/components/dashboard/metrics';
import { PipelineBar } from '@/components/dashboard/pipeline-bar';

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
    queryFn: () => api.get<Paged<'orders', Order>>('/owner/orders?aging=true&limit=10'),
  });

  const data = dashboard.data;

  if (dashboard.isLoading) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <Skeleton className="mb-4 h-32 w-full rounded-2xl" />
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
  const decisions = (data?.pendingDeposits ?? 0) + (data?.pendingWithdrawals ?? 0);

  return (
    <>
      <header className="mb-5">
        <Greeting name={session?.user.name} />
        <h1 className="text-2xl font-bold">{t('nav.dashboard')}</h1>
        <p className="text-sm text-muted-foreground">{data?.today}</p>
      </header>

      {/*
       * Money owed leads, but it does not wear the brand fill. A receivable is
       * not good news, and painting it in the same mango as a reseller's earnings
       * would say it is.
       */}
      <div className="mb-4">
        <HeroCard
          tone="alert"
          label={t('owner.receivable')}
          value={<CountUp value={receivable} format={formatMoney} />}
          caption={`${t('owner.ordersToday')} ${formatNumber(data?.ordersToday ?? 0)}`}
        />
      </div>

      {/* Anything waiting on the owner personally, as one line to act on. */}
      {decisions > 0 && (
        <Link href="/owner/finance" className="mb-4 block">
          <div className="flex items-center gap-3 rounded-xl bg-primary/25 px-4 py-3 ring-1 ring-primary/50 transition-colors hover:bg-primary/35">
            <span className="tabular text-2xl font-bold">{formatNumber(decisions)}</span>
            <span className="min-w-0 flex-1 text-sm font-bold">
              {t('nav.deposits')} · {t('nav.withdrawals')}
              <span className="block text-xs font-normal text-muted-foreground">
                {t('owner.approve')}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        </Link>
      )}

      {/*
       * Where the orders in flight are sitting. This is the owner's actual job
       * in one bar, and it replaces four separate counts that had to be added up
       * in the reader's head.
       */}
      <Card className="mb-4">
        <CardHeader title={t('dash.pipeline')} subtitle={data?.today} />
        <PipelineBar byStatus={data?.byStatus ?? {}} />
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('owner.ordersToday')} value={formatNumber(data?.ordersToday ?? 0)} />
        <Stat
          label={t('owner.awaitingAcceptance')}
          value={formatNumber(data?.awaitingAcceptance ?? 0)}
          tone={(data?.awaitingAcceptance ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label={t('owner.agingOrders')}
          value={formatNumber(data?.agingOrders ?? 0)}
          hint={`${formatNumber(data?.agingThresholdHours ?? 24)}+ ঘণ্টা`}
          tone={(data?.agingOrders ?? 0) > 0 ? 'danger' : 'neutral'}
        />
        <Stat label={t('owner.pendingDeposits')} value={formatNumber(data?.pendingDeposits ?? 0)} />
      </div>

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

        {aging.isSuccess && aging.data.orders.length === 0 && <EmptyState title={t('app.none')} />}

        {aging.isSuccess && aging.data.orders.length > 0 && (
          <ul className="divide-y divide-border">
            {aging.data.orders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="tabular truncate font-semibold">{order.orderCode}</p>
                  <p className="text-xs text-muted-foreground">
                    {typeof order.reseller === 'object' ? order.reseller.shopName : ''}
                  </p>
                </div>
                <Badge tone={statusTone(order.status)}>{formatAge(order.confirmedAt)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
