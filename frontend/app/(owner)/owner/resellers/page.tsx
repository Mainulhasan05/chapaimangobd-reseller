'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ChevronRight, Store, TrendingDown, Users } from 'lucide-react';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatSignedMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUrlSearch, useUrlState } from '@/lib/use-url-state';
import type { KycStatus, ResellerSummary } from '@/lib/types';
import { useGetResellersInfiniteQuery, type ResellerSort } from '@/lib/store/endpoints/people';
import { useGetReceivablesQuery } from '@/lib/store/endpoints/reports';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  Person,
  PhoneLink,
  SortTh,
  Stat,
  statusTone,
  TableWrap,
  Td,
  Th,
  Tr,
  type SortState,
} from '@/components/ui/layout';
import { rangeOf } from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Segmented, SearchInput, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Select } from '@/components/ui/form';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';

/**
 * Every reseller, with what they owe.
 *
 * A row opens the reseller's own page, where everything that used to be
 * crammed into one long "manage" sheet now lives: the account switches, the
 * money and the ledger. Search and sort run on the server, so "who owes me the
 * most" is the whole list sorted, not the first fifty rows reordered.
 */

const KYC_LABEL: Record<KycStatus, DictKey> = {
  not_submitted: 'kyc.notSubmitted',
  pending: 'kyc.pending',
  approved: 'kyc.approved',
  rejected: 'kyc.rejected',
};

const KYC_FILTERS: { value: '' | KycStatus; label: string }[] = [
  { value: '', label: t('app.all') },
  { value: 'pending', label: t('kyc.pending') },
  { value: 'approved', label: t('kyc.approved') },
  { value: 'rejected', label: t('kyc.rejected') },
  { value: 'not_submitted', label: t('kyc.notSubmitted') },
];

const SORTS: { value: ResellerSort; label: string }[] = [
  { value: 'newest', label: t('resellers.sortNewest') },
  { value: 'balance_asc', label: t('resellers.sortOwed') },
  { value: 'balance_desc', label: t('resellers.sortHeld') },
  { value: 'name', label: t('resellers.sortName') },
];

const PAGE_SIZE = 50;

/** The table header's arrows, read off the server's sort. */
function headerSort(sort: ResellerSort): SortState<'shop' | 'balance'> {
  if (sort === 'name') return { key: 'shop', direction: 'asc' };
  if (sort === 'balance_asc') return { key: 'balance', direction: 'asc' };
  if (sort === 'balance_desc') return { key: 'balance', direction: 'desc' };
  return null;
}

const detailHref = (reseller: ResellerSummary) => `/owner/resellers/${reseller.id}` as Route;

export default function OwnerResellersPage() {
  const router = useRouter();
  const [filters, setFilters, { reset }] = useUrlState({ kyc: '', sort: 'newest' });
  const { input, setInput, term } = useUrlSearch();
  const kycStatus = (KYC_FILTERS.some((f) => f.value === filters.kyc) ? filters.kyc : '') as '' | KycStatus;
  const sort = (SORTS.some((s) => s.value === filters.sort) ? filters.sort : 'newest') as ResellerSort;

  /*
   * Newest first pages by cursor, so a list that grows while it is read cannot
   * skip or repeat a row. Any other order comes back whole.
   */
  const resellers = useGetResellersInfiniteQuery({ kycStatus, q: term, sort, limit: PAGE_SIZE });

  /*
   * The money figures come from the receivables report, which sums the ledger
   * across every reseller, rather than from whichever pages happen to be loaded.
   */
  const receivables = useGetReceivablesQuery();

  const rows = resellers.data?.pages.flatMap((page) => page.resellers) ?? [];
  const switching = resellers.isFetching && !resellers.isFetchingNextPage && !resellers.currentData;
  const filtered = Boolean(term || kycStatus);

  const debtorCount = receivables.data?.resellers.filter((row) => row.owed > 0).length;
  const owed = receivables.data?.totalOwed;

  const onHeaderSort = (column: 'shop' | 'balance') => {
    if (column === 'shop') setFilters({ sort: sort === 'name' ? 'newest' : 'name' });
    // Owed first is the question this column is clicked for, so it comes first.
    else setFilters({ sort: sort === 'balance_asc' ? 'balance_desc' : 'balance_asc' });
  };

  return (
    <>
      <PageHeader
        title={t('nav.resellers')}
        subtitle={t('resellers.subtitle')}
        /*
         * The two reports this screen raises the question for: who sold what,
         * and who owes what. Both default to the last thirty days, which is the
         * window a reseller conversation is usually about.
         */
        action={<DownloadMenu range={rangeOf('last30')} only={['resellers', 'due']} />}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          icon={Users}
          tone="primary"
          /*
           * The API pages by cursor and sends no total, so this is what is
           * loaded, and says so when a filter or a search narrowed it.
           */
          label={filtered ? t('resellers.countFiltered') : t('nav.resellers')}
          value={
            resellers.isLoading
              ? '—'
              : `${formatNumber(rows.length)}${resellers.hasNextPage ? '+' : ''}`
          }
        />
        <Stat
          icon={TrendingDown}
          label={t('resellers.debtorCount')}
          value={debtorCount == null ? '—' : formatNumber(debtorCount)}
          tone={(debtorCount ?? 0) > 0 ? 'warning' : 'neutral'}
          href={'/owner/resellers?sort=balance_asc' as Route}
        />
        <Stat
          className="col-span-2 sm:col-span-1"
          icon={Store}
          label={t('owner.receivable')}
          value={owed == null ? '—' : formatMoney(owed)}
          tone={(owed ?? 0) > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {/* The two money figures failed, not zero: say so and offer the retry. */}
      {receivables.isError && (
        <p className="-mt-3 mb-4 flex flex-wrap items-center gap-x-2 text-sm text-danger">
          {t('resellers.figuresFailed')}
          <button
            type="button"
            onClick={() => receivables.refetch()}
            disabled={receivables.isFetching}
            className="tap rounded-lg px-2 font-semibold underline underline-offset-2 disabled:opacity-50"
          >
            {t('app.retry')}
          </button>
        </p>
      )}

      <Toolbar>
        <Segmented
          label={t('kyc.title')}
          value={kycStatus}
          onChange={(value) => setFilters({ kyc: value })}
          options={KYC_FILTERS}
        />
        <ToolbarSpacer />
        <SearchInput value={input} onChange={setInput} placeholder={t('resellers.search')} />
        {/* Visible at every width: it orders the cards as well as the table. */}
        <Select
          aria-label={t('app.sortBy')}
          value={sort}
          onChange={(event) => setFilters({ sort: event.target.value as ResellerSort })}
          className="w-full sm:w-auto"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Toolbar>

      {resellers.isLoading && <ListSkeleton />}

      {resellers.isError && rows.length === 0 && (
        <ErrorState
          onRetry={() => resellers.refetch()}
          isRetrying={resellers.isFetching}
          error={resellers.error}
        />
      )}

      {resellers.isSuccess && rows.length === 0 &&
        (filtered ? (
          <FilteredEmpty
            onClear={() => {
              setInput('');
              reset();
            }}
          />
        ) : (
          <EmptyState icon={Users} title={t('resellers.none')} description={t('resellers.noneHelp')} />
        ))}

      {rows.length > 0 && (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          {/* Cards below `lg`; the whole card opens the reseller. */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {rows.map((reseller) => (
              <li key={reseller.id}>
                <Link href={detailHref(reseller)} className="block">
                  <Card className="card-interactive p-4">
                    <div className="flex items-start justify-between gap-3">
                      <Person name={reseller.shopName} caption={reseller.user?.name} size="sm" />
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {reseller.kycRequired || reseller.kycStatus !== 'not_submitted' ? (
                          <Badge tone={statusTone(reseller.kycStatus)} dot>
                            {t(KYC_LABEL[reseller.kycStatus])}
                          </Badge>
                        ) : null}
                        {reseller.user && !reseller.user.isActive && (
                          <Badge tone="danger">{t('reseller.inactive')}</Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                      <div>
                        <p className="text-xs text-muted-foreground">{t('wallet.balance')}</p>
                        <p
                          className={cn(
                            'tabular text-lg font-bold',
                            reseller.balance < 0 ? 'text-danger' : 'text-success'
                          )}
                        >
                          {formatSignedMoney(reseller.balance)}
                        </p>
                        <p className="tabular text-xs text-muted-foreground">
                          {t('wallet.creditLimit')} {formatMoney(reseller.creditLimit)}
                        </p>
                      </div>
                      <ChevronRight aria-hidden className="mb-1 h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          <TableWrap from="lg">
            <thead>
              <tr>
                <SortTh column="shop" sort={headerSort(sort)} onSort={onHeaderSort}>
                  {t('auth.shopName')}
                </SortTh>
                <Th>{t('auth.phone')}</Th>
                <Th>{t('kyc.title')}</Th>
                <SortTh column="balance" sort={headerSort(sort)} onSort={onHeaderSort} align="right">
                  {t('wallet.balance')}
                </SortTh>
                <Th className="text-right">{t('wallet.creditLimit')}</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map((reseller) => (
                /*
                 * The whole row opens the reseller; the shop name is the real
                 * link, so it is reachable by Tab and opens in a new tab too.
                 */
                <Tr
                  key={reseller.id}
                  className="cursor-pointer"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a')) return;
                    router.push(detailHref(reseller));
                  }}
                >
                  <Td>
                    <Link
                      href={detailHref(reseller)}
                      className="block rounded-md underline-offset-2 hover:underline"
                    >
                      <Person name={reseller.shopName} caption={`/r/${reseller.slug}`} size="sm" />
                    </Link>
                  </Td>
                  <Td>
                    <div className="text-sm font-medium">{reseller.user?.name}</div>
                    <PhoneLink phone={reseller.user?.phoneE164} className="text-xs text-muted-foreground" />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {reseller.kycRequired || reseller.kycStatus !== 'not_submitted' ? (
                        <Badge tone={statusTone(reseller.kycStatus)} dot>
                          {t(KYC_LABEL[reseller.kycStatus])}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('resellers.kycNotAsked')}</span>
                      )}
                      {reseller.user && !reseller.user.isActive && (
                        <Badge tone="danger">{t('reseller.inactive')}</Badge>
                      )}
                    </div>
                  </Td>
                  <Td
                    className={cn(
                      'tabular text-right font-semibold',
                      reseller.balance < 0 ? 'text-danger' : 'text-success'
                    )}
                  >
                    {formatSignedMoney(reseller.balance)}
                  </Td>
                  <Td className="tabular text-right">{formatMoney(reseller.creditLimit)}</Td>
                  <Td className="text-right">
                    <ChevronRight aria-hidden className="ml-auto h-4 w-4 text-muted-foreground" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          <LoadMore
            hasMore={Boolean(resellers.hasNextPage)}
            loading={resellers.isFetchingNextPage}
            onLoadMore={() => resellers.fetchNextPage()}
            error={resellers.isFetchNextPageError ? resellers.error : null}
          />
        </div>
      )}
    </>
  );
}
