'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatDate } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Person,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { SearchInput, Toolbar } from '@/components/ui/toolbar';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';
import type { Customer, Paged } from '@/lib/types';

const PAGE_SIZE = 30;

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
 * is nearly always someone who has just rung up.
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
  const [term, setTerm] = useState('');
  // Debounced, because this searches names and phone tails across every order.
  const search = useDebounced(term, 300);

  const customers = useInfiniteQuery({
    queryKey: ['customers', base, search],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'customers', Customer>>(
        `${base}/customers?limit=${PAGE_SIZE}&page=${pageParam}` +
          `${search ? `&q=${encodeURIComponent(search)}` : ''}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.customers.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });

  const rows = customers.data?.pages.flatMap((page) => page.customers) ?? [];
  const total = customers.data?.pages[0]?.total ?? 0;

  return (
    <>
      <PageHeader title={t('cust.title')} subtitle={t('cust.help')} />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('cust.search')} />
      </Toolbar>

      {customers.isLoading && <ListSkeleton rows={5} />}

      {customers.isError && rows.length === 0 && (
        <ErrorState
          onRetry={() => customers.refetch()}
          isRetrying={customers.isFetching}
          error={customers.error}
        />
      )}

      {customers.isSuccess && rows.length === 0 && (
        <EmptyState icon={Users} title={search ? t('app.noResults') : t('cust.none')} />
      )}

      {rows.length > 0 && (
        <>
          {/* Cards below `lg`. A seven column table has no business being
            * squeezed into a tablet. */}
          <div className="grid gap-3 lg:hidden">
            {rows.map((customer) => (
              <Link key={customer.id} href={detailHref(customer)}>
                <Card className="flex items-center gap-3 p-4">
                  <Person name={customer.name} caption={customer.phone} />
                  <span className="ml-auto shrink-0 text-right">
                    <span className="tabular block text-sm font-bold">
                      {formatNumber(customer.orderCount)}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {t('cust.orders')}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Card>
              </Link>
            ))}
          </div>

          <TableWrap from="lg">
            <thead>
              <tr>
                <Th>{t('cust.title')}</Th>
                <Th className="text-right">{t('cust.orders')}</Th>
                <Th className="text-right">{t('cust.delivered')}</Th>
                <Th className="text-right">{t('cust.cancelled')}</Th>
                <Th className="text-right">{t('cust.spend')}</Th>
                <Th>{t('cust.lastOrder')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <Tr key={customer.id}>
                  <Td>
                    <Person name={customer.name} caption={customer.phone} />
                    {/*
                     * A buyer who has ordered under more than one name is the
                     * case this whole screen exists for, so the list says so
                     * rather than making someone open the record to find out.
                     */}
                    {customer.names.length > 1 && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t('cust.namesUsed')}: {formatNumber(customer.names.length)}
                      </span>
                    )}
                  </Td>
                  <Td className="tabular text-right font-semibold">
                    {formatNumber(customer.orderCount)}
                  </Td>
                  <Td className="tabular text-right">{formatNumber(customer.deliveredCount)}</Td>
                  <Td className="tabular text-right">
                    {customer.cancelledCount + customer.returnedCount > 0 ? (
                      <Badge tone="danger">
                        {formatNumber(customer.cancelledCount + customer.returnedCount)}
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
                    <Link
                      href={detailHref(customer)}
                      aria-label={customer.name ?? customer.phone}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Td>
                </Tr>
              ))}
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
        </>
      )}
    </>
  );
}
