'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatSignedMoney, formatDateTime } from '@/lib/format';
import type { LedgerEntry, ResellerSummary } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  statusTone,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

export default function OwnerResellersPage() {
  const [managing, setManaging] = useState<ResellerSummary | null>(null);

  const resellers = useQuery({
    queryKey: ['owner', 'resellers'],
    queryFn: () => api.get<{ resellers: ResellerSummary[] }>('/owner/resellers'),
  });

  return (
    <>
      <PageHeader title={t('nav.resellers')} subtitle={t('wallet.negativeHelp')} />

      {resellers.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {resellers.data?.resellers.length === 0 && <EmptyState title={t('app.none')} />}

      {resellers.data && resellers.data.resellers.length > 0 && (
        <TableWrap alwaysVisible>
          <thead>
            <tr>
              <Th>{t('auth.shopName')}</Th>
              <Th>{t('auth.phone')}</Th>
              <Th>{t('kyc.title')}</Th>
              <Th className="text-right">{t('wallet.balance')}</Th>
              <Th className="text-right">{t('wallet.creditLimit')}</Th>
              <Th className="text-right">{t('app.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {resellers.data.resellers.map((reseller) => (
              <tr key={reseller.id}>
                <Td>
                  <div className="font-medium">{reseller.shopName}</div>
                  <div className="text-xs text-muted-foreground">/r/{reseller.slug}</div>
                </Td>
                <Td>
                  <div className="text-sm">{reseller.user?.name}</div>
                  <div className="tabular text-xs text-muted-foreground">
                    {reseller.user?.phoneE164}
                  </div>
                </Td>
                <Td>
                  <Badge tone={statusTone(reseller.kycStatus)}>{reseller.kycStatus}</Badge>
                </Td>
                <Td
                  className={`tabular text-right ${
                    reseller.balance < 0 ? 'text-danger' : 'text-success'
                  }`}
                >
                  {formatSignedMoney(reseller.balance)}
                </Td>
                <Td className="tabular text-right">{formatMoney(reseller.creditLimit)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setManaging(reseller)}>
                    {t('app.actions')}
                  </Button>
                </Td>
              </tr>
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
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-muted p-3">
          <div className="text-muted-foreground">{t('wallet.balance')}</div>
          <div
            className={`tabular text-lg font-semibold ${
              reseller.balance < 0 ? 'text-danger' : 'text-success'
            }`}
          >
            {formatSignedMoney(reseller.balance)}
          </div>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <div className="text-muted-foreground">{t('wallet.creditLimit')}</div>
          <div className="tabular text-lg font-semibold">{formatMoney(reseller.creditLimit)}</div>
        </div>
      </div>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-medium">{t('owner.creditLimit')}</h3>
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

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-medium">{t('owner.manualEntry')}</h3>

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
          size="sm"
          loading={postEntry.isPending}
          disabled={!entry.amount || entry.note.trim().length < 3}
          onClick={() => postEntry.mutate()}
        >
          {t('app.save')}
        </Button>
      </section>

      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('wallet.ledger')}</h3>
          <Button size="sm" variant="ghost" loading={reconcile.isPending} onClick={() => reconcile.mutate()}>
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
