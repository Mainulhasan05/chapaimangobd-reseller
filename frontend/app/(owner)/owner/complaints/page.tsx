'use client';

/**
 * Everything customers have said was wrong, in one place.
 *
 * Opens on what is still open, because that is the working list; the rest is a
 * tab away. Filtering by kind is what turns it into evidence — "show me every
 * complaint about the fruit" is the question asked before deciding which
 * orchard to stop buying from, and the orchard report is one tap from here.
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { MessageSquareWarning, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import type { Complaint, ComplaintKind } from '@/lib/types';
import {
  EmptyState,
  ErrorState,
  PageHeader,
} from '@/components/ui/layout';
import { Segmented, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { ComplaintList } from '@/components/complaints-panel';
import {
  DateRangeFilter,
  rangeQuery,
  type DateRange,
  type PresetKey,
} from '@/components/ui/date-range';

const PAGE_SIZE = 20;

const KIND_FILTERS: { value: '' | ComplaintKind; labelKey: string }[] = [
  { value: '', labelKey: 'complaint.all' },
  { value: 'quality', labelKey: 'complaint.kind.quality' },
  { value: 'damaged', labelKey: 'complaint.kind.damaged' },
  { value: 'short_weight', labelKey: 'complaint.kind.short_weight' },
  { value: 'wrong_item', labelKey: 'complaint.kind.wrong_item' },
  { value: 'late', labelKey: 'complaint.kind.late' },
];

type Page = { complaints: Complaint[]; total: number; open: number };

export default function ComplaintsPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ComplaintsView />
    </Suspense>
  );
}

function ComplaintsView() {
  const params = useSearchParams();
  // An orchard's page links here to show only what was said about it.
  const source = params.get('source') ?? '';

  const [openOnly, setOpenOnly] = useState('open');
  const [kind, setKind] = useState<string>('');
  const [preset, setPreset] = useState<PresetKey | 'custom'>('all');
  const [range, setRange] = useState<DateRange>(null);

  const filters =
    `${openOnly === 'open' ? '&resolved=false' : openOnly === 'done' ? '&resolved=true' : ''}` +
    `${kind ? `&kind=${kind}` : ''}` +
    `${source ? `&source=${source}` : ''}` +
    rangeQuery(range);

  const complaints = useInfiniteQuery({
    queryKey: ['complaints', 'list', openOnly, kind, range, source],
    queryFn: ({ pageParam }) =>
      api.get<Page>(`/owner/complaints?limit=${PAGE_SIZE}&page=${pageParam}${filters}`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.complaints.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });

  const rows = complaints.data?.pages.flatMap((page) => page.complaints) ?? [];
  const total = complaints.data?.pages[0]?.total ?? 0;

  return (
    <>
      <PageHeader
        title={t('complaint.title')}
        subtitle={`${formatNumber(total)} ${t('complaint.plural')}`}
        action={
          <Link href="/owner/reports/print/sources">
            <Button variant="outline" size="sm">
              <Store className="h-4 w-4" />
              {t('report.sources')}
            </Button>
          </Link>
        }
      />

      <DateRangeFilter
        className="mb-4"
        preset={preset}
        range={range}
        onChange={(nextPreset, nextRange) => {
          setPreset(nextPreset);
          setRange(nextRange);
        }}
      />

      <Toolbar>
        <Segmented
          label={t('app.status')}
          value={openOnly}
          onChange={setOpenOnly}
          options={[
            { value: 'open', label: t('complaint.open') },
            { value: 'done', label: t('complaint.resolved') },
            { value: 'all', label: t('complaint.all') },
          ]}
        />
        <ToolbarSpacer />
        <Segmented
          label={t('complaint.kind')}
          value={kind}
          onChange={setKind}
          options={KIND_FILTERS.map((one) => ({
            value: one.value,
            label: t(one.labelKey as Parameters<typeof t>[0]),
          }))}
        />
      </Toolbar>

      {complaints.isLoading && <ListSkeleton />}

      {complaints.isError && (
        <ErrorState
          onRetry={() => complaints.refetch()}
          isRetrying={complaints.isFetching}
          error={complaints.error}
        />
      )}

      {complaints.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={MessageSquareWarning}
          title={t('complaint.noneAll')}
          description={openOnly === 'open' ? t('complaint.resolved') : undefined}
        />
      )}

      {rows.length > 0 && (
        <>
          <ComplaintList complaints={rows} showOrder />

          <div className="mt-4 flex flex-col items-center gap-2">
            {complaints.hasNextPage ? (
              <Button
                variant="outline"
                full
                loading={complaints.isFetchingNextPage}
                onClick={() => complaints.fetchNextPage()}
                className="sm:w-auto"
              >
                {t('app.loadMore')}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{t('app.allLoaded')}</p>
            )}
            <p className="tabular text-xs text-muted-foreground">
              {rows.length} / {total}
            </p>
          </div>
        </>
      )}
    </>
  );
}
