'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatAge } from '@/lib/format';
import type { Order, Wallet, Paged } from '@/lib/types';
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
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { KycBanner } from '@/components/kyc-banner';
import { ShareShopButton, useShopUrl } from '@/components/share-shop';

/**
 * The reseller's morning screen.
 *
 * Ordered by what the job actually is rather than by what is easiest to
 * measure. Orders waiting to be confirmed come first, because until one is
 * confirmed no money has moved for anybody. The wallet is second. The share
 * link is third and is a button here rather than a URL on another page, since
 * pasting it into a chat is how this business grows.
 */
export default function ResellerDashboard() {
  const { data: session } = useSession();
  const profile = session?.profile;
  const shopUrl = useShopUrl(profile?.slug);

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
  const pendingCount = pending.data?.total ?? 0;

  return (
    <>
      <PageHeader title={t('nav.dashboard')} subtitle={profile?.shopName} />

      <KycBanner />

      {/*
       * The first thing on the page is the thing to do, not a number about it.
       * A count in a card is a fact; this is an instruction.
       */}
      {pendingCount > 0 && (
        <Link href="/reseller/orders?status=pending" className="mb-4 block">
          <div className="flex items-center gap-3 rounded-xl bg-primary/15 px-4 py-3">
            <span className="tabular text-2xl font-semibold">{formatNumber(pendingCount)}</span>
            <span className="min-w-0 flex-1 text-sm font-medium">
              {t('order.pending')}
              <span className="block text-xs font-normal text-muted-foreground">
                {t('order.confirmHelp')}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        </Link>
      )}

      {wallet.isLoading && <StatSkeleton count={2} />}

      {wallet.isError && (
        <div className="mb-6">
          <ErrorState
          onRetry={() => wallet.refetch()}
          isRetrying={wallet.isFetching}
          error={wallet.error}
        />
        </div>
      )}

      {wallet.isSuccess && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Stat
            label={owes ? t('wallet.owed') : t('wallet.balance')}
            value={formatMoney(Math.abs(balance))}
            hint={t('wallet.negativeHelp')}
            tone={owes ? 'danger' : 'success'}
          />
          <Stat
            label={t('wallet.available')}
            value={formatMoney(wallet.data.wallet.available ?? 0)}
            hint={`${t('wallet.creditLimit')} ${formatMoney(wallet.data.wallet.creditLimit ?? 0)}`}
          />
        </div>
      )}

      <div className="mb-6 flex gap-2 [&>a]:flex-1">
        <Link href="/reseller/wallet">
          <Button variant="outline" full>
            {t('wallet.depositRequest')}
          </Button>
        </Link>
        <Link href="/reseller/orders/new">
          <Button variant="outline" full>
            {t('order.manualOrder')}
          </Button>
        </Link>
      </div>

      {/* Sharing the link is the growth loop, so it is a button, not a page. */}
      {profile?.slug && profile.kycStatus === 'approved' && (
        <Card className="mb-6">
          <CardHeader title={t('shop.yourLink')} subtitle={t('shop.shareHelp')} />
          <ShareShopButton url={shopUrl} shopName={profile.shopName} full size="lg" />
          <Link
            href="/reseller/shop"
            className="mt-3 block text-center text-sm text-muted-foreground underline"
          >
            {t('nav.myShop')}
          </Link>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t('order.pending')}
          action={
            <Link href="/reseller/orders">
              <Button variant="outline" size="sm">
                {t('nav.orders')}
              </Button>
            </Link>
          }
        />

        {pending.isLoading && <ListSkeleton rows={3} />}

        {pending.isError && (
          <ErrorState
          onRetry={() => pending.refetch()}
          isRetrying={pending.isFetching}
          error={pending.error}
        />
        )}

        {pending.isSuccess && pending.data.orders.length === 0 && (
          <EmptyState
            title={t('order.noOrders')}
            description={t('shop.shareHelp')}
            action={
              <Link href="/reseller/shop">
                <Button size="sm">{t('shop.yourLink')}</Button>
              </Link>
            }
          />
        )}

        {pending.isSuccess && pending.data.orders.length > 0 && (
          <ul className="divide-y divide-border">
            {pending.data.orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/reseller/orders?open=${order.id}`}
                  className="tap flex items-center justify-between gap-3 py-3 hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{order.customer.name}</p>
                    <p className="tabular text-xs text-muted-foreground">
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
