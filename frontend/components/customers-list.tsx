'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ChevronRight, TriangleAlert, Users } from 'lucide-react';
import { useUrlSearch } from '@/lib/use-url-state';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useGetCustomersInfiniteQuery } from '@/lib/store/endpoints/people';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  Person,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { DownloadMenu } from '@/components/report/download-menu';
import { SearchInput, Toolbar } from '@/components/ui/toolbar';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';
import { isRisky } from '@/components/customer-profile';
import type { Customer } from '@/lib/types';

/**
 * Everyone who has ever ordered, listed by phone number.
 *
 * Shared by the owner and the reseller because the screen is the same; what
 * differs is behind it. The owner reads the shared customer record and sees
 * totals across every shop. A reseller's numbers are computed from their own
 * orders alone, so the same buyer shows fewer orders and less spend, which is
 * correct: a reseller must not be shown a competitor's sales.
 *
 * Sorted by who ordered most recently, because the reason this list is opened
 * is nearly always someone who has just rung up. The search is in the URL, so
 * opening a buyer and coming back keeps it.
 */
export function CustomersList({
  base,
  detailHref,
}: {
  /** The API prefix for this role: `/owner` or `/reseller`. */
  base: '/owner' | '/reseller';
  /** Builds the link to one buyer. The owner uses an id, the reseller a phone. */
  detailHref: (customer: Customer) => Route;
}) {
  const router = useRouter();
  // Debounced into the URL, because this searches names and phone tails across every order.
  const { input, setInput, term } = useUrlSearch();
  const role = base === '/owner' ? 'owner' : 'reseller';

  const customers = useGetCustomersInfiniteQuery({ role, q: term });
  const rows = customers.data?.pages.flatMap((page) => page.customers) ?? [];
  const total = customers.data?.pages[0]?.total ?? 0;
  // The previous results stay, dimmed, while a new search runs.
  const switching = customers.isFetching && !customers.isFetchingNextPage && !customers.currentData;

  return (
    <>
      <PageHeader
        title={t('cust.title')}
        subtitle={t('cust.help')}
        /*
         * Owner only. A reseller's view of a buyer is computed from their own
         * orders, and the report reads the shared record, which would show them
         * a competitor's sales.
         */
        action={
          base === '/owner' ? <DownloadMenu range={null} only={['customers']} /> : undefined
        }
      />

      <Toolbar>
        <SearchInput value={input} onChange={setInput} placeholder={t('cust.search')} />
      </Toolbar>

      {customers.isLoading && <ListSkeleton rows={5} />}

      {customers.isError && rows.length === 0 && (
        <ErrorState
          onRetry={() => customers.refetch()}
          isRetrying={customers.isFetching}
          error={customers.error}
        />
      )}

      {customers.isSuccess && rows.length === 0 &&
        (term ? (
          <FilteredEmpty onClear={() => setInput('')} title={t('app.noResults')} description={t('customers.searchEmpty')} />
        ) : (
          <EmptyState icon={Users} title={t('cust.none')} />
        ))}

      {rows.length > 0 && (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          {/* Cards below `lg`. A seven column table has no business being
            * squeezed into a tablet. */}
          <div className="grid gap-3 lg:hidden">
            {rows.map((customer) => {
              const bad = customer.cancelledCount + customer.returnedCount;
              return (
                <Link key={customer.id} href={detailHref(customer)} className="block">
                  <Card className="card-interactive p-4">
                    <div className="flex items-center gap-3">
                      <Person name={customer.name} caption={customer.phone} />
                      <span className="ml-auto shrink-0 text-right">
                        <span className="tabular block text-sm font-bold">
                          {formatNumber(customer.orderCount)}
                        </span>
                        <span className="block text-[0.6875rem] text-muted-foreground">
                          {t('cust.orders')}
                        </span>
                      </span>
                      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    {/*
                     * What decides whether to pack the next parcel, said on the
                     * card rather than one tap away.
                     */}
                    {(bad > 0 || customer.names.length > 1) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {bad > 0 && (
                          <Badge tone={isRisky(customer) ? 'danger' : 'warning'}>
                            {isRisky(customer) && <TriangleAlert aria-hidden className="h-3 w-3" />}
                            {tf('customers.badCount', { n: formatNumber(bad) })}
                          </Badge>
                        )}
                        {customer.names.length > 1 && (
                          <Badge tone="neutral">
                            {tf('customers.namesCount', { n: formatNumber(customer.names.length) })}
                          </Badge>
                        )}
                      </div>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>

          <TableWrap from="lg">
            <thead>
              <tr>
                <Th>{t('cust.title')}</Th>
                <Th className="text-right">{t('cust.orders')}</Th>
                <Th className="text-right">{t('cust.delivered')}</Th>
                <Th className="text-right">{t('customers.badColumn')}</Th>
                <Th className="text-right">{t('cust.spend')}</Th>
                <Th>{t('cust.lastOrder')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => {
                const bad = customer.cancelledCount + customer.returnedCount;
                return (
                  /*
                   * The whole row opens the buyer. The name is the real link, so
                   * it is the Tab stop and still opens in a new tab.
                   */
                  <Tr
                    key={customer.id}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a')) return;
                      router.push(detailHref(customer));
                    }}
                  >
                    <Td>
                      <Link href={detailHref(customer)} className="block rounded-md underline-offset-2 hover:underline">
                        <Person name={customer.name} caption={customer.phone} />
                      </Link>
                      {/*
                       * A buyer who has ordered under more than one name is the
                       * case this whole screen exists for, so the list says so
                       * rather than making someone open the record to find out.
                       */}
                      {customer.names.length > 1 && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {tf('customers.namesCount', { n: formatNumber(customer.names.length) })}
                        </span>
                      )}
                    </Td>
                    <Td className="tabular text-right font-semibold">
                      {formatNumber(customer.orderCount)}
                    </Td>
                    <Td className="tabular text-right">{formatNumber(customer.deliveredCount)}</Td>
                    <Td className="tabular text-right">
                      {bad > 0 ? (
                        <Badge tone={isRisky(customer) ? 'danger' : 'warning'}>
                          {formatNumber(customer.cancelledCount)} / {formatNumber(customer.returnedCount)}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="tabular text-right">{formatMoney(customer.totalSpend)}</Td>
                    <Td className="text-sm text-muted-foreground">
                      {formatDate(customer.lastOrderAt)}
                    </Td>
                    <Td className="text-right">
                      <ChevronRight aria-hidden className="ml-auto h-4 w-4 text-muted-foreground" />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>

          <LoadMore
            hasMore={Boolean(customers.hasNextPage)}
            loading={customers.isFetchingNextPage}
            onLoadMore={() => customers.fetchNextPage()}
            error={customers.isFetchNextPageError ? customers.error : null}
            shown={rows.length}
            total={total}
          />
        </div>
      )}
    </>
  );
}
