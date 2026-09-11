'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  ClipboardList,
  CreditCard,
  Plus,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatAge } from '@/lib/format';
import type { Order, Wallet, Paged } from '@/lib/types';
import {
  Badge,
  Card,
  CardHeader,
  DashboardGrid,
  EmptyState,
  ErrorState,
  Rail,
  Stat,
  statusTone,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ListSkeleton, Skeleton } from '@/components/ui/skeleton';
import { CountUp, Greeting, HeroCard, Meter } from '@/components/dashboard/metrics';
import { TrendChart, type TrendPoint } from '@/components/dashboard/trend-chart';
import { KycBanner } from '@/components/kyc-banner';
import { ShareShopButton, useShopUrl } from '@/components/share-shop';

type DailyStats = { days: { date: string; orders: number; margin: number }[] };

/**
 * The reseller's morning screen.
 *
 * Ordered by what the job actually is rather than by what is easiest to measure.
 * The wallet leads, because it is the number a reseller opens the app to check.
 * Orders waiting to be confirmed come next, as an instruction rather than a
 * count. Then the week's earnings, which is the only place in the app that says
 * whether any of this is working.
 *
 * On a wide screen that order becomes two columns: the work on the left, the
 * money and the shop link in the rail. On a phone it is the same sequence it
 * always was, top to bottom, because the rail simply stacks underneath.
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

  const stats = useQuery({
    queryKey: ['stats', 'daily'],
    queryFn: () => api.get<DailyStats>('/reseller/orders/stats/daily?days=7'),
    // A week's shape does not change minute to minute.
    staleTime: 5 * 60_000,
  });

  const balance = wallet.data?.wallet.balance ?? 0;
  const owes = balance < 0;
  const creditLimit = wallet.data?.wallet.creditLimit ?? 0;
  const pendingCount = pending.data?.total ?? 0;

  const points: TrendPoint[] =
    stats.data?.days.map((day) => ({ date: day.date, value: day.margin })) ?? [];
  const weekTotal = points.reduce((sum, point) => sum + point.value, 0);
  const weekOrders = stats.data?.days.reduce((sum, day) => sum + day.orders, 0) ?? 0;

  return (
    <>
      <header className="mb-5">
        <Greeting name={session?.user.name} />
        <h1 className="text-2xl font-bold">{profile?.shopName ?? t('nav.dashboard')}</h1>
      </header>

      <KycBanner />

      {/*
       * The first thing after the greeting is the thing to do, not a number
       * about it. A count in a card is a fact; this is an instruction, so it
       * stays full width above the split rather than becoming another tile.
       */}
      {pendingCount > 0 && (
        <Link href="/reseller/orders?status=pending" className="mb-4 block">
          <div className="flex items-center gap-3 rounded-xl bg-warning-soft px-4 py-3 ring-1 ring-warning/50 transition-colors hover:brightness-[0.98]">
            <span className="tabular text-2xl font-bold text-warning-ink">
              {formatNumber(pendingCount)}
            </span>
            <span className="min-w-0 flex-1 text-sm font-bold">
              {t('order.pending')}
              <span className="block text-xs font-normal text-muted-foreground">
                {t('order.confirmHelp')}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        </Link>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ClipboardList}
          label={t('order.pending')}
          value={formatNumber(pendingCount)}
          tone={pendingCount > 0 ? 'warning' : 'neutral'}
          href="/reseller/orders"
        />
        <Stat
          icon={TrendingUp}
          tone="success"
          label={t('dash.earnings')}
          value={stats.isSuccess ? <CountUp value={weekTotal} format={formatMoney} /> : '—'}
          hint={t('dash.last7Days')}
        />
        <Stat
          icon={ShoppingBag}
          tone="primary"
          label={t('nav.orders')}
          value={formatNumber(weekOrders)}
          hint={t('dash.last7Days')}
          href="/reseller/orders"
        />
        <Stat
          icon={CreditCard}
          label={t('wallet.creditLimit')}
          value={formatMoney(creditLimit)}
          href="/reseller/wallet"
        />
      </div>

      <DashboardGrid>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title={t('dash.earnings')}
              subtitle={t('dash.last7Days')}
              action={
                <div className="shrink-0 text-right">
                  <div className="tabular text-xl font-bold text-success-ink">
                    {stats.isSuccess ? <CountUp value={weekTotal} format={formatMoney} /> : '—'}
                  </div>
                  <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                    <TrendingUp aria-hidden className="h-3 w-3" />
                    <span className="tabular">
                      {formatNumber(weekOrders)} {t('nav.orders')}
                    </span>
                  </div>
                </div>
              }
            />

            {stats.isLoading && <Skeleton className="h-32 w-full" />}

            {stats.isError && (
              <ErrorState
                onRetry={() => stats.refetch()}
                isRetrying={stats.isFetching}
                error={stats.error}
              />
            )}

            {stats.isSuccess && points.length > 0 && <TrendChart points={points} />}
          </Card>

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
                icon={ClipboardList}
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
              <ul className="-my-1 divide-y divide-border">
                {pending.data.orders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/reseller/orders?open=${order.id}`}
                      className="tap -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 transition-colors hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{order.customer.name}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {order.orderCode} · {formatAge(order.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="tabular text-sm font-semibold">
                          {formatMoney(order.totals.customerTotal)}
                        </span>
                        <Badge tone={statusTone(order.status)} dot>
                          {t('order.pending')}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Rail>
          {wallet.isLoading && <Skeleton className="h-36 w-full rounded-2xl" />}

          {wallet.isError && (
            <ErrorState
              onRetry={() => wallet.refetch()}
              isRetrying={wallet.isFetching}
              error={wallet.error}
            />
          )}

          {wallet.isSuccess && (
            <HeroCard
              tone={owes ? 'alert' : 'brand'}
              label={owes ? t('wallet.owed') : t('wallet.balance')}
              value={<CountUp value={Math.abs(balance)} format={formatMoney} />}
              caption={`${t('wallet.available')} ${formatMoney(wallet.data.wallet.available)}`}
            >
              {/*
               * A ratio against a limit is a meter, not a second number to
               * compare by eye. It only appears where a limit was granted.
               */}
              {creditLimit > 0 && (
                <div className="mt-4">
                  <Meter
                    tone={owes ? 'alert' : 'brand'}
                    label={t('dash.creditUsed')}
                    used={owes ? Math.abs(balance) : 0}
                    total={creditLimit}
                    caption={formatMoney(creditLimit)}
                  />
                </div>
              )}
            </HeroCard>
          )}

          <Card>
            <div className="grid gap-2">
              <Link href="/reseller/orders/new">
                <Button full>
                  <Plus className="h-4 w-4" />
                  {t('order.manualOrder')}
                </Button>
              </Link>
              <Link href="/reseller/wallet">
                <Button variant="outline" full>
                  {t('wallet.depositRequest')}
                </Button>
              </Link>
            </div>
          </Card>

          {/* Sharing the link is the growth loop, so it is a button, not a page. */}
          {profile?.slug && profile.kycStatus === 'approved' && (
            <Card>
              <CardHeader
                title={t('shop.yourLink')}
                subtitle={t('shop.shareHelp')}
                href="/reseller/shop"
                hrefLabel={t('nav.myShop')}
              />
              <ShareShopButton url={shopUrl} shopName={profile.shopName} full size="lg" />
            </Card>
          )}
        </Rail>
      </DashboardGrid>
    </>
  );
}
