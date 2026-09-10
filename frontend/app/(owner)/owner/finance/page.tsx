'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatDateTime } from '@/lib/format';
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
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

type ResellerRef = { shopName: string; slug: string; user?: { name: string; phoneE164: string } };

type DepositRow = {
  id: string;
  reseller: ResellerRef;
  amount: number;
  method: string;
  senderNumber?: string;
  transactionId?: string;
  hasScreenshot: boolean;
  status: string;
  note?: string;
  createdAt: string;
};

type WithdrawalRow = {
  id: string;
  reseller: ResellerRef;
  amount: number;
  method: string;
  destinationNumber: string;
  status: string;
  createdAt: string;
};

export default function OwnerFinancePage() {
  const [tab, setTab] = useState<'deposits' | 'withdrawals'>('deposits');
  const [status, setStatus] = useState('pending');

  return (
    <>
      <PageHeader
        title={tab === 'deposits' ? t('nav.deposits') : t('nav.withdrawals')}
        action={
          <div className="flex gap-2">
            <Select
              value={tab}
              onChange={(e) => setTab(e.target.value as 'deposits' | 'withdrawals')}
              className="w-36"
            >
              <option value="deposits">{t('nav.deposits')}</option>
              <option value="withdrawals">{t('nav.withdrawals')}</option>
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-32">
              <option value="pending">{t('kyc.pending')}</option>
              <option value="approved">{t('kyc.approved')}</option>
              <option value="rejected">{t('kyc.rejected')}</option>
            </Select>
          </div>
        }
      />

      {tab === 'deposits' ? <Deposits status={status} /> : <Withdrawals status={status} />}
    </>
  );
}

/** Shared decision dialog: rejecting requires a reason, approving does not. */
function useDecision(kind: 'deposits' | 'withdrawals') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      decision,
      reason,
      payoutReference,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      reason?: string;
      payoutReference?: string;
    }) =>
      api.post(`/owner/${kind}/${id}/${decision}`, {
        ...(reason ? { reason } : {}),
        ...(payoutReference ? { payoutReference } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner'] }),
  });
}

function Deposits({ status }: { status: string }) {
  const [rejecting, setRejecting] = useState<DepositRow | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const decide = useDecision('deposits');

  const deposits = useQuery({
    queryKey: ['owner', 'deposits', status],
    queryFn: () => api.get<{ deposits: DepositRow[] }>(`/owner/deposits?status=${status}&limit=50`),
  });

  const viewScreenshot = useMutation({
    mutationFn: (id: string) => api.get<{ url: string }>(`/owner/deposits/${id}/screenshot`),
    onSuccess: (data) => setScreenshot(data.url),
  });

  if (deposits.isLoading) {
    return (
      <Card className="flex justify-center py-10">
        <Spinner />
      </Card>
    );
  }

  if (!deposits.data || deposits.data.deposits.length === 0) {
    return <EmptyState title={t('app.none')} />;
  }

  return (
    <>
      {decide.error && <Alert tone="danger">{errorMessage(decide.error)}</Alert>}

      <TableWrap>
        <thead>
          <tr>
            <Th>{t('nav.resellers')}</Th>
            <Th>{t('wallet.method')}</Th>
            <Th className="text-right">{t('wallet.amount')}</Th>
            <Th>{t('wallet.transactionId')}</Th>
            <Th>{t('app.status')}</Th>
            <Th className="text-right">{t('app.actions')}</Th>
          </tr>
        </thead>
        <tbody>
          {deposits.data.deposits.map((row) => (
            <tr key={row.id}>
              <Td>
                <div className="font-medium">{row.reseller?.shopName}</div>
                <div className="tabular text-xs text-muted-foreground">
                  {row.reseller?.user?.phoneE164}
                </div>
              </Td>
              <Td className="uppercase">
                {row.method}
                {row.senderNumber && (
                  <div className="tabular text-xs text-muted-foreground">{row.senderNumber}</div>
                )}
              </Td>
              <Td className="tabular text-right font-medium">{formatMoney(row.amount)}</Td>
              <Td className="tabular text-xs">{row.transactionId ?? '—'}</Td>
              <Td>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                <div className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</div>
              </Td>
              <Td className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  {row.hasScreenshot && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={viewScreenshot.isPending && viewScreenshot.variables === row.id}
                      onClick={() => viewScreenshot.mutate(row.id)}
                    >
                      {t('wallet.screenshot')}
                    </Button>
                  )}
                  {row.status === 'pending' && (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        loading={decide.isPending && decide.variables?.id === row.id}
                        onClick={() => decide.mutate({ id: row.id, decision: 'approve' })}
                      >
                        {t('owner.approve')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(row)}>
                        {t('owner.reject')}
                      </Button>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <RejectModal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (rejecting) decide.mutate({ id: rejecting.id, decision: 'reject', reason });
          setRejecting(null);
        }}
      />

      <Modal open={Boolean(screenshot)} onClose={() => setScreenshot(null)} title={t('wallet.screenshot')} wide>
        {/* Signed and short lived, so a plain img avoids Next caching a dead URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {screenshot && <img src={screenshot} alt="" className="w-full rounded-lg" />}
      </Modal>
    </>
  );
}

function Withdrawals({ status }: { status: string }) {
  const [approving, setApproving] = useState<WithdrawalRow | null>(null);
  const [rejecting, setRejecting] = useState<WithdrawalRow | null>(null);
  const [payoutReference, setPayoutReference] = useState('');
  const decide = useDecision('withdrawals');

  const withdrawals = useQuery({
    queryKey: ['owner', 'withdrawals', status],
    queryFn: () =>
      api.get<{ withdrawals: WithdrawalRow[] }>(`/owner/withdrawals?status=${status}&limit=50`),
  });

  if (withdrawals.isLoading) {
    return (
      <Card className="flex justify-center py-10">
        <Spinner />
      </Card>
    );
  }

  if (!withdrawals.data || withdrawals.data.withdrawals.length === 0) {
    return <EmptyState title={t('app.none')} />;
  }

  return (
    <>
      {decide.error && <Alert tone="danger">{errorMessage(decide.error)}</Alert>}

      <TableWrap>
        <thead>
          <tr>
            <Th>{t('nav.resellers')}</Th>
            <Th>{t('wallet.destinationNumber')}</Th>
            <Th className="text-right">{t('wallet.amount')}</Th>
            <Th>{t('app.status')}</Th>
            <Th className="text-right">{t('app.actions')}</Th>
          </tr>
        </thead>
        <tbody>
          {withdrawals.data.withdrawals.map((row) => (
            <tr key={row.id}>
              <Td>
                <div className="font-medium">{row.reseller?.shopName}</div>
                <div className="tabular text-xs text-muted-foreground">
                  {row.reseller?.user?.phoneE164}
                </div>
              </Td>
              <Td>
                <div className="tabular">{row.destinationNumber}</div>
                <div className="text-xs uppercase text-muted-foreground">{row.method}</div>
              </Td>
              <Td className="tabular text-right font-medium">{formatMoney(row.amount)}</Td>
              <Td>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                <div className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</div>
              </Td>
              <Td className="text-right">
                {row.status === 'pending' && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="success" onClick={() => setApproving(row)}>
                      {t('owner.approve')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(row)}>
                      {t('owner.reject')}
                    </Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <Modal
        open={Boolean(approving)}
        onClose={() => setApproving(null)}
        title={t('wallet.withdrawRequest')}
        footer={
          <>
            <Button variant="outline" onClick={() => setApproving(null)}>
              {t('app.cancel')}
            </Button>
            <Button
              variant="success"
              loading={decide.isPending}
              onClick={() => {
                if (approving) {
                  decide.mutate({ id: approving.id, decision: 'approve', payoutReference });
                }
                setPayoutReference('');
                setApproving(null);
              }}
            >
              {t('owner.approve')}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {approving && `${formatMoney(approving.amount)} → ${approving.destinationNumber}`}
        </p>
        <Field label={t('wallet.transactionId')} htmlFor="payoutReference" hint={t('app.optional')}>
          <Input
            id="payoutReference"
            value={payoutReference}
            onChange={(e) => setPayoutReference(e.target.value)}
          />
        </Field>
      </Modal>

      <RejectModal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (rejecting) decide.mutate({ id: rejecting.id, decision: 'reject', reason });
          setRejecting(null);
        }}
      />
    </>
  );
}

function RejectModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('owner.reject')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            onClick={() => {
              onConfirm(reason);
              setReason('');
            }}
          >
            {t('owner.reject')}
          </Button>
        </>
      }
    >
      <Field label={t('kyc.rejectReason')} htmlFor="reject-reason" required>
        <Textarea
          id="reject-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
