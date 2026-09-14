'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, CreditCard, Inbox, Landmark, Wallet as WalletIcon } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useReadOnlyAccount } from '@/lib/session';
import { t, tLedgerKind } from '@/lib/i18n/bn';
import { formatMoney, formatSignedMoney, formatDateTime } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import type { Deposit, LedgerEntry, Paged, Wallet, Withdrawal } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  statusTone,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { PhoneField } from '@/components/ui/phone-field';
import { FileField } from '@/components/ui/file-field';
import { Modal } from '@/components/ui/modal';
import { SmsCreditsCard } from '@/components/sms-credits-card';
import { LoadMore } from '@/components/ui/load-more';

const METHODS = ['bkash', 'nagad', 'rocket', 'bank', 'cash'] as const;

const LEDGER_PAGE_SIZE = 30;
const REQUEST_PAGE_SIZE = 10;

export default function WalletPage() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // A deactivated account may still take its money out, and do nothing else.
  const readOnly = useReadOnlyAccount();

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.get<{ wallet: Wallet }>('/reseller/wallet'),
  });

  // The statement, newest first, a page at a time.
  const ledger = useInfiniteQuery({
    queryKey: ['ledger'],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'entries', LedgerEntry>>(
        `/reseller/wallet/ledger?limit=${LEDGER_PAGE_SIZE}&page=${pageParam}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.entries.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });
  const entries = ledger.data?.pages.flatMap((page) => page.entries) ?? [];
  const entryTotal = ledger.data?.pages[0]?.total ?? 0;
  const ledgerNextError = ledger.isFetchNextPageError ? ledger.error : null;

  // Both request histories only grow, so they page the same way the statement does.
  const deposits = useInfiniteQuery({
    queryKey: ['deposits'],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'deposits', Deposit>>(
        `/reseller/deposits?limit=${REQUEST_PAGE_SIZE}&page=${pageParam}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.deposits.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });
  const depositRows = deposits.data?.pages.flatMap((page) => page.deposits) ?? [];

  const withdrawals = useInfiniteQuery({
    queryKey: ['withdrawals'],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'withdrawals', Withdrawal>>(
        `/reseller/withdrawals?limit=${REQUEST_PAGE_SIZE}&page=${pageParam}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.withdrawals.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });
  const withdrawalRows = withdrawals.data?.pages.flatMap((page) => page.withdrawals) ?? [];

  const balance = wallet.data?.wallet.balance ?? 0;
  const owes = balance < 0;

  return (
    <>
      <PageHeader title={t('nav.wallet')} subtitle={t('wallet.negativeHelp')} />

      {wallet.isLoading && <StatSkeleton />}

      {wallet.isError && (
        <div className="mb-6">
          <ErrorState
          onRetry={() => wallet.refetch()}
          isRetrying={wallet.isFetching}
          error={wallet.error}
        />
        </div>
      )}

      {wallet.isSuccess && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Stat
            icon={WalletIcon}
            label={owes ? t('wallet.owed') : t('wallet.balance')}
            value={formatMoney(Math.abs(balance))}
            tone={owes ? 'danger' : 'success'}
          />
          <Stat
            icon={CreditCard}
            label={t('wallet.creditLimit')}
            value={formatMoney(wallet.data.wallet.creditLimit)}
          />
          <Stat
            icon={Landmark}
            tone="primary"
            label={t('wallet.available')}
            value={formatMoney(wallet.data.wallet.available)}
          />
        </div>
      )}

      {/*
       * The two actions were `sm` buttons tucked into the page header, which on a
       * phone put them in the top right corner at thirty-two pixels tall.
       */}
      <div className="mb-6 flex gap-2 [&>button]:flex-1">
        {!readOnly && (
          <Button onClick={() => setDepositOpen(true)}>
            <ArrowDownToLine className="h-4 w-4" />
            {t('wallet.depositRequest')}
          </Button>
        )}
        <Button variant="outline" onClick={() => setWithdrawOpen(true)}>
          <ArrowUpFromLine className="h-4 w-4" />
          {t('wallet.withdrawRequest')}
        </Button>
      </div>

      {/* Hidden unless the owner's SMS switch is on; it renders nothing otherwise. */}
      <SmsCreditsCard readOnly={readOnly} />

      <Card className="mb-6">
        <CardHeader title={t('wallet.ledger')} />

        {ledger.isLoading && <ListSkeleton rows={4} />}

        {ledger.isError && entries.length === 0 && (
          <ErrorState
          onRetry={() => ledger.refetch()}
          isRetrying={ledger.isFetching}
          error={ledger.error}
        />
        )}

        {ledger.isSuccess && entries.length === 0 && (
          <EmptyState icon={WalletIcon} title={t('wallet.noEntries')} />
        )}

        {entries.length > 0 && (
          <>
            {/*
             * A statement on a phone reads as a list, not a four column table
             * inside a sideways scroller. The movement is the headline and the
             * running balance the footnote, because that is the order people
             * check them in.
             */}
            <ul className="divide-y divide-border sm:hidden">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    {/*
                     * The kind, in Bengali, is the headline. The note is the
                     * server's own sentence and follows it where there is one.
                     */}
                    <p className="truncate text-sm">{tLedgerKind(entry.kind)}</p>
                    {entry.note && (
                      <p className="truncate text-xs text-muted-foreground">{entry.note}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`tabular font-medium ${
                        entry.amount < 0 ? 'text-danger' : 'text-success'
                      }`}
                    >
                      {formatSignedMoney(entry.amount)}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {formatMoney(entry.balanceAfter)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="scroll-x hidden sm:block">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr>
                    <Th>{t('app.date')}</Th>
                    <Th>{t('app.notes')}</Th>
                    <Th className="text-right">{t('wallet.amount')}</Th>
                    <Th className="text-right">{t('wallet.balance')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <Tr key={entry.id}>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </Td>
                      <Td>
                        <div>{tLedgerKind(entry.kind)}</div>
                        {entry.note && (
                          <div className="text-xs text-muted-foreground">{entry.note}</div>
                        )}
                      </Td>
                      <Td
                        className={`tabular text-right ${
                          entry.amount < 0 ? 'text-danger' : 'text-success'
                        }`}
                      >
                        {formatSignedMoney(entry.amount)}
                      </Td>
                      <Td className="tabular text-right">{formatMoney(entry.balanceAfter)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>

            <LoadMore
              hasMore={Boolean(ledger.hasNextPage)}
              loading={ledger.isFetchingNextPage}
              onLoadMore={() => ledger.fetchNextPage()}
              error={ledgerNextError}
              shown={entries.length}
              total={entryTotal}
            />
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <RequestList
          title={t('nav.deposits')}
          paging={{
            hasMore: Boolean(deposits.hasNextPage),
            loading: deposits.isFetchingNextPage,
            onLoadMore: () => deposits.fetchNextPage(),
            error: deposits.isFetchNextPageError ? deposits.error : null,
            total: deposits.data?.pages[0]?.total ?? 0,
          }}
          rows={depositRows.map((d) => ({
            id: d.id,
            amount: d.amount,
            method: d.method,
            status: d.status,
            createdAt: d.createdAt,
            note: d.rejectionReason,
          }))}
        />
        <RequestList
          title={t('nav.withdrawals')}
          paging={{
            hasMore: Boolean(withdrawals.hasNextPage),
            loading: withdrawals.isFetchingNextPage,
            onLoadMore: () => withdrawals.fetchNextPage(),
            error: withdrawals.isFetchNextPageError ? withdrawals.error : null,
            total: withdrawals.data?.pages[0]?.total ?? 0,
          }}
          rows={withdrawalRows.map((w) => ({
            id: w.id,
            amount: w.amount,
            method: w.method,
            status: w.status,
            createdAt: w.createdAt,
            note: w.rejectionReason,
          }))}
        />
      </div>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        maxAmount={Math.max(balance, 0)}
      />
    </>
  );
}

type RequestRow = {
  id: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
  note?: string;
};

/** The foot of a request history: where it is, and how to get the next page. */
type RequestPaging = {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  error: unknown;
  total: number;
};

function RequestList({
  title,
  rows,
  paging,
}: {
  title: string;
  rows: RequestRow[];
  paging: RequestPaging;
}) {
  const footer = (
    <LoadMore
      hasMore={paging.hasMore}
      loading={paging.loading}
      onLoadMore={paging.onLoadMore}
      error={paging.error}
      shown={rows.length}
      total={paging.total}
      compact
    />
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <EmptyState icon={Inbox} title={t('app.none')} />
      </Card>
    );
  }

  return (
    <>
      <Card className="sm:hidden">
        <CardHeader title={title} />
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="tabular font-medium">{formatMoney(row.amount)}</p>
                <p className="text-xs uppercase text-muted-foreground">{row.method}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
                {row.note && <p className="mt-1 text-xs text-danger">{row.note}</p>}
              </div>
              <Badge tone={statusTone(row.status)} dot>
                {row.status}
              </Badge>
            </li>
          ))}
        </ul>
        {footer}
      </Card>

      <div className="hidden sm:block">
        <TableWrap>
          <thead>
            <tr>
              <Th>{title}</Th>
              <Th>{t('wallet.method')}</Th>
              <Th className="text-right">{t('wallet.amount')}</Th>
              <Th>{t('app.status')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</Td>
                <Td className="uppercase">{row.method}</Td>
                <Td className="tabular text-right">{formatMoney(row.amount)}</Td>
                <Td>
                  <Badge tone={statusTone(row.status)} dot>
                  {row.status}
                </Badge>
                  {row.note && <div className="mt-1 text-xs text-danger">{row.note}</div>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
        {footer}
      </div>
    </>
  );
}

function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    amount: '',
    method: 'bkash',
    senderNumber: '',
    transactionId: '',
    note: '',
  });
  const [file, setFile] = useState<File | null>(null);

  const submit = useMutation({
    mutationFn: () => {
      // Multipart, because the payment screenshot goes up with the request.
      const data = new FormData();
      data.set('amount', form.amount);
      data.set('method', form.method);
      if (form.senderNumber) data.set('senderNumber', form.senderNumber);
      if (form.transactionId) data.set('transactionId', form.transactionId);
      if (form.note) data.set('note', form.note);
      if (file) data.set('screenshot', file);
      return api.upload('/reseller/deposits', data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['deposits'] });
      setForm({ amount: '', method: 'bkash', senderNumber: '', transactionId: '', note: '' });
      setFile(null);
      onClose();
      toast(t('wallet.depositSubmitted'));
    },
  });

  const errors = fieldErrors(submit.error);
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // A transaction id typed off a phone screen, or an attached screenshot, is not
  // something to discard because a thumb landed on the backdrop.
  const dirty = Boolean(
    form.amount || form.senderNumber || form.transactionId || form.note || file
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('wallet.depositRequest')}
      dirty={dirty}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={submit.isPending}
            disabled={!checkMoney(form.amount).ok}
            onClick={() => submit.mutate()}
          >
            {t('app.save')}
          </Button>
        </>
      }
    >
      {submit.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(submit.error)}</Alert>
      )}

      <Field
        label={t('wallet.amount')}
        htmlFor="amount"
        error={errors.amount ?? moneyError(form.amount)}
        required
      >
        <MoneyInput id="amount" value={form.amount} onChange={set('amount')} />
      </Field>

      <Field label={t('wallet.method')} htmlFor="method" error={errors.method}>
        <Select id="method" value={form.method} onChange={set('method')}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m.toUpperCase()}
            </option>
          ))}
        </Select>
      </Field>

      <PhoneField
        id="senderNumber"
        label={t('wallet.senderNumber')}
        value={form.senderNumber}
        onChange={(senderNumber) => setForm((prev) => ({ ...prev, senderNumber }))}
        error={errors.senderNumber}
        autoComplete="off"
      />

      <Field label={t('wallet.transactionId')} htmlFor="transactionId" error={errors.transactionId}>
        <Input id="transactionId" value={form.transactionId} onChange={set('transactionId')} />
      </Field>

      <div className="mb-4">
        <FileField
          id="screenshot"
          label={t('wallet.screenshot')}
          hint={t('app.optional')}
          value={file}
          onChange={setFile}
        />
      </div>

      <Field label={t('app.notes')} htmlFor="note" className="mb-0">
        <Textarea id="note" value={form.note} onChange={set('note')} rows={2} />
      </Field>
    </Modal>
  );
}

function WithdrawModal({
  open,
  onClose,
  maxAmount,
}: {
  open: boolean;
  onClose: () => void;
  maxAmount: number;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ amount: '', method: 'bkash', destinationNumber: '', note: '' });

  const submit = useMutation({
    mutationFn: (amount: number) =>
      api.post('/reseller/withdrawals', {
        amount,
        method: form.method,
        destinationNumber: form.destinationNumber,
        ...(form.note ? { note: form.note } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      setForm({ amount: '', method: 'bkash', destinationNumber: '', note: '' });
      onClose();
      toast(t('wallet.withdrawSubmitted'));
    },
  });

  const errors = fieldErrors(submit.error);
  // Never more than the balance: a withdrawal cannot create debt.
  const withdrawCheck = checkMoney(form.amount, { max: maxAmount });
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('wallet.withdrawRequest')}
      dirty={Boolean(form.amount || form.destinationNumber || form.note)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={submit.isPending}
            disabled={!withdrawCheck.ok}
            onClick={() => withdrawCheck.ok && submit.mutate(withdrawCheck.value)}
          >
            {t('app.save')}
          </Button>
        </>
      }
    >
      {submit.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(submit.error)}</Alert>
      )}

      <Field
        label={t('wallet.amount')}
        htmlFor="wamount"
        error={errors.amount ?? moneyError(form.amount, { max: maxAmount })}
        hint={`${t('wallet.available')} ${formatMoney(maxAmount)}`}
        required
      >
        <MoneyInput id="wamount" value={form.amount} onChange={set('amount')} max={maxAmount} />
      </Field>

      <Field label={t('wallet.method')} htmlFor="wmethod">
        <Select id="wmethod" value={form.method} onChange={set('method')}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m.toUpperCase()}
            </option>
          ))}
        </Select>
      </Field>

      <PhoneField
        id="destinationNumber"
        label={t('wallet.destinationNumber')}
        value={form.destinationNumber}
        onChange={(destinationNumber) => setForm((prev) => ({ ...prev, destinationNumber }))}
        error={errors.destinationNumber}
        autoComplete="off"
        required
        className="mb-0"
      />
    </Modal>
  );
}
