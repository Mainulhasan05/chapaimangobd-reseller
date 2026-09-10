'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatSignedMoney, formatDateTime } from '@/lib/format';
import type { Deposit, LedgerEntry, Wallet, Withdrawal } from '@/lib/types';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  statusTone,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/layout';

const METHODS = ['bkash', 'nagad', 'rocket', 'bank', 'cash'] as const;

export default function WalletPage() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.get<{ wallet: Wallet }>('/reseller/wallet'),
  });

  const ledger = useQuery({
    queryKey: ['ledger'],
    queryFn: () => api.get<{ entries: LedgerEntry[] }>('/reseller/wallet/ledger?limit=50'),
  });

  const deposits = useQuery({
    queryKey: ['deposits'],
    queryFn: () => api.get<{ deposits: Deposit[] }>('/reseller/deposits'),
  });

  const withdrawals = useQuery({
    queryKey: ['withdrawals'],
    queryFn: () => api.get<{ withdrawals: Withdrawal[] }>('/reseller/withdrawals'),
  });

  const balance = wallet.data?.wallet.balance ?? 0;
  const owes = balance < 0;

  return (
    <>
      <PageHeader
        title={t('nav.wallet')}
        subtitle={t('wallet.negativeHelp')}
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setDepositOpen(true)}>
              {t('wallet.depositRequest')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWithdrawOpen(true)}>
              {t('wallet.withdrawRequest')}
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label={owes ? t('wallet.owed') : t('wallet.balance')}
          value={formatMoney(Math.abs(balance))}
          tone={owes ? 'danger' : 'success'}
        />
        <Stat label={t('wallet.creditLimit')} value={formatMoney(wallet.data?.wallet.creditLimit ?? 0)} />
        <Stat label={t('wallet.available')} value={formatMoney(wallet.data?.wallet.available ?? 0)} />
      </div>

      <Card className="mb-6">
        <CardHeader title={t('wallet.ledger')} />
        {ledger.data?.entries.length === 0 ? (
          <EmptyState title={t('wallet.noEntries')} />
        ) : (
          <div className="scroll-x">
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
                {ledger.data?.entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </Td>
                    <Td>
                      <div>{entry.note ?? entry.kind}</div>
                      <div className="text-xs text-muted-foreground">{entry.kind}</div>
                    </Td>
                    <Td
                      className={`tabular text-right ${
                        entry.amount < 0 ? 'text-danger' : 'text-success'
                      }`}
                    >
                      {formatSignedMoney(entry.amount)}
                    </Td>
                    <Td className="tabular text-right">{formatMoney(entry.balanceAfter)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <RequestList
          title={t('nav.deposits')}
          rows={(deposits.data?.deposits ?? []).map((d) => ({
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
          rows={(withdrawals.data?.withdrawals ?? []).map((w) => ({
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

function RequestList({ title, rows }: { title: string; rows: RequestRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <EmptyState title={t('app.none')} />
      </Card>
    );
  }

  return (
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
          <tr key={row.id}>
            <Td className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</Td>
            <Td className="uppercase">{row.method}</Td>
            <Td className="tabular text-right">{formatMoney(row.amount)}</Td>
            <Td>
              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              {row.note && <div className="mt-1 text-xs text-danger">{row.note}</div>}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ amount: '', method: 'bkash', senderNumber: '', transactionId: '', note: '' });
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
    },
  });

  const errors = fieldErrors(submit.error);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('wallet.depositRequest')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={submit.isPending} onClick={() => submit.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {submit.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(submit.error)}</Alert>
      )}

      <Field label={t('wallet.amount')} htmlFor="amount" error={errors.amount} required>
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

      <Field label={t('wallet.senderNumber')} htmlFor="senderNumber" error={errors.senderNumber}>
        <Input id="senderNumber" type="tel" inputMode="numeric" value={form.senderNumber} onChange={set('senderNumber')} />
      </Field>

      <Field label={t('wallet.transactionId')} htmlFor="transactionId" error={errors.transactionId}>
        <Input id="transactionId" value={form.transactionId} onChange={set('transactionId')} />
      </Field>

      <Field label={t('wallet.screenshot')} htmlFor="screenshot" hint={t('app.optional')}>
        <input
          id="screenshot"
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm"
        />
      </Field>

      <Field label={t('app.notes')} htmlFor="note">
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
  const [form, setForm] = useState({ amount: '', method: 'bkash', destinationNumber: '', note: '' });

  const submit = useMutation({
    mutationFn: () =>
      api.post('/reseller/withdrawals', {
        amount: Number(form.amount),
        method: form.method,
        destinationNumber: form.destinationNumber,
        ...(form.note ? { note: form.note } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      setForm({ amount: '', method: 'bkash', destinationNumber: '', note: '' });
      onClose();
    },
  });

  const errors = fieldErrors(submit.error);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('wallet.withdrawRequest')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={submit.isPending} onClick={() => submit.mutate()}>
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
        error={errors.amount}
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

      <Field
        label={t('wallet.destinationNumber')}
        htmlFor="destinationNumber"
        error={errors.destinationNumber}
        required
      >
        <Input
          id="destinationNumber"
          type="tel"
          inputMode="numeric"
          value={form.destinationNumber}
          onChange={set('destinationNumber')}
        />
      </Field>
    </Modal>
  );
}
