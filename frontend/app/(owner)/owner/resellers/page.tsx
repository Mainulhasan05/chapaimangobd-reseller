'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Store, TrendingDown, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatSignedMoney, formatDateTime } from '@/lib/format';
import type { LedgerEntry, ResellerSummary } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  ColumnToggle,
  EmptyState,
  PageHeader,
  Person,
  SortTh,
  Stat,
  statusTone,
  TableWrap,
  Td,
  Th,
  Tr,
  useColumns,
  useSort,
  type ColumnDef,
} from '@/components/ui/layout';
import { SearchInput, SortSelect, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button, Spinner } from '@/components/ui/button';
import { Field, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

type SortKey = 'shop' | 'person' | 'kyc' | 'balance' | 'limit';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'shop', label: t('auth.shopName'), locked: true },
  { key: 'person', label: t('auth.phone') },
  { key: 'kyc', label: t('kyc.title') },
  { key: 'balance', label: t('wallet.balance') },
  { key: 'limit', label: t('wallet.creditLimit') },
];

export default function OwnerResellersPage() {
  const [managing, setManaging] = useState<ResellerSummary | null>(null);
  const [term, setTerm] = useState('');
  const search = useDebounced(term);

  const resellers = useQuery({
    queryKey: ['owner', 'resellers'],
    queryFn: () => api.get<{ resellers: ResellerSummary[] }>('/owner/resellers'),
  });

  const all = resellers.data?.resellers ?? [];

  /*
   * Filtered here rather than at the API, because this endpoint returns every
   * reseller in one response: there is one mango business and it has tens of
   * these, not thousands. A round trip per keystroke would be slower than the
   * scan and would need a debounce to be usable at all.
   */
  const needle = search.trim().toLowerCase();
  const matched = needle
    ? all.filter((reseller) =>
        [reseller.shopName, reseller.slug, reseller.user?.name, reseller.user?.phoneE164]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle))
      )
    : all;

  const sorting = useSort<ResellerSummary, SortKey>(matched, {
    shop: (reseller) => reseller.shopName,
    person: (reseller) => reseller.user?.name ?? '',
    kyc: (reseller) => reseller.kycStatus,
    balance: (reseller) => reseller.balance,
    limit: (reseller) => reseller.creditLimit,
  });

  const rows = sorting.rows;
  const columns = useColumns(COLUMNS, 'owner-resellers');

  const debtors = all.filter((reseller) => reseller.balance < 0);
  const owed = debtors.reduce((sum, reseller) => sum + Math.abs(reseller.balance), 0);

  return (
    <>
      <PageHeader title={t('nav.resellers')} subtitle={t('wallet.negativeHelp')} />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat icon={Users} tone="primary" label={t('nav.resellers')} value={all.length} />
        <Stat
          icon={TrendingDown}
          label={t('dash.topDebtors')}
          value={debtors.length}
          tone={debtors.length > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          icon={Store}
          label={t('owner.receivable')}
          value={formatMoney(owed)}
          tone={owed > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Toolbar>
        <ToolbarSpacer />
        <SearchInput value={term} onChange={setTerm} placeholder={t('auth.shopName')} />
        <SortSelect
          value={sorting.sort?.key ?? ''}
          onChange={(key) => sorting.setSort(key ? { key, direction: 'asc' } : null)}
          options={COLUMNS.map((column) => ({ value: column.key, label: column.label }))}
        />
        <div className="hidden sm:block">
          <ColumnToggle columns={COLUMNS} isVisible={columns.isVisible} onToggle={columns.toggle} />
        </div>
      </Toolbar>

      {resellers.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {resellers.isSuccess && rows.length === 0 && (
        <EmptyState icon={Users} title={search ? t('app.noResults') : t('app.none')} />
      )}

      {rows.length > 0 && (
        <TableWrap alwaysVisible>
          <thead>
            <tr>
              {columns.isVisible('shop') && (
                <SortTh column="shop" sort={sorting.sort} onSort={sorting.toggle}>
                  {t('auth.shopName')}
                </SortTh>
              )}
              {columns.isVisible('person') && (
                <SortTh column="person" sort={sorting.sort} onSort={sorting.toggle}>
                  {t('auth.phone')}
                </SortTh>
              )}
              {columns.isVisible('kyc') && (
                <SortTh column="kyc" sort={sorting.sort} onSort={sorting.toggle}>
                  {t('kyc.title')}
                </SortTh>
              )}
              {columns.isVisible('balance') && (
                <SortTh column="balance" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('wallet.balance')}
                </SortTh>
              )}
              {columns.isVisible('limit') && (
                <SortTh column="limit" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('wallet.creditLimit')}
                </SortTh>
              )}
              <Th className="w-28 text-right">{t('app.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((reseller) => (
              <Tr key={reseller.id}>
                {columns.isVisible('shop') && (
                  <Td>
                    <Person name={reseller.shopName} caption={`/r/${reseller.slug}`} size="sm" />
                  </Td>
                )}

                {columns.isVisible('person') && (
                  <Td>
                    <div className="text-sm font-medium">{reseller.user?.name}</div>
                    <div className="tabular text-xs text-muted-foreground">
                      {reseller.user?.phoneE164}
                    </div>
                  </Td>
                )}

                {columns.isVisible('kyc') && (
                  <Td>
                    <Badge tone={statusTone(reseller.kycStatus)} dot>
                      {reseller.kycStatus}
                    </Badge>
                  </Td>
                )}

                {columns.isVisible('balance') && (
                  <Td
                    className={`tabular text-right font-semibold ${
                      reseller.balance < 0 ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {formatSignedMoney(reseller.balance)}
                  </Td>
                )}

                {columns.isVisible('limit') && (
                  <Td className="tabular text-right">{formatMoney(reseller.creditLimit)}</Td>
                )}

                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setManaging(reseller)}>
                    {t('app.actions')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <ResellerModal reseller={managing} onClose={() => setManaging(null)} />
    </>
  );
}

function ResellerModal({
  reseller,
  onClose,
}: {
  reseller: ResellerSummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [creditLimit, setCreditLimit] = useState('');
  const [entry, setEntry] = useState({ amount: '', direction: 'credit', note: '' });

  const ledger = useQuery({
    queryKey: ['owner', 'ledger', reseller?.id],
    queryFn: () => api.get<{ entries: LedgerEntry[] }>(`/owner/resellers/${reseller!.id}/ledger`),
    enabled: Boolean(reseller),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['owner'] });
  };

  const saveLimit = useMutation({
    mutationFn: () =>
      api.patch(`/owner/resellers/${reseller!.id}`, { creditLimit: Number(creditLimit) }),
    onSuccess: invalidate,
  });

  /** An adjustment is a new entry, never an edit, so the reason is required. */
  const postEntry = useMutation({
    mutationFn: () =>
      api.post(`/owner/resellers/${reseller!.id}/ledger`, {
        amount: Number(entry.amount),
        direction: entry.direction,
        note: entry.note,
      }),
    onSuccess: async () => {
      await invalidate();
      setEntry({ amount: '', direction: 'credit', note: '' });
    },
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api.get<{ ok: boolean; problems: string[] }>(`/owner/resellers/${reseller!.id}/reconcile`),
  });

  if (!reseller) return null;

  return (
    <Modal open wide onClose={onClose} title={reseller.shopName}>
      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border-2 border-border bg-muted p-3">
          <div className="text-xs font-semibold text-muted-foreground">{t('wallet.balance')}</div>
          <div
            className={`tabular mt-1 text-2xl font-bold leading-tight ${
              reseller.balance < 0 ? 'text-danger' : 'text-success'
            }`}
          >
            {formatSignedMoney(reseller.balance)}
          </div>
        </div>
        <div className="rounded-lg border-2 border-border bg-muted p-3">
          <div className="text-xs font-semibold text-muted-foreground">
            {t('wallet.creditLimit')}
          </div>
          <div className="tabular mt-1 text-2xl font-bold leading-tight">
            {formatMoney(reseller.creditLimit)}
          </div>
        </div>
      </div>

      <section className="mb-6 border-t border-border pt-5">
        <h3 className="mb-2 text-sm font-bold">{t('owner.creditLimit')}</h3>
        <div className="flex gap-2">
          <MoneyInput
            value={creditLimit}
            placeholder={formatMoneyPlain(reseller.creditLimit)}
            onChange={(e) => setCreditLimit(e.target.value)}
          />
          <Button
            loading={saveLimit.isPending}
            disabled={!creditLimit}
            onClick={() => saveLimit.mutate()}
          >
            {t('app.save')}
          </Button>
        </div>
        {saveLimit.error && <p className="mt-1 text-xs text-danger">{errorMessage(saveLimit.error)}</p>}
      </section>

      <section className="mb-6 border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-bold">{t('owner.manualEntry')}</h3>

        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t('wallet.amount')} htmlFor="amount" className="mb-2">
            <MoneyInput
              id="amount"
              value={entry.amount}
              onChange={(e) => setEntry((p) => ({ ...p, amount: e.target.value }))}
            />
          </Field>
          <Field label={t('app.actions')} htmlFor="direction" className="mb-2">
            <Select
              id="direction"
              value={entry.direction}
              onChange={(e) => setEntry((p) => ({ ...p, direction: e.target.value }))}
            >
              <option value="credit">{t('wallet.depositRequest')}</option>
              <option value="debit">{t('wallet.withdrawRequest')}</option>
            </Select>
          </Field>
        </div>

        <Field label={t('app.notes')} htmlFor="note" required className="mb-2">
          <Textarea
            id="note"
            rows={2}
            value={entry.note}
            onChange={(e) => setEntry((p) => ({ ...p, note: e.target.value }))}
          />
        </Field>

        {postEntry.error && <p className="mb-2 text-xs text-danger">{errorMessage(postEntry.error)}</p>}

        <Button
          full
          loading={postEntry.isPending}
          disabled={!entry.amount || entry.note.trim().length < 3}
          onClick={() => postEntry.mutate()}
        >
          {t('app.save')}
        </Button>
      </section>

      <section className="mb-5 border-t border-border pt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">{t('wallet.ledger')}</h3>
          {/* Was a ghost button, which is indistinguishable from a caption. */}
          <Button
            size="sm"
            variant="outline"
            loading={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            {t('owner.reconcile')}
          </Button>
        </div>

        {reconcile.data && (
          <Alert tone={reconcile.data.ok ? 'success' : 'danger'}>
            {reconcile.data.ok ? 'হিসাব মিলেছে' : reconcile.data.problems.join('; ')}
          </Alert>
        )}

        <div className="scroll-x max-h-64 overflow-y-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <tbody>
              {ledger.data?.entries.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </Td>
                  <Td className="text-xs">{row.note ?? row.kind}</Td>
                  <Td
                    className={`tabular text-right ${row.amount < 0 ? 'text-danger' : 'text-success'}`}
                  >
                    {formatSignedMoney(row.amount)}
                  </Td>
                  <Td className="tabular text-right">{formatMoney(row.balanceAfter)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Modal>
  );
}
