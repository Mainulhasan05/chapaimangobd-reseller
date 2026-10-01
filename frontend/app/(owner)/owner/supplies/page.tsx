'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, ShoppingCart, TriangleAlert } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import type { Supply } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
} from '@/components/ui/layout';
import { Td, Th, Tr, TableWrap } from '@/components/ui/table';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Button, Spinner } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { Segmented, SearchInput, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { DownloadMenu } from '@/components/report/download-menu';
import { useToast } from '@/components/ui/toast';

/**
 * মালামাল — everything bought to get a parcel out the door, and never sold.
 *
 * The list is deliberately short on numbers and long on state: what is running
 * out, and what has gone wrong. The arithmetic lives on the detail page, where
 * there is room to show the working. See `[id]/page.tsx` and `components/why.tsx`.
 */

const UNITS = ['pcs', 'sheet', 'roll', 'kg', 'gram', 'metre', 'packet', 'bundle', 'litre'];

type Filter = 'all' | 'low' | 'archived';

export default function OwnerSuppliesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supply | null>(null);

  const params = new URLSearchParams();
  if (filter === 'low') params.set('lowOnly', 'true');
  if (filter === 'archived') params.set('includeArchived', 'true');
  if (q) params.set('q', q);

  const supplies = useQuery({
    queryKey: ['owner', 'supplies', filter, q],
    queryFn: () =>
      api.get<{
        supplies: Supply[];
        totals: { items: number; value: number; lowCount: number; negativeCount: number };
      }>(`/owner/supplies${params.size ? `?${params}` : ''}`),
  });

  const rows = supplies.data?.supplies ?? [];
  const totals = supplies.data?.totals;

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
        * has to fix; running out is a shopping reminder.
        */}
      {totals && totals.negativeCount > 0 && (
        <Alert tone="danger" icon={TriangleAlert} title={t('supply.negative')}>
          {t('supply.negativeHint')}
        </Alert>
      )}
      {totals && totals.lowCount > 0 && totals.negativeCount === 0 && (
        <Alert tone="warning" title={t('supply.low')}>
          {t('supply.reorderHint')}
        </Alert>
      )}

      <Toolbar>
        <Segmented<Filter>
          label={t('supply.title')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('app.all') },
            { value: 'low', label: t('supply.low'), count: totals?.lowCount },
            { value: 'archived', label: t('supply.archived') },
          ]}
        />
        <ToolbarSpacer />
        <SearchInput value={search} onChange={setSearch} placeholder={t('supply.name')} />
      </Toolbar>

      {totals && rows.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat label={t('supply.itemCount')} value={formatNumber(totals.items)} icon={Boxes} />
          <Stat label={t('supply.value')} value={formatMoney(totals.value)} />
          <Stat
            label={t('supply.low')}
            value={formatNumber(totals.lowCount)}
            tone={totals.lowCount > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      {supplies.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {supplies.isError && (
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
      {supplies.isSuccess && rows.length === 0 && !q && filter === 'all' && (
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
              <p className="max-w-sm text-xs text-[var(--muted-fg)]">
                {t('costSetup.thenPurchase')} {t('costSetup.thenRecipe')}
              </p>
            </div>
          }
        />
      )}

      {supplies.isSuccess && rows.length === 0 && (q || filter !== 'all') && (
        <EmptyState icon={Boxes} title={t('app.none')} />
      )}

      {rows.length > 0 && (
        <>
          {/* Phone: cards. Five columns in a sideways scroller hides the state
              badges, which are the reason to look at this list at all. */}
          <ul className="space-y-3 sm:hidden">
            {rows.map((supply) => (
              <li key={supply.id}>
                <Card className="p-4">
                  <Link href={`/owner/supplies/${supply.id}`} className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{supply.nameBn}</span>
                      <span className="tabular whitespace-nowrap">
                        {formatNumber(supply.onHand)} {tUnit(supply.unit)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-fg)]">
                      <span>
                        {t('supply.avgCost')} {formatMoney(supply.avgCost)}
                      </span>
                      <span>·</span>
                      <span>
                        {t('supply.value')} {formatMoney(supply.value)}
                      </span>
                    </div>
                    <StateBadges supply={supply} />
                  </Link>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(supply)}>
                      {t('supply.edit')}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap from="sm" minWidth="40rem">
            <thead>
              <tr>
                <Th>{t('supply.name')}</Th>
                <Th align="right">{t('supply.onHand')}</Th>
                <Th align="right">{t('supply.avgCost')}</Th>
                <Th align="right">{t('supply.value')}</Th>
                <Th>{t('app.status')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((supply) => (
                <Tr key={supply.id}>
                  <Td>
                    <Link href={`/owner/supplies/${supply.id}`} className="font-medium hover:underline">
                      {supply.nameBn}
                    </Link>
                    <span className="block text-xs text-[var(--muted-fg)]">
                      {tUnit(supply.unit)}
                    </span>
                  </Td>
                  <Td align="right" className="tabular">
                    {formatNumber(supply.onHand)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(supply.avgCost)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(supply.value)}
                  </Td>
                  <Td>
                    <StateBadges supply={supply} />
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(supply)}>
                      {t('supply.edit')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          {/* Where the numbers above come from, for somebody wondering why a
              value is zero. */}
          <p className="mt-4 text-xs text-[var(--muted-fg)]">
            {t('costSetup.thenPurchase')}{' '}
            <Link href="/owner/purchases" className="inline-flex items-center gap-1 underline">
              <ShoppingCart className="h-3 w-3" />
              {t('costSetup.recordPurchase')}
            </Link>
          </p>
        </>
      )}

      {(creating || editing) && (
        <SupplyModal
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
    <div className="mt-1 flex flex-wrap gap-1.5">
      {/* A gorbil outranks running low: one is a wrong number, the other is a
          correct number that happens to be small. */}
      {supply.isNegative && <Badge tone="danger">{t('supply.negative')}</Badge>}
      {!supply.isNegative && supply.isLow && <Badge tone="warning">{t('supply.low')}</Badge>}
      {supply.isArchived && <Badge tone="neutral">{t('supply.archived')}</Badge>}
    </div>
  );
}

/**
 * Add or change one item.
 *
 * The unit is offered only when creating. Changing it afterwards would silently
 * restate every quantity ever recorded against this item, so the API refuses it
 * and this form does not pretend otherwise.
 */
function SupplyModal({ supply, onClose }: { supply: Supply | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [nameBn, setNameBn] = useState(supply?.nameBn ?? '');
  const [unit, setUnit] = useState(supply?.unit ?? 'pcs');
  // Empty, not '0'. A box pre-filled with a zero is a box the owner has to
  // clear before typing, and `Number('')` is 0 anyway when it is submitted.
  const [reorderLevel, setReorderLevel] = useState(
    supply && supply.reorderLevel > 0 ? formatMoneyPlain(supply.reorderLevel) : ''
  );
  const [note, setNote] = useState(supply?.note ?? '');
  const [isArchived, setIsArchived] = useState(Boolean(supply?.isArchived));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nameBn,
        reorderLevel: Number(reorderLevel) || 0,
        ...(note ? { note } : {}),
        ...(supply ? { isArchived } : { unit }),
      };
      return supply
        ? api.patch(`/owner/supplies/${supply.id}`, body)
        : api.post('/owner/supplies', body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'supplies'] });
      toast(t('app.saved'));
      onClose();
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <Modal
      open
      onClose={onClose}
      title={supply ? t('supply.edit') : t('supply.new')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={nameBn.trim().length < 2}
            onClick={() => save.mutate()}
          >
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field label={t('supply.name')} error={errors.nameBn} required>
        <Input
          value={nameBn}
          onChange={(e) => setNameBn(e.target.value)}
          placeholder="ক্যারেট"
          autoFocus
        />
      </Field>

      {!supply && (
        <Field label={t('supply.unit')} error={errors.unit} required>
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {tUnit(u)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label={t('supply.reorderLevel')}
        hint={t('supply.reorderHint')}
        error={errors.reorderLevel}
      >
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.001"
          value={reorderLevel}
          onChange={(e) => setReorderLevel(e.target.value)}
          className="tabular"
        />
      </Field>

      <Field label={t('expense.note')} error={errors.note}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>

      {supply && (
        <Switch
          checked={isArchived}
          onChange={setIsArchived}
          label={t('supply.archived')}
          hint={t('supply.help')}
        />
      )}
    </Modal>
  );
}
