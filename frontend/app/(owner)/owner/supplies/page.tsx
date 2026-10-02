'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Archive, ArchiveRestore, Boxes, Plus, ShoppingCart, TriangleAlert } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tf, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUrlSearch, useUrlState } from '@/lib/use-url-state';
import type { Supply } from '@/lib/types';
import { useGetSuppliesQuery, useSetSupplyArchivedMutation } from '@/lib/store/endpoints/catalog';
import {
  Alert,
  Badge,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  Stat,
} from '@/components/ui/layout';
import { Td, Th, Tr, TableWrap } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Segmented, SearchInput, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { DownloadMenu } from '@/components/report/download-menu';
import { useToast } from '@/components/ui/toast';
import { SupplySheet } from './supply-sheet';

/**
 * মালামাল — everything bought to get a parcel out the door, and never sold.
 *
 * The list is deliberately short on numbers and long on state: what is running
 * out, and what has gone wrong. The arithmetic lives on the detail page, where
 * there is room to show the working. See `[id]/page.tsx` and `components/why.tsx`.
 */

type Filter = 'all' | 'low' | 'archived';

/** Quantities keep three decimals: a recipe of 1.375 sheets is a real number here. */
const QTY = new Intl.NumberFormat('bn-BD', { maximumFractionDigits: 3 });
const qty = (value: number, unit: string) => `${QTY.format(value)} ${tUnit(unit)}`;

export default function OwnerSuppliesPage() {
  const toast = useToast();
  const [filters, setFilters, { reset }] = useUrlState({ filter: 'all' });
  const search = useUrlSearch();
  const filter = (['all', 'low', 'archived'].includes(filters.filter) ? filters.filter : 'all') as Filter;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supply | null>(null);

  // `archivedOnly`, not `includeArchived`: the archived filter used to list every
  // live supply as well, so it looked like a filter that did nothing.
  const supplies = useGetSuppliesQuery({
    lowOnly: filter === 'low',
    archivedOnly: filter === 'archived',
    q: search.term,
  });
  const [setArchived, archiving] = useSetSupplyArchivedMutation();

  const rows = supplies.data?.supplies ?? [];
  const totals = supplies.data?.totals;
  const filtered = filter !== 'all' || search.term !== '';
  const negatives = rows.filter((supply) => supply.isNegative);

  const restore = async (supply: Supply) => {
    try {
      await setArchived({ id: supply.id, isArchived: false }).unwrap();
      toast(tf('supplies.restored', { name: supply.nameBn }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };
  const restoringId = archiving.isLoading ? archiving.originalArgs?.id : undefined;

  const clearFilters = () => {
    reset();
    search.setInput('');
  };

  return (
    <>
      <PageHeader
        title={t('supply.title')}
        subtitle={t('supply.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DownloadMenu range={null} only={['supplies']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('supply.new')}
            </Button>
          </div>
        }
      />

      {/*
        * The two states worth interrupting for, above the filters so they cannot
        * be missed while scrolled past. A gorbil is a bookkeeping error the owner
        * has to fix; running out is a shopping reminder, with the one tap that
        * shows what to buy.
        */}
      {filter !== 'archived' && totals && totals.negativeCount > 0 && (
        <Alert tone="danger" icon={TriangleAlert} title={t('supply.negative')}>
          <p>{t('supply.negativeHint')}</p>
          {negatives.length > 0 && (
            <p className="mt-2">
              {t('supplies.negativeWhich')}{' '}
              {negatives.map((supply, index) => (
                <span key={supply.id}>
                  {index > 0 && ', '}
                  <Link
                    href={`/owner/supplies/${supply.id}` as Route}
                    className="font-semibold underline underline-offset-2"
                  >
                    {supply.nameBn}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </Alert>
      )}
      {filter === 'all' && totals && totals.lowCount > 0 && (
        <Alert tone="warning" title={tf('supplies.lowBanner', { count: formatNumber(totals.lowCount) })}>
          <p>{t('supplies.reorderHint')}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setFilters({ filter: 'low' })}>
            {t('supplies.showLow')}
          </Button>
        </Alert>
      )}

      <Toolbar>
        <Segmented<Filter>
          label={t('supplies.filterLabel')}
          value={filter}
          onChange={(next) => setFilters({ filter: next })}
          options={[
            { value: 'all', label: t('app.all') },
            { value: 'low', label: t('supply.low'), count: totals?.lowCount },
            { value: 'archived', label: t('app.archived') },
          ]}
        />
        <ToolbarSpacer />
        <SearchInput
          value={search.input}
          onChange={search.setInput}
          placeholder={t('supply.name')}
          className="basis-full sm:basis-auto"
        />
      </Toolbar>

      {totals && rows.length > 0 && filter === 'all' && !search.term && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t('supply.itemCount')} value={formatNumber(totals.items)} icon={Boxes} />
          <Stat label={t('supply.value')} value={formatMoney(totals.value)} />
          <Stat
            label={t('supply.low')}
            value={formatNumber(totals.lowCount)}
            tone={totals.lowCount > 0 ? 'warning' : 'neutral'}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      )}

      {supplies.isLoading && <ListSkeleton rows={4} />}

      {supplies.isError && !supplies.data && (
        <ErrorState
          onRetry={() => supplies.refetch()}
          isRetrying={supplies.isFetching}
          error={supplies.error}
        />
      )}

      {/*
        * An empty screen teaches instead of shrugging. Somebody who has never
        * seen this feature needs to know what belongs here and what happens next,
        * with a real example from their own trade.
        */}
      {supplies.data && rows.length === 0 && !filtered && (
        <EmptyState
          icon={Boxes}
          title={t('supply.title')}
          description={t('costSetup.emptySupply')}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                {t('supply.new')}
              </Button>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t('costSetup.thenPurchase')} {t('costSetup.thenRecipe')}
              </p>
            </div>
          }
        />
      )}

      {supplies.data && rows.length === 0 && filter === 'archived' && !search.term && (
        <EmptyState icon={Archive} title={t('supplies.archivedEmpty')} description={t('supplies.archiveHint')} />
      )}

      {supplies.data && rows.length === 0 && filtered && !(filter === 'archived' && !search.term) && (
        <FilteredEmpty onClear={clearFilters} />
      )}

      {rows.length > 0 && (
        <div className={cn('transition-opacity', supplies.isFetching && 'opacity-60')}>
          {/* Phone: cards. Five columns in a sideways scroller hides the state
              badges, which are the reason to look at this list at all. */}
          <ul className="space-y-3 sm:hidden">
            {rows.map((supply) => (
              <li key={supply.id} className="card p-4">
                <Link href={`/owner/supplies/${supply.id}` as Route} className="block">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words font-semibold">{supply.nameBn}</span>
                    <span className="tabular whitespace-nowrap font-semibold">
                      {qty(supply.onHand, supply.unit)}
                    </span>
                  </div>
                  <div className="tabular mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>
                      {t('supply.avgCost')} {formatMoney(supply.avgCost)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {t('supply.value')} {formatMoney(supply.value)}
                    </span>
                  </div>
                  <StateBadges supply={supply} />
                </Link>
                <div className="mt-3 flex gap-2 [&>*]:flex-1">
                  {supply.isArchived ? (
                    <Button
                      variant="outline"
                      loading={restoringId === supply.id}
                      onClick={() => void restore(supply)}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      {t('app.restore')}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setEditing(supply)}>
                      {t('supply.edit')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <TableWrap from="sm" minWidth="40rem">
            <thead>
              <tr>
                <Th>{t('supply.name')}</Th>
                <Th className="text-right">{t('supply.onHand')}</Th>
                <Th className="text-right">{t('supply.avgCost')}</Th>
                <Th className="text-right">{t('supply.value')}</Th>
                <Th>{t('app.status')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((supply) => (
                <Tr key={supply.id}>
                  <Td>
                    <Link href={`/owner/supplies/${supply.id}` as Route} className="font-medium hover:underline">
                      {supply.nameBn}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{tUnit(supply.unit)}</span>
                  </Td>
                  <Td className="tabular text-right">{qty(supply.onHand, supply.unit)}</Td>
                  <Td className="tabular text-right">{formatMoney(supply.avgCost)}</Td>
                  <Td className="tabular text-right">{formatMoney(supply.value)}</Td>
                  <Td>
                    <StateBadges supply={supply} />
                  </Td>
                  <Td className="text-right">
                    {supply.isArchived ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={restoringId === supply.id}
                        onClick={() => void restore(supply)}
                      >
                        {t('app.restore')}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setEditing(supply)}>
                        {t('supply.edit')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          {/* Where the numbers above come from, for somebody wondering why a
              value is zero. */}
          <p className="mt-4 text-xs text-muted-foreground">
            {t('costSetup.thenPurchase')}{' '}
            <Link href="/owner/purchases" className="tap inline-flex items-center gap-1 font-semibold underline">
              <ShoppingCart className="h-3.5 w-3.5" />
              {t('costSetup.recordPurchase')}
            </Link>
          </p>
        </div>
      )}

      {(creating || editing) && (
        <SupplySheet
          key={editing?.id ?? 'new'}
          supply={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** What is wrong with this item, if anything. Nothing shown when it is fine. */
function StateBadges({ supply }: { supply: Supply }) {
  if (!supply.isNegative && !supply.isLow && !supply.isArchived) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {/* A gorbil outranks running low: one is a wrong number, the other is a
          correct number that happens to be small. */}
      {supply.isNegative && <Badge tone="danger">{t('supply.negative')}</Badge>}
      {!supply.isNegative && supply.isLow && <Badge tone="warning">{t('supply.low')}</Badge>}
      {supply.isArchived && <Badge tone="neutral">{t('app.archived')}</Badge>}
    </div>
  );
}
