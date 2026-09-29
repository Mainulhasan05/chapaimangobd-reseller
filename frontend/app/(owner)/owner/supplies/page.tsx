'use client';

/**
 * What the business buys and uses up.
 *
 * Not the catalogue. A ক্যারেট is bought, carried, filled and thrown away, and it
 * never appears on a customer's order — see docs/adr/0022. The list exists to
 * answer two questions in one glance: what is about to run out, and what the
 * shelf is worth.
 *
 * The one row that is not a number to read but a job to do is a negative count.
 * More was consumed than was ever recorded bought, which means the book is wrong
 * and only a physical count fixes it, so it is a loud badge with its own hint
 * rather than a minus sign in a column of figures.
 */

import Link from 'next/link';
import type { Route } from 'next';

import { useState } from 'react';
import { Boxes, Plus, TriangleAlert, Wallet } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import type { Supply } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { DownloadMenu } from '@/components/report/download-menu';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Segmented, SearchInput, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';

/**
 * The units a supply is counted in. The value is the domain unit the server
 * validates against; only the label is Bengali. The back half of the list is
 * here for exactly this screen: paper comes in sheets and tape in rolls, and a
 * stock line reading "৩ পিস কাগজ" is what having one list of units prevents.
 */
const UNITS = [
  'pcs',
  'box',
  'sheet',
  'roll',
  'metre',
  'packet',
  'bundle',
  'kg',
  'gram',
  'litre',
  'dozen',
] as const;

/** What the list route answers with. */
type SupplyList = {
  supplies: Supply[];
  totals: { items: number; value: number; lowCount: number; negativeCount: number };
};

/*
 * Three filters rather than two switches. "Low only" and "include archived" are
 * never both wanted, and a row of toggles on a 360px screen wraps to two lines
 * above the list it filters.
 */
type Filter = 'all' | 'low' | 'archived';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: t('app.all') },
  { value: 'low', label: t('supply.low') },
  { value: 'archived', label: t('supply.archived') },
];

export default function OwnerSuppliesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Supply | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term);

  const params = new URLSearchParams({
    includeArchived: String(filter === 'archived'),
    lowOnly: String(filter === 'low'),
  });
  if (search.trim()) params.set('q', search.trim());

  const supplies = useQuery({
    queryKey: ['owner', 'supplies', filter, search.trim()],
    queryFn: () => api.get<SupplyList>(`/owner/supplies?${params.toString()}`),
  });

  // Archived, never deleted: last week's movements and purchases still name it.
  const archive = useMutation({
    mutationFn: (id: string) => api.del(`/owner/supplies/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'supplies'] }),
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
            {/* The shelf as a sheet to carry while counting it. */}
            <DownloadMenu range={null} only={['supplies']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('supply.new')}
            </Button>
          </div>
        }
      />

      {archive.isError && <Alert tone="danger">{errorMessage(archive.error)}</Alert>}

      <Toolbar>
        <Segmented
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label={t('app.filter')}
        />
        <ToolbarSpacer />
        <SearchInput value={term} onChange={setTerm} placeholder={t('supply.name')} />
      </Toolbar>

      {totals && (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={Boxes}
            tone="primary"
            label={t('supply.itemCount')}
            value={formatNumber(totals.items)}
          />
          <Stat icon={Wallet} label={t('supply.value')} value={formatMoney(totals.value)} />
          <Stat
            icon={TriangleAlert}
            label={t('supply.low')}
            value={formatNumber(totals.lowCount)}
            tone={totals.lowCount > 0 ? 'warning' : 'neutral'}
          />
          {/*
           * The figure the owner is meant to act on, so it says what to do about
           * it rather than sitting there as a count.
           */}
          <Stat
            icon={TriangleAlert}
            label={t('supply.negative')}
            value={formatNumber(totals.negativeCount)}
            hint={totals.negativeCount > 0 ? t('supply.negativeHint') : undefined}
            tone={totals.negativeCount > 0 ? 'danger' : 'neutral'}
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

      {supplies.data && rows.length === 0 && (
        <EmptyState
          icon={Boxes}
          title={search.trim() ? t('app.noResults') : t('app.none')}
          description={search.trim() ? undefined : t('supply.help')}
        />
      )}

      {rows.length > 0 && (
        <>
          {/* Below `sm` the row is a card: five columns across 360px is a
            * sideways scroll, and the count is the thing being read. */}
          <ul className="space-y-3 sm:hidden">
            {rows.map((supply) => (
              <li key={supply.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/owner/supplies/${supply.id}` as Route}
                        className="block truncate font-medium text-primary-ink hover:underline"
                      >
                        {supply.nameBn}
                      </Link>
                      <p className="text-xs text-muted-foreground">{tUnit(supply.unit)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={
                          supply.isNegative
                            ? 'tabular text-xl font-bold text-danger-ink'
                            : 'tabular text-xl font-bold'
                        }
                      >
                        {formatNumber(supply.onHand)}
                      </p>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatMoney(supply.value)}
                      </p>
                    </div>
                  </div>

                  <SupplyBadges supply={supply} className="mt-3" />

                  {supply.isNegative && (
                    <p className="mt-2 text-xs font-medium text-danger-ink">
                      {t('supply.negativeHint')}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3 [&>*]:flex-1">
                    <Link href={`/owner/supplies/${supply.id}` as Route}>
                      <Button size="sm" variant="outline" full>
                        {t('supply.movements')}
                      </Button>
                    </Link>
                    <Button size="sm" variant="outline" onClick={() => setEditing(supply)}>
                      {t('app.edit')}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap from="sm" minWidth="48rem">
            <thead>
              <tr>
                <Th>{t('supply.name')}</Th>
                <Th>{t('supply.unit')}</Th>
                <Th className="text-right">{t('supply.onHand')}</Th>
                <Th className="text-right">{t('supply.avgCost')}</Th>
                <Th className="text-right">{t('supply.value')}</Th>
                <Th>{t('app.status')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((supply) => (
                <Tr key={supply.id}>
                  <Td className="font-medium">
                    <Link
                      href={`/owner/supplies/${supply.id}` as Route}
                      className="rounded-md text-primary-ink hover:underline"
                    >
                      {supply.nameBn}
                    </Link>
                  </Td>
                  <Td className="text-sm text-muted-foreground">{tUnit(supply.unit)}</Td>
                  <Td
                    className={
                      supply.isNegative
                        ? 'tabular text-right font-bold text-danger-ink'
                        : 'tabular text-right'
                    }
                  >
                    {formatNumber(supply.onHand)}
                  </Td>
                  <Td className="tabular text-right">{formatMoney(supply.avgCost)}</Td>
                  <Td className="tabular text-right">{formatMoney(supply.value)}</Td>
                  <Td>
                    <SupplyBadges supply={supply} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(supply)}>
                        {t('app.edit')}
                      </Button>
                      {!supply.isArchived && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => archive.mutate(supply.id)}
                          loading={archive.isPending && archive.variables === supply.id}
                        >
                          {t('app.close')}
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
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

/**
 * The three things a count can be, in the order they matter.
 *
 * A negative count outranks a low one: being below the reorder level is a
 * shopping list, and being below zero is a bookkeeping error.
 */
function SupplyBadges({ supply, className }: { supply: Supply; className?: string }) {
  if (!supply.isNegative && !supply.isLow && !supply.isArchived) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className={className ? `flex flex-wrap gap-1.5 ${className}` : 'flex flex-wrap gap-1.5'}>
      {supply.isNegative && (
        <Badge tone="danger" dot>
          {t('supply.negative')}
        </Badge>
      )}
      {supply.isLow && !supply.isNegative && (
        <Badge tone="warning" dot>
          {t('supply.low')}
        </Badge>
      )}
      {supply.isArchived && <Badge tone="neutral">{t('supply.archived')}</Badge>}
    </div>
  );
}

type Draft = { nameBn: string; unit: string; note: string; reorderLevel: string };

const blank: Draft = { nameBn: '', unit: 'pcs', note: '', reorderLevel: '' };

function SupplyModal({ supply, onClose }: { supply: Supply | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(
    supply
      ? {
          nameBn: supply.nameBn,
          unit: supply.unit,
          note: supply.note ?? '',
          // Seeded in Latin digits, because the value is parsed back with Number.
          reorderLevel: supply.reorderLevel ? formatMoneyPlain(supply.reorderLevel) : '',
        }
      : blank
  );
  const [isArchived, setIsArchived] = useState(supply?.isArchived ?? false);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nameBn: draft.nameBn,
        note: draft.note,
        ...(draft.reorderLevel.trim() ? { reorderLevel: Number(draft.reorderLevel) } : {}),
        // The unit is fixed at creation: every movement ever written is a
        // quantity in it, and changing it would silently rewrite all of them.
        ...(supply ? { isArchived } : { unit: draft.unit }),
      };

      return supply
        ? api.patch(`/owner/supplies/${supply.id}`, body)
        : api.post('/owner/supplies', body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'supplies'] });
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const levelError = errors.reorderLevel ?? moneyError(draft.reorderLevel, { allowZero: true });

  // Zero is a real answer here — it turns the warning off — so the gate allows it.
  const levelOk =
    !draft.reorderLevel.trim() || checkMoney(draft.reorderLevel, { allowZero: true }).ok;

  return (
    <Modal
      open
      onClose={onClose}
      dirty={draft.nameBn.trim() !== (supply?.nameBn ?? '')}
      title={supply ? t('supply.edit') : t('supply.new')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!draft.nameBn.trim() || !levelOk}
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

      <Field label={t('supply.name')} htmlFor="nameBn" error={errors.nameBn} required>
        <Input
          id="nameBn"
          value={draft.nameBn}
          onChange={(e) => setDraft((prev) => ({ ...prev, nameBn: e.target.value }))}
          autoFocus
        />
      </Field>

      {/* Offered on creation only. The API refuses it afterwards, so a box that
        * looked editable and was not would be a worse answer than no box. */}
      {!supply && (
        <Field label={t('supply.unit')} htmlFor="unit" error={errors.unit} required>
          <Select
            id="unit"
            value={draft.unit}
            onChange={(e) => setDraft((prev) => ({ ...prev, unit: e.target.value }))}
          >
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {tUnit(unit)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label={t('supply.reorderLevel')}
        htmlFor="reorderLevel"
        hint={t('supply.reorderHint')}
        error={levelError}
      >
        <Input
          id="reorderLevel"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          className="tabular"
          trailing={<span className="text-sm text-muted-foreground">{tUnit(draft.unit)}</span>}
          value={draft.reorderLevel}
          onChange={(e) => setDraft((prev) => ({ ...prev, reorderLevel: e.target.value }))}
        />
      </Field>

      <Field label={t('app.notes')} htmlFor="note" hint={t('app.optional')} error={errors.note}>
        <Textarea
          id="note"
          rows={2}
          value={draft.note}
          onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
        />
      </Field>

      {supply && (
        <Switch checked={isArchived} onChange={setIsArchived} label={t('supply.archived')} />
      )}
    </Modal>
  );
}
