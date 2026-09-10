'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatAge } from '@/lib/format';
import type { Order, OwnerDashboard, Paged } from '@/lib/types';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, statusTone } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';

export default function OwnerDashboardPage() {
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
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <PageHeader title={t('nav.dashboard')} subtitle={data?.today} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('owner.receivable')}
          value={formatMoney(data?.totalReceivable ?? 0)}
          tone={(data?.totalReceivable ?? 0) > 0 ? 'danger' : 'neutral'}
        />
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
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Stat label={t('owner.pendingDeposits')} value={formatNumber(data?.pendingDeposits ?? 0)} />
        <Stat
          label={t('owner.pendingWithdrawals')}
          value={formatNumber(data?.pendingWithdrawals ?? 0)}
        />
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

        {aging.data && aging.data.orders.length === 0 ? (
          <EmptyState title={t('app.none')} />
        ) : (
          <ul className="divide-y divide-border">
            {aging.data?.orders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="tabular truncate font-medium">{order.orderCode}</p>
                  <p className="text-xs text-muted-foreground">
                    {typeof order.reseller === 'object' ? order.reseller.shopName : ''} ·{' '}
                    {formatAge(order.confirmedAt)}
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
