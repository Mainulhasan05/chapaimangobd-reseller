'use client';

/**
 * Everyone the business owes money to, biggest debt first.
 *
 * The screen that answers "who is waiting on me". A `due` here is positive when
 * the owner owes, which is the opposite of a reseller's balance (docs/adr/0025),
 * so nothing on this page is ever added to a wallet figure and a negative due is
 * never shown as a minus sign: it is an advance, said in its own words.
 */

import Link from 'next/link';
import type { Route } from 'next';

import { useState } from 'react';
import { HandCoins, Plus, Wallet } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tPayeeKind } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Payee } from '@/lib/types';
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
import { DownloadMenu } from '@/components/report/download-menu';
import { Segmented, SearchInput, Toolbar, ToolbarSpacer, type SegmentOption } from '@/components/ui/toolbar';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { PhoneField } from '@/components/ui/phone-field';
import { Modal } from '@/components/ui/modal';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';

type PayeeKind = Payee['kind'];

const PAYEE_KINDS: PayeeKind[] = ['supplier', 'labour', 'courier', 'transport', 'landlord', 'other'];

type KindFilter = 'all' | PayeeKind;

const KIND_FILTERS: SegmentOption<KindFilter>[] = [
  { value: 'all', label: t('app.all') },
  ...PAYEE_KINDS.map((kind) => ({ value: kind, label: tPayeeKind(kind) })),
];

type PayeeList = {
  payees: Payee[];
  totals: { count: number; due: number; advance: number; owingCount: number };
};

/**
 * What one payee's account comes to, as a figure that cannot be misread.
 *
 * An advance is not a negative due. "You owe him ৳500" and "he owes you ৳500 of
 * goods" are opposite facts, so they get different words and a different tone
 * rather than the same row with a minus sign in front of it.
 */
function DueFigure({ payee, align = 'right' }: { payee: Payee; align?: 'left' | 'right' }) {
  if (payee.isAdvance) {
    return (
      <div className={align === 'right' ? 'text-right' : ''}>
        <Badge tone="primary">{t('payee.advance')}</Badge>
        <p className="tabular mt-1 font-bold text-primary-ink">{formatMoney(payee.advance)}</p>
      </div>
    );
  }

  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p
        className={cn(
          'tabular font-bold',
          payee.due > 0 ? 'text-warning-ink' : 'text-muted-foreground'
        )}
      >
        {formatMoney(payee.due)}
      </p>
      <p className="text-xs text-muted-foreground">{t('payee.due')}</p>
    </div>
  );
}

export default function OwnerPayeesPage() {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [owingOnly, setOwingOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Payee | null>(null);

  const search = useDebounced(term);

  const params = new URLSearchParams();
  if (kind !== 'all') params.set('kind', kind);
  if (owingOnly) params.set('owingOnly', 'true');
  if (search.trim()) params.set('q', search.trim());
  const qs = params.toString();

  const payees = useQuery({
    queryKey: ['owner', 'payees', { kind, owingOnly, q: search.trim() }],
    queryFn: () => api.get<PayeeList>(`/owner/payees${qs ? `?${qs}` : ''}`),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.del(`/owner/payees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'payees'] }),
  });

  const rows = payees.data?.payees ?? [];
  const totals = payees.data?.totals;

  return (
    <>
      <PageHeader
        title={t('payee.title')}
        subtitle={t('payee.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Who to pay, as a sheet to carry to the market. Undated on purpose:
              * a due is where an account stands at the moment it is printed. */}
            <DownloadMenu range={null} only={['payables']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('payee.new')}
            </Button>
          </div>
        }
      />

      <Toolbar>
        <Segmented label={t('payee.kind')} value={kind} onChange={setKind} options={KIND_FILTERS} />
        <ToolbarSpacer />
        <SearchInput value={term} onChange={setTerm} placeholder={t('payee.name')} />
      </Toolbar>

      {/* Full width below `sm`: the whole row is the tap target on a phone. */}
      <div className="mb-3 w-full sm:w-auto">
        <Switch checked={owingOnly} onChange={setOwingOnly} label={t('payee.owingOnly')} />
      </div>

      {archive.error && <Alert tone="danger">{errorMessage(archive.error)}</Alert>}

      {/*
       * Two figures, never one. Netting an advance off a due would produce a
       * number that is true of nobody: money already handed over is a different
       * fact from money still owed. See docs/adr/0025.
       */}
      {totals && (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Stat
            icon={HandCoins}
            label={t('payee.totalDue')}
            value={formatMoney(totals.due)}
            hint={t('payee.dueHint')}
            tone={totals.due > 0 ? 'warning' : 'neutral'}
          />
          <Stat
            icon={Wallet}
            label={t('payee.totalAdvance')}
            value={formatMoney(totals.advance)}
            hint={t('payee.advanceHint')}
            tone={totals.advance > 0 ? 'primary' : 'neutral'}
          />
          <Stat
            label={t('nav.payees')}
            value={formatNumber(totals.count)}
            hint={`${formatNumber(totals.owingCount)} · ${t('payee.owingOnly')}`}
          />
        </div>
      )}

      {payees.isLoading && (
        <>
          <StatSkeleton count={3} />
          <ListSkeleton rows={4} />
        </>
      )}

      {payees.isError && (
        <ErrorState
          onRetry={() => payees.refetch()}
          isRetrying={payees.isFetching}
          error={payees.error}
        />
      )}

      {payees.data && rows.length === 0 && (
        <EmptyState
          icon={HandCoins}
          title={t('app.noResults')}
          description={t('payee.help')}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('payee.new')}
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <>
          <ul className="space-y-3 lg:hidden">
            {rows.map((payee) => (
              <li key={payee.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/owner/payees/${payee.id}` as Route}
                        className="block truncate font-semibold text-primary-ink hover:underline"
                      >
                        {payee.nameBn}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge>{tPayeeKind(payee.kind)}</Badge>
                        {payee.phone && (
                          <span className="tabular text-xs text-muted-foreground">
                            {payee.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <DueFigure payee={payee} />
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2 border-t border-border pt-3 [&>*]:flex-1">
                    <Link href={`/owner/payees/${payee.id}` as Route}>
                      <Button variant="outline" full>
                        {t('payee.ledger')}
                      </Button>
                    </Link>
                    <Button variant="outline" onClick={() => setEditing(payee)}>
                      {t('app.edit')}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap from="lg" minWidth="44rem">
            <thead>
              <tr>
                <Th>{t('payee.name')}</Th>
                <Th>{t('payee.kind')}</Th>
                <Th>{t('auth.phone')}</Th>
                <Th className="text-right">{t('payee.due')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((payee) => (
                <Tr key={payee.id}>
                  <Td className="font-medium">
                    <Link
                      href={`/owner/payees/${payee.id}` as Route}
                      className="rounded-md text-primary-ink hover:underline"
                    >
                      {payee.nameBn}
                    </Link>
                  </Td>
                  <Td>
                    <Badge>{tPayeeKind(payee.kind)}</Badge>
                  </Td>
                  <Td className="tabular text-sm">{payee.phone ?? '—'}</Td>
                  <Td className="text-right">
                    <DueFigure payee={payee} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link href={`/owner/payees/${payee.id}` as Route}>
                        <Button size="sm" variant="outline">
                          {t('payee.ledger')}
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline" onClick={() => setEditing(payee)}>
                        {t('app.edit')}
                      </Button>
                      {/* Archived, never deleted: the ledger behind it is the
                        * record that settles an argument with a supplier. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => archive.mutate(payee.id)}
                        loading={archive.isPending && archive.variables === payee.id}
                      >
                        {t('app.close')}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {(creating || editing) && (
        <PayeeModal
          payee={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

type Draft = { nameBn: string; kind: PayeeKind; phone: string; address: string; note: string };

const blank: Draft = { nameBn: '', kind: 'supplier', phone: '', address: '', note: '' };

function PayeeModal({ payee, onClose }: { payee: Payee | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(
    payee
      ? {
          nameBn: payee.nameBn,
          kind: payee.kind,
          phone: payee.phone ?? '',
          address: payee.address ?? '',
          note: payee.note ?? '',
        }
      : blank
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nameBn: draft.nameBn,
        kind: draft.kind,
        ...(draft.phone ? { phone: draft.phone } : {}),
        ...(draft.address ? { address: draft.address } : {}),
        ...(draft.note ? { note: draft.note } : {}),
      };
      return payee
        ? api.patch(`/owner/payees/${payee.id}`, body)
        : api.post('/owner/payees', body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'payees'] });
      if (payee) await queryClient.invalidateQueries({ queryKey: ['owner', 'payee', payee.id] });
      onClose();
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <Modal
      open
      onClose={onClose}
      title={payee ? t('payee.edit') : t('payee.new')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field label={t('payee.name')} htmlFor="nameBn" error={errors.nameBn} required>
        <Input
          id="nameBn"
          value={draft.nameBn}
          onChange={(e) => setDraft((prev) => ({ ...prev, nameBn: e.target.value }))}
          autoFocus
        />
      </Field>

      {/* The kind changes the label a reader sees and nothing else, so it is a
        * plain select rather than a decision the form makes a fuss about. */}
      <Field label={t('payee.kind')} htmlFor="kind" error={errors.kind}>
        <Select
          id="kind"
          value={draft.kind}
          onChange={(e) => setDraft((prev) => ({ ...prev, kind: e.target.value as PayeeKind }))}
        >
          {PAYEE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {tPayeeKind(kind)}
            </option>
          ))}
        </Select>
      </Field>

      <PhoneField
        id="phone"
        label={t('auth.phone')}
        hint={t('app.optional')}
        value={draft.phone}
        onChange={(phone) => setDraft((prev) => ({ ...prev, phone }))}
        error={errors.phone}
        autoComplete="off"
      />

      <Field label={t('order.address')} htmlFor="address" error={errors.address}>
        <Textarea
          id="address"
          rows={2}
          value={draft.address}
          onChange={(e) => setDraft((prev) => ({ ...prev, address: e.target.value }))}
        />
      </Field>

      <Field label={t('app.notes')} htmlFor="note" error={errors.note}>
        <Textarea
          id="note"
          rows={2}
          value={draft.note}
          onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
        />
      </Field>
    </Modal>
  );
}
