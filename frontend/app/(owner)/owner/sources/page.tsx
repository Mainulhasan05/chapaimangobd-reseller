'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Archive, ArchiveRestore, ClipboardList, Pencil, Plus, Store } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { useUrlSearch, useUrlState } from '@/lib/use-url-state';
import type { Source } from '@/lib/types';
import { useGetSourcesQuery } from '@/lib/store/endpoints/catalog';
import {
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  PhoneLink,
  RowMenu,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { SearchInput, Segmented, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { DownloadMenu } from '@/components/report/download-menu';
import { ArchiveSourceSheet, SourceSheet, useSourceArchive } from './source-sheet';

/**
 * Sources: the orchards and wholesalers the mangoes are collected from.
 *
 * A source is picked per order line when the owner accepts an order, and its
 * page is where a complaint about one parcel becomes a decision about the
 * orchard. Archived, never deleted, because old orders still name it.
 */
export default function OwnerSourcesPage() {
  const [filters, setFilters] = useUrlState({ view: 'live' });
  const search = useUrlSearch();
  const archivedView = filters.view === 'archived';

  // No argument for the live list: the same cache entry the accept sheet reads.
  const sources = useGetSourcesQuery(archivedView ? { archived: 'only' } : undefined);
  const { archive, restore, restoringId } = useSourceArchive();

  const [editing, setEditing] = useState<Source | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Source | null>(null);

  // `currentData`, not `data`: the archived view must never show the live list's
  // rows under its own buttons while it loads.
  const view = sources.currentData;
  const all = useMemo(() => view?.sources ?? [], [view]);
  const needle = search.term.trim().toLowerCase();
  const rows = useMemo(
    () =>
      needle
        ? all.filter((source) =>
            [source.name, source.address ?? '', source.phoneE164 ?? ''].some((field) =>
              field.toLowerCase().includes(needle)
            )
          )
        : all,
    [all, needle]
  );

  const href = (source: Source) => `/owner/sources/${source._id}` as Route;

  return (
    <>
      <PageHeader
        title={t('nav.sources')}
        subtitle={t('source.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Which orchard to stop buying from, as a sheet to take to market. */}
            <DownloadMenu range={null} only={['sources']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('sources.new')}
            </Button>
          </div>
        }
      />

      <Toolbar>
        <Segmented
          label={t('sources.filterLabel')}
          value={archivedView ? 'archived' : 'live'}
          onChange={(next) => setFilters({ view: next })}
          options={[
            { value: 'live', label: t('sources.viewLive') },
            { value: 'archived', label: t('app.archived') },
          ]}
        />
        <ToolbarSpacer />
        <SearchInput
          value={search.input}
          onChange={search.setInput}
          placeholder={t('sources.searchPlaceholder')}
          className="basis-full sm:basis-auto"
        />
      </Toolbar>

      {!view && !sources.isError && <ListSkeleton rows={3} />}

      {sources.isError && !view && (
        <ErrorState onRetry={() => sources.refetch()} isRetrying={sources.isFetching} error={sources.error} />
      )}

      {view && all.length === 0 && !archivedView && (
        <EmptyState
          icon={Store}
          title={t('sources.emptyTitle')}
          description={t('sources.emptyHelp')}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('sources.new')}
            </Button>
          }
        />
      )}

      {view && all.length === 0 && archivedView && (
        <EmptyState icon={Archive} title={t('sources.archivedEmpty')} />
      )}

      {all.length > 0 && rows.length === 0 && <FilteredEmpty onClear={() => search.setInput('')} />}

      {rows.length > 0 && (
        <div
          aria-busy={sources.isFetching}
          className={cn('transition-opacity', sources.isFetching && 'pointer-events-none opacity-60')}
        >
          <ul className="space-y-3 sm:hidden">
            {rows.map((source) => (
              <li key={source._id} className="card p-4">
                {/*
                 * The name is the way in to the orchard's record. That page is
                 * where a complaint about one parcel turns into a decision about
                 * everything else that came from the same place.
                 */}
                <Link href={href(source)} className="block min-h-11">
                  <span className="block break-words font-semibold text-primary-ink">{source.name}</span>
                  {source.address && (
                    <span className="mt-0.5 block text-sm text-muted-foreground">{source.address}</span>
                  )}
                </Link>
                {source.phoneE164 && <PhoneLink phone={source.phoneE164} className="text-sm" />}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {archivedView ? (
                    <Button
                      variant="outline"
                      className="col-span-2"
                      loading={restoringId === source._id}
                      onClick={() => void restore(source)}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      {t('app.restore')}
                    </Button>
                  ) : (
                    <>
                      <ButtonLink href={href(source)} variant="outline">
                        <ClipboardList className="h-4 w-4" />
                        {t('source.record')}
                      </ButtonLink>
                      <Button variant="outline" onClick={() => setEditing(source)}>
                        <Pencil className="h-4 w-4" />
                        {t('app.edit')}
                      </Button>
                      <Button
                        variant="quiet"
                        className="col-span-2 text-danger"
                        onClick={() => setArchiving(source)}
                      >
                        <Archive className="h-4 w-4" />
                        {t('app.archive')}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <TableWrap>
            <thead>
              <tr>
                <Th>{t('nav.sources')}</Th>
                <Th>{t('order.address')}</Th>
                <Th>{t('auth.phone')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((source) => (
                <Tr key={source._id}>
                  <Td className="font-medium">
                    <Link href={href(source)} className="rounded-md text-primary-ink hover:underline">
                      {source.name}
                    </Link>
                  </Td>
                  <Td className="text-sm text-muted-foreground">{source.address || '—'}</Td>
                  <Td className="text-sm">
                    {source.phoneE164 ? <PhoneLink phone={source.phoneE164} showIcon={false} /> : '—'}
                  </Td>
                  <Td className="text-right">
                    {archivedView ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={restoringId === source._id}
                        onClick={() => void restore(source)}
                      >
                        {t('app.restore')}
                      </Button>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <ButtonLink href={href(source)} size="sm" variant="outline">
                          {t('source.record')}
                        </ButtonLink>
                        <Button size="sm" variant="outline" onClick={() => setEditing(source)}>
                          {t('app.edit')}
                        </Button>
                        <RowMenu
                          label={source.name}
                          items={[
                            {
                              label: t('app.archive'),
                              icon: Archive,
                              tone: 'danger',
                              onSelect: () => setArchiving(source),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      {(creating || editing) && (
        <SourceSheet
          key={editing?._id ?? 'new'}
          source={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {archiving && (
        <ArchiveSourceSheet source={archiving} onClose={() => setArchiving(null)} onConfirm={archive} />
      )}
    </>
  );
}
