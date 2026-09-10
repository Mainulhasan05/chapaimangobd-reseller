'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatAge } from '@/lib/format';
import type { Order, Wallet, Paged } from '@/lib/types';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, statusTone } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { KycBanner } from '@/components/kyc-banner';

export default function ResellerDashboard() {
  const { data: session } = useSession();

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.get<{ wallet: Wallet }>('/reseller/wallet'),
  });

  const pending = useQuery({
    queryKey: ['orders', 'pending'],
    queryFn: () => api.get<Paged<'orders', Order>>('/reseller/orders?status=pending&limit=5'),
    // New orders arrive without a page reload; push may never be delivered, so
    // polling is what the badge actually relies on.
    refetchInterval: 60_000,
  });

  const balance = wallet.data?.wallet.balance ?? 0;
  const owes = balance < 0;

  return (
    <>
      <PageHeader title={t('nav.dashboard')} subtitle={session?.profile?.shopName} />

      <KycBanner />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label={owes ? t('wallet.owed') : t('wallet.balance')}
          value={formatMoney(Math.abs(balance))}
          hint={t('wallet.negativeHelp')}
          tone={owes ? 'danger' : 'success'}
        />
        <Stat
          label={t('wallet.available')}
          value={formatMoney(wallet.data?.wallet.available ?? 0)}
          hint={`${t('wallet.creditLimit')} ${formatMoney(wallet.data?.wallet.creditLimit ?? 0)}`}
        />
        <Stat
          label={t('order.pending')}
          value={formatNumber(pending.data?.total ?? 0)}
          tone={(pending.data?.total ?? 0) > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader
          title={t('order.pending')}
          subtitle={t('order.confirmHelp')}
          action={
            <Link href="/reseller/orders">
              <Button variant="outline" size="sm">
                {t('nav.orders')}
              </Button>
            </Link>
          }
        />

        {pending.data && pending.data.orders.length === 0 ? (
          <EmptyState
            title={t('order.noOrders')}
            description={t('shop.shareHelp')}
            action={
              <Link href="/reseller/shop">
                <Button size="sm">{t('shop.yourLink')}</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {pending.data?.orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/reseller/orders?open=${order.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{order.customer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.orderCode} · {formatAge(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-sm">
                      {formatMoney(order.totals.customerTotal)}
                    </span>
                    <Badge tone={statusTone(order.status)}>{t('order.pending')}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
