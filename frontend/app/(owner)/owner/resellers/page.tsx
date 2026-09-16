'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, KeyRound, Store, TrendingDown, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tLedgerKind, type DictKey } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber, formatSignedMoney, formatDateTime } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import type { CursorPaged, KycStatus, LedgerEntry, Paged, ResellerSummary } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  ColumnToggle,
  EmptyState,
  ErrorState,
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
import { rangeOf } from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Segmented, SearchInput, SortSelect, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button, Spinner } from '@/components/ui/button';
import { Field, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/share';

type SortKey = 'shop' | 'person' | 'kyc' | 'balance' | 'limit';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'shop', label: t('auth.shopName'), locked: true },
  { key: 'person', label: t('auth.phone') },
  { key: 'kyc', label: t('kyc.title') },
  { key: 'balance', label: t('wallet.balance') },
  { key: 'limit', label: t('wallet.creditLimit') },
];

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

const PAGE_SIZE = 50;
const LEDGER_PAGE_SIZE = 50;

/** What the receivables report says, for the two money figures at the top. */
type Receivables = { totalOwed: number; resellers: { id: string; owed: number }[] };

/** The answer to PATCH /owner/resellers/:id. */
type ResellerUpdate = {
  reseller: { id: string; isActive: boolean | null; deactivatedAt: string | null };
  /** Codes of the pending orders a deactivation cancelled. See docs/adr/0011. */
  cancelledOrders: string[];
};

/** The reseller detail the list does not carry: channel preferences. */
type ResellerDetail = {
  reseller: ResellerSummary & { channelPrefs?: { sms?: boolean } };
};

export default function OwnerResellersPage() {
  const [managingId, setManagingId] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<'' | KycStatus>('');
  const [term, setTerm] = useState('');
  const search = useDebounced(term);

  /*
   * A page at a time, newest first, by cursor: a list that grows while it is
   * being read cannot skip or repeat a row that way.
   */
  const resellers = useInfiniteQuery({
    queryKey: ['owner', 'resellers', kycStatus],
    queryFn: ({ pageParam }) =>
      api.get<CursorPaged<'resellers', ResellerSummary>>(
        `/owner/resellers?limit=${PAGE_SIZE}` +
          `${kycStatus ? `&kycStatus=${kycStatus}` : ''}` +
          `${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  /*
   * The money figures come from the receivables report, which sums the ledger
   * across every reseller, rather than from whichever pages happen to be loaded.
   */
  const receivables = useQuery({
    queryKey: ['owner', 'receivables'],
    queryFn: () => api.get<Receivables>('/owner/reports/receivables'),
  });

  const all = resellers.data?.pages.flatMap((page) => page.resellers) ?? [];

  /*
   * Filtered here, over the loaded pages, rather than at the API: there is one
   * mango business and it has tens of resellers, so the first page is nearly
   * always all of them, and a round trip per keystroke would be slower.
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

  const debtorCount = receivables.data?.resellers.filter((row) => row.owed > 0).length;
  const owed = receivables.data?.totalOwed;

  // Looked up from the live list, so the sheet shows fresh numbers after a save.
  const managing = all.find((reseller) => reseller.id === managingId) ?? null;

  return (
    <>
      <PageHeader
        title={t('nav.resellers')}
        subtitle={t('wallet.negativeHelp')}
        /*
         * The two reports this screen raises the question for: who sold what,
         * and who owes what. Both default to the last thirty days, which is the
         * window a reseller conversation is usually about.
         */
        action={<DownloadMenu range={rangeOf('last30')} only={['resellers', 'due']} />}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={Users}
          tone="primary"
          label={t('nav.resellers')}
          value={resellers.hasNextPage ? `${all.length}+` : all.length}
        />
        <Stat
          icon={TrendingDown}
          label={t('dash.topDebtors')}
          value={debtorCount ?? '—'}
          tone={(debtorCount ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          icon={Store}
          label={t('owner.receivable')}
          value={owed == null ? '—' : formatMoney(owed)}
          tone={(owed ?? 0) > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Toolbar>
        <Segmented
          label={t('kyc.title')}
          value={kycStatus}
          onChange={setKycStatus}
          options={KYC_FILTERS}
        />
        <ToolbarSpacer />
        <SearchInput value={term} onChange={setTerm} placeholder={t('auth.shopName')} />
        <SortSelect
          value={sorting.sort?.key ?? ''}
          onChange={(key) => sorting.setSort(key ? { key, direction: 'asc' } : null)}
          options={COLUMNS.map((column) => ({ value: column.key, label: column.label }))}
        />
        <div className="hidden lg:block">
          <ColumnToggle columns={COLUMNS} isVisible={columns.isVisible} onToggle={columns.toggle} />
        </div>
      </Toolbar>

      {resellers.isLoading && <ListSkeleton />}

      {resellers.isError && all.length === 0 && (
        <ErrorState
          onRetry={() => resellers.refetch()}
          isRetrying={resellers.isFetching}
          error={resellers.error}
        />
      )}

      {resellers.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={Users}
          title={search || kycStatus ? t('app.noResults') : t('app.none')}
        />
      )}

      {rows.length > 0 && (
        <>
          {/* Cards on a phone; five columns and a button do not fit in 360px. */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {rows.map((reseller) => (
              <li key={reseller.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Person
                      name={reseller.shopName}
                      caption={reseller.user?.phoneE164}
                      size="sm"
                    />
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={statusTone(reseller.kycStatus)} dot>
                        {t(KYC_LABEL[reseller.kycStatus])}
                      </Badge>
                      {reseller.user && !reseller.user.isActive && (
                        <Badge tone="danger">{t('reseller.inactive')}</Badge>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p
                        className={`tabular text-lg font-bold ${
                          reseller.balance < 0 ? 'text-danger' : 'text-success'
                        }`}
                      >
                        {formatSignedMoney(reseller.balance)}
                      </p>
                      <p className="tabular text-xs text-muted-foreground">
                        {t('wallet.creditLimit')} {formatMoney(reseller.creditLimit)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setManagingId(reseller.id)}>
                      {t('reseller.manage')}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap from="lg">
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
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={statusTone(reseller.kycStatus)} dot>
                          {t(KYC_LABEL[reseller.kycStatus])}
                        </Badge>
                        {reseller.user && !reseller.user.isActive && (
                          <Badge tone="danger">{t('reseller.inactive')}</Badge>
                        )}
                      </div>
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
                    <Button size="sm" variant="outline" onClick={() => setManagingId(reseller.id)}>
                      {t('reseller.manage')}
                    </Button>
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
        </>
      )}

      {managing && (
        // Keyed by reseller, so the drafts inside start empty for each one.
        <ResellerModal key={managing.id} reseller={managing} onClose={() => setManagingId(null)} />
      )}
    </>
  );
}

function ResellerModal({
  reseller,
  onClose,
}: {
  reseller: ResellerSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creditLimit, setCreditLimit] = useState('');
  const [entry, setEntry] = useState({ amount: '', direction: 'credit', note: '' });
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  // What the last deactivation did to pending orders, shown until the sheet closes.
  const [cancelledOrders, setCancelledOrders] = useState<string[] | null>(null);

  const detail = useQuery({
    queryKey: ['owner', 'reseller', reseller.id],
    queryFn: () => api.get<ResellerDetail>(`/owner/resellers/${reseller.id}`),
  });

  const ledger = useInfiniteQuery({
    queryKey: ['owner', 'ledger', reseller.id],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'entries', LedgerEntry>>(
        `/owner/resellers/${reseller.id}/ledger?limit=${LEDGER_PAGE_SIZE}&page=${pageParam}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.entries.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });
  const entries = ledger.data?.pages.flatMap((page) => page.entries) ?? [];
  const ledgerNextError = ledger.isFetchNextPageError ? ledger.error : null;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['owner'] });
  };

  const limitCheck = checkMoney(creditLimit, { allowZero: true });
  const saveLimit = useMutation({
    mutationFn: (value: number) =>
      api.patch(`/owner/resellers/${reseller.id}`, { creditLimit: value }),
    onSuccess: async () => {
      await invalidate();
      setCreditLimit('');
      toast(t('app.saved'));
    },
  });

  /** Active and SMS go through the same endpoint, one field at a time. */
  const toggle = useMutation({
    mutationFn: (body: { isActive: boolean } | { smsEnabled: boolean }) =>
      api.patch<ResellerUpdate>(`/owner/resellers/${reseller.id}`, body),
    onSuccess: async (result, body) => {
      setConfirmingDeactivate(false);
      if ('isActive' in body) setCancelledOrders(body.isActive ? null : result.cancelledOrders);
      await invalidate();
      toast(t('app.saved'));
    },
  });

  /** An adjustment is a new entry, never an edit, so the reason is required. */
  const entryCheck = checkMoney(entry.amount);
  const postEntry = useMutation({
    mutationFn: (amount: number) =>
      api.post(`/owner/resellers/${reseller.id}/ledger`, {
        amount,
        direction: entry.direction,
        note: entry.note,
      }),
    onSuccess: async () => {
      await invalidate();
      setEntry({ amount: '', direction: 'credit', note: '' });
      toast(t('app.saved'));
    },
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api.get<{ ok: boolean; problems: string[] }>(`/owner/resellers/${reseller.id}/reconcile`),
  });

  const isActive = reseller.user?.isActive ?? true;
  const deactivatedAt = reseller.user?.deactivatedAt;
  const smsEnabled = detail.data?.reseller.channelPrefs?.sms ?? false;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={reseller.shopName}
      dirty={Boolean(creditLimit || entry.amount || entry.note)}
    >
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
        <h3 className="mb-2 text-sm font-bold">{t('reseller.account')}</h3>

        {toggle.error && <Alert tone="danger">{errorMessage(toggle.error)}</Alert>}

        <div className="divide-y divide-border">
          <Switch
            checked={isActive}
            disabled={toggle.isPending}
            onChange={(checked) => {
              // Turning a reseller off stops their shop; it asks first.
              if (!checked) setConfirmingDeactivate(true);
              else toggle.mutate({ isActive: true });
            }}
            label={t('reseller.active')}
            hint={
              isActive
                ? t('reseller.activeHint')
                : deactivatedAt
                  ? `${t('reseller.inactiveHint')} · ${t('reseller.deactivatedAt').replace('{at}', formatDateTime(deactivatedAt))}`
                  : t('reseller.inactiveHint')
            }
          />

          {cancelledOrders && (
            <div className="py-3">
              <Alert tone="neutral" icon={Ban} title={t('reseller.deactivatedResult')} className="mb-0">
                {cancelledOrders.length === 0 ? (
                  <p>{t('reseller.deactivatedNoPending')}</p>
                ) : (
                  <>
                    <p>
                      {t('reseller.deactivatedCancelled').replace(
                        '{n}',
                        formatNumber(cancelledOrders.length)
                      )}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {cancelledOrders.map((code) => (
                        <li key={code}>
                          <Badge tone="neutral">
                            <span className="tabular">{code}</span>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Alert>
            </div>
          )}

          {confirmingDeactivate && (
            <div role="alertdialog" aria-labelledby="deactivate-title" className="py-3">
              <Alert tone="warning" title={t('reseller.deactivateTitle')}>
                <span id="deactivate-title">{t('reseller.deactivateHelp')}</span>
              </Alert>
              <div className="flex gap-2 [&>button]:flex-1">
                <Button variant="outline" onClick={() => setConfirmingDeactivate(false)}>
                  {t('app.cancel')}
                </Button>
                <Button
                  variant="danger"
                  loading={toggle.isPending}
                  onClick={() => toggle.mutate({ isActive: false })}
                >
                  {t('reseller.deactivate')}
                </Button>
              </div>
            </div>
          )}

          {detail.isLoading ? (
            <div className="flex justify-center py-3">
              <Spinner />
            </div>
          ) : detail.isError ? (
            <p className="py-2 text-xs text-danger">{errorMessage(detail.error)}</p>
          ) : (
            <Switch
              checked={smsEnabled}
              disabled={toggle.isPending}
              onChange={(checked) => toggle.mutate({ smsEnabled: checked })}
              label={t('reseller.smsEnabled')}
              hint={t('reseller.smsEnabledHint')}
            />
          )}
        </div>

        <PasswordReset resellerId={reseller.id} />
      </section>

      <section className="mb-6 border-t border-border pt-5">
        <h3 className="mb-2 text-sm font-bold">{t('owner.creditLimit')}</h3>
        <Field
          htmlFor="creditLimit"
          error={moneyError(creditLimit, { allowZero: true })}
          className="mb-0"
        >
          <div className="flex gap-2">
            <MoneyInput
              id="creditLimit"
              className="flex-1"
              value={creditLimit}
              placeholder={formatMoneyPlain(reseller.creditLimit)}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
            <Button
              loading={saveLimit.isPending}
              disabled={!limitCheck.ok}
              onClick={() => limitCheck.ok && saveLimit.mutate(limitCheck.value)}
            >
              {t('app.save')}
            </Button>
          </div>
        </Field>
        {saveLimit.error && (
          <p className="mt-1 text-xs text-danger">{errorMessage(saveLimit.error)}</p>
        )}
      </section>

      <section className="mb-6 border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-bold">{t('owner.manualEntry')}</h3>

        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            label={t('wallet.amount')}
            htmlFor="amount"
            className="mb-2"
            error={moneyError(entry.amount)}
            required
          >
            <MoneyInput
              id="amount"
              value={entry.amount}
              onChange={(e) => setEntry((p) => ({ ...p, amount: e.target.value }))}
            />
          </Field>
          <Field label={t('ledger.direction')} htmlFor="direction" className="mb-2">
            <Select
              id="direction"
              value={entry.direction}
              onChange={(e) => setEntry((p) => ({ ...p, direction: e.target.value }))}
            >
              <option value="credit">{t('ledger.manualCredit')}</option>
              <option value="debit">{t('ledger.manualDebit')}</option>
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

        {postEntry.error && (
          <p className="mb-2 text-xs text-danger">{errorMessage(postEntry.error)}</p>
        )}

        <Button
          full
          loading={postEntry.isPending}
          disabled={!entryCheck.ok || entry.note.trim().length < 3}
          onClick={() => entryCheck.ok && postEntry.mutate(entryCheck.value)}
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
            {reconcile.data.ok ? t('reconcile.matched') : reconcile.data.problems.join('; ')}
          </Alert>
        )}
        {reconcile.error && <Alert tone="danger">{errorMessage(reconcile.error)}</Alert>}

        {ledger.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {ledger.isError && entries.length === 0 && (
          <ErrorState
            onRetry={() => ledger.refetch()}
            isRetrying={ledger.isFetching}
            error={ledger.error}
          />
        )}

        {ledger.isSuccess && entries.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('wallet.noEntries')}</p>
        )}

        {entries.length > 0 && (
          <>
            <div className="scroll-x max-h-72 overflow-y-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </Td>
                    <Td className="text-xs">
                      {/* The kind, in Bengali, leads; the server's note is English detail. */}
                      <div>{tLedgerKind(row.kind)}</div>
                      {row.note && <div className="text-muted-foreground">{row.note}</div>}
                    </Td>
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
            <LoadMore
              compact
              hasMore={Boolean(ledger.hasNextPage)}
              loading={ledger.isFetchingNextPage}
              onLoadMore={() => ledger.fetchNextPage()}
              error={ledgerNextError}
            />
          </>
        )}
      </section>
    </Modal>
  );
}

/**
 * The fallback for a reseller who cannot receive an SMS code (docs/adr/0014).
 *
 * Asks first, because it signs the reseller out everywhere. The temporary
 * password is shown once, here, and never again: the server keeps only its
 * hash, so closing the sheet without copying it means resetting again.
 */
function PasswordReset({ resellerId }: { resellerId: string }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const reset = useMutation({
    mutationFn: () =>
      api.post<{ temporaryPassword: string }>(`/owner/resellers/${resellerId}/password-reset`),
    onSuccess: () => setConfirming(false),
  });

  const temporary = reset.data?.temporaryPassword;

  return (
    <div className="border-t border-border pt-3">
      {reset.error && <Alert tone="danger">{errorMessage(reset.error)}</Alert>}

      {temporary ? (
        <Alert tone="success" title={t('reseller.temporaryPassword')} icon={KeyRound}>
          <div className="mt-2 flex items-center gap-2">
            <code className="tabular min-w-0 flex-1 select-all break-all rounded-lg bg-surface px-3 py-2 text-base font-semibold tracking-wider text-foreground">
              {temporary}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const copied = await copyText(temporary);
                toast(copied ? t('app.copied') : t('app.copyFailed'), copied ? 'success' : 'danger');
              }}
            >
              <Copy className="h-4 w-4" />
              {t('app.copy')}
            </Button>
          </div>
          <p className="mt-2 text-xs">{t('reseller.temporaryPasswordHelp')}</p>
        </Alert>
      ) : confirming ? (
        <div role="alertdialog" aria-labelledby="reset-password-title">
          <Alert tone="warning" title={t('reseller.resetPasswordTitle')}>
            <span id="reset-password-title">{t('reseller.resetPasswordHelp')}</span>
          </Alert>
          <div className="flex gap-2 [&>button]:flex-1">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('app.cancel')}
            </Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
              {t('reseller.resetPasswordConfirm')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('reseller.resetPassword')}</p>
            <p className="text-xs text-muted-foreground">{t('reseller.resetPasswordHint')}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            <KeyRound className="h-4 w-4" />
            {t('reseller.resetPassword')}
          </Button>
        </div>
      )}
    </div>
  );
}
