'use client';

/**
 * Everything customers have said was wrong, in one place.
 *
 * Opens on what is still open, because that is the working list; the rest is a
 * tab away. Filtering by kind is what turns it into evidence — "show me every
 * complaint about the fruit" is the question asked before deciding which
 * orchard to stop buying from, and the orchard report is one tap from here.
 *
 * Every filter lives in the URL, so opening an order from here and coming back
 * lands on the same list, and the dashboard's "open complaints" link opens it
 * already filtered.
 */

import { useState } from 'react';
import Link from 'next/link';
import { skipToken } from '@reduxjs/toolkit/query/react';
import type { Route } from 'next';
import { MessageSquarePlus, MessageSquareWarning, Store } from 'lucide-react';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { useUrlRange, useUrlSearch, useUrlState } from '@/lib/use-url-state';
import { useGetComplaintsInfiniteQuery, type ComplaintsArgs } from '@/lib/store/endpoints/complaints';
import { useGetSourceQuery } from '@/lib/store/endpoints/catalog';
import type { ComplaintKind } from '@/lib/types';
import { Alert, EmptyState, ErrorState, FilteredEmpty, PageHeader } from '@/components/ui/layout';
import { SearchInput, Segmented, Toolbar } from '@/components/ui/toolbar';
import { Button, ButtonLink } from '@/components/ui/button';
import { LoadMore } from '@/components/ui/load-more';
import { ListSkeleton } from '@/components/ui/skeleton';
import { DateRangeFilter } from '@/components/ui/date-range';
import { ComplaintList } from '@/components/complaints-panel';
import { ComplaintModal } from '@/components/complaint-modal';
import { cn } from '@/lib/utils';

const KIND_FILTERS: { value: '' | ComplaintKind; labelKey: DictKey }[] = [
  { value: '', labelKey: 'complaint.all' },
  { value: 'quality', labelKey: 'complaint.kind.quality' },
  { value: 'damaged', labelKey: 'complaint.kind.damaged' },
  { value: 'short_weight', labelKey: 'complaint.kind.short_weight' },
  { value: 'wrong_item', labelKey: 'complaint.kind.wrong_item' },
  { value: 'late', labelKey: 'complaint.kind.late' },
  { value: 'other', labelKey: 'complaint.kind.other' },
];

const STATES = ['open', 'done', 'all'] as const;
type ComplaintState = (typeof STATES)[number];

export default function ComplaintsPage() {
  const [filters, setFilters, { reset }] = useUrlState({ state: 'open', kind: '', source: '' });
  const { input, setInput, term } = useUrlSearch('q');
  const { preset, range, setRange, isDefault } = useUrlRange('all');
  const [writing, setWriting] = useState(false);

  const state: ComplaintState = STATES.includes(filters.state as ComplaintState)
    ? (filters.state as ComplaintState)
    : 'open';

  const args: ComplaintsArgs = {
    resolved: state === 'open' ? 'false' : state === 'done' ? 'true' : undefined,
    kind: filters.kind || undefined,
    source: filters.source || undefined,
    q: term || undefined,
    from: range?.from,
    to: range?.to,
  };

  const complaints = useGetComplaintsInfiniteQuery(args);
  // An orchard's page links here; the list has to say whose complaints these are.
  const sourceDetail = useGetSourceQuery(filters.source ? { id: filters.source } : skipToken);

  const rows = complaints.data?.pages.flatMap((page) => page.complaints) ?? [];
  // A filter whose request failed: the rows on screen are the previous filter's.
  const stale = complaints.isError && !complaints.currentData;
  const total = complaints.data?.pages[0]?.total ?? 0;
  const filtered =
    Boolean(term) || Boolean(filters.kind) || Boolean(filters.source) || !isDefault || state !== 'open';

  const clearAll = () => {
    reset();
    setInput('');
    setRange('all', null);
  };

  return (
    <>
      <PageHeader
        title={t('complaint.title')}
        subtitle={complaints.data ? `${formatNumber(total)} ${t('complaint.plural')}` : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/owner/reports/print/sources" variant="outline" size="sm">
              <Store aria-hidden className="h-4 w-4" />
              {t('report.sources')}
            </ButtonLink>
            <Button size="sm" onClick={() => setWriting(true)}>
              <MessageSquarePlus aria-hidden className="h-4 w-4" />
              {t('complaint.add')}
            </Button>
          </div>
        }
      />

      {filters.source && (
        <Alert tone="primary" title={sourceDetail.data?.source.name}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('orders.complaintsForSource')}</span>
            <Link
              href={`/owner/sources/${filters.source}` as Route}
              className="tap inline-flex items-center font-semibold text-primary-ink hover:underline"
            >
              {t('source.record')}
            </Link>
            <button
              type="button"
              onClick={() => setFilters({ source: '' })}
              className="tap font-semibold hover:underline"
            >
              {t('app.clear')}
            </button>
          </span>
        </Alert>
      )}

      <Toolbar>
        <SearchInput
          value={input}
          onChange={setInput}
          placeholder={t('orders.complaintSearch')}
          className="w-full sm:w-auto"
        />
        <Segmented
          label={t('app.status')}
          value={state}
          onChange={(next) => setFilters({ state: next })}
          options={[
            {
              value: 'open',
              label: t('complaint.open'),
              count: complaints.data?.pages[0]?.open,
            },
            { value: 'done', label: t('complaint.resolved') },
            { value: 'all', label: t('complaint.all') },
          ]}
        />
      </Toolbar>

      <Toolbar>
        <Segmented
          label={t('complaint.kind')}
          value={filters.kind}
          onChange={(next) => setFilters({ kind: next })}
          options={KIND_FILTERS.map((one) => ({ value: one.value, label: t(one.labelKey) }))}
        />
      </Toolbar>

      <DateRangeFilter className="mb-4" preset={preset} range={range} onChange={setRange} />

      {complaints.isLoading && <ListSkeleton />}

      {stale && (
        <ErrorState
          onRetry={() => complaints.refetch()}
          isRetrying={complaints.isFetching}
          error={complaints.error}
        />
      )}

      {complaints.currentData && rows.length === 0 &&
        (filtered ? (
          <FilteredEmpty onClear={clearAll} />
        ) : (
          <EmptyState
            icon={MessageSquareWarning}
            title={t('orders.complaintsAllClear')}
            description={t('orders.complaintsAllClearHelp')}
          />
        ))}

      {rows.length > 0 && (
        // Dimmed, not blanked, while a new filter loads: the old rows stay readable.
        <div
          className={cn(
            'transition-opacity',
            ((complaints.isFetching && !complaints.isFetchingNextPage) || stale) && 'opacity-60'
          )}
          inert={stale || undefined}
        >
          <ComplaintList complaints={rows} showOrder from="complaints" />

          <LoadMore
            hasMore={Boolean(complaints.hasNextPage)}
            loading={complaints.isFetchingNextPage}
            onLoadMore={() => complaints.fetchNextPage()}
            error={complaints.isFetchNextPageError ? complaints.error : undefined}
            shown={rows.length}
            total={total}
          />
        </div>
      )}

      {writing && <ComplaintModal onClose={() => setWriting(false)} />}
    </>
  );
}
