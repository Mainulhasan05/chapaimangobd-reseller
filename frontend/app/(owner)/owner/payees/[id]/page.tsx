'use client';

/**
 * One payee, and what is owed to them.
 *
 * `due` is positive when the owner owes (docs/adr/0025), the opposite of a
 * reseller's balance, so the figure is always said in words next to the number.
 * A negative due is an advance — money already handed over against goods still
 * to come — and it is rendered as its own thing rather than as a minus sign,
 * because "you owe him ৳500" and "he owes you ৳500" must not look like the same
 * row with different punctuation.
 *
 * Paying more than the due is legitimate and the API never refuses it, so
 * nothing here caps the amount at the balance.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, HandCoins, Phone, ShoppingBasket, Wallet } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tPaidFrom, tPayeeKind, tPayeeLedgerKind } from '@/lib/i18n/bn';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatSignedMoney,
} from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Paged, Payee, PayeeDetail, PayeeLedgerEntry } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/toolbar';
import { Modal } from '@/components/ui/modal';
import { LoadMore } from '@/components/ui/load-more';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 20;

const PAID_FROM = ['cash', 'bkash', 'nagad', 'rocket', 'bank'] as const;

/** The only three a person has any business typing. The rest are posted by
 * whatever happened: a purchase, an expense, a payment. */
const MANUAL_KINDS = ['OPENING', 'ADJUSTMENT', 'DISCOUNT'] as const;
type ManualKind = (typeof MANUAL_KINDS)[number];

/**
 * Where an account stands, in words rather than in a sign.
 *
 * Zero and a due both read as "বাকি"; a negative due is not that sentence with a
 * minus in it, so it gets the advance wording and a different tone.
 */
function stateOf(due: number): { label: string; value: string; hint: string; tone: 'warning' | 'primary' | 'neutral' } {
  if (due < 0) {
    return {
      label: t('payee.advance'),
      value: formatMoney(-due),
      hint: t('payee.advanceHint'),
      tone: 'primary',
    };
  }
  return {
    label: t('payee.due'),
    value: formatMoney(due),
    hint: t('payee.dueHint'),
    tone: due > 0 ? 'warning' : 'neutral',
  };
}

/** A running figure on a ledger row, which may have crossed into advance. */
function runningText(dueAfter: number): string {
  return dueAfter < 0
    ? `${t('payee.advance')} ${formatMoney(-dueAfter)}`
    : `${t('payee.dueAfter')} ${formatMoney(dueAfter)}`;
}

export default function PayeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [paying, setPaying] = useState(false);
  const [manual, setManual] = useState(false);

  const query = useQuery({
    queryKey: ['owner', 'payee', id],
    queryFn: () => api.get<PayeeDetail>(`/owner/payees/${id}`),
  });

  const back = (
    <Link
      href="/owner/payees"
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('app.back')}
    </Link>
  );

  if (query.isLoading) {
    return (
      <>
        {back}
        <StatSkeleton count={3} />
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        {back}
        <ErrorState
          onRetry={() => query.refetch()}
          isRetrying={query.isFetching}
          error={query.error}
        />
      </>
    );
  }

  const { payee, purchases, expenses, health } = query.data!;
  const state = stateOf(payee.due);

  return (
    <>
      {back}

      <PageHeader
        title={payee.nameBn}
        subtitle={tPayeeKind(payee.kind)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setPaying(true)}>
              <HandCoins className="h-4 w-4" />
              {t('payee.pay')}
            </Button>
            <Button variant="outline" onClick={() => setManual(true)}>
              {t('payee.manualEntry')}
            </Button>
          </div>
        }
      />

      {payee.isArchived && <Alert tone="warning">{t('supply.archived')}</Alert>}

      {/*
       * The append-only ledger disagrees with the cached due. That is a bug, not
       * a number to reconcile by hand, so it is said in full and in red.
       */}
      {!health.ok && (
        <Alert tone="danger" title={t('payee.healthBad')}>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
            {health.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat
          icon={state.tone === 'primary' ? Wallet : HandCoins}
          label={state.label}
          value={state.value}
          hint={state.hint}
          tone={state.tone}
        />
        <Stat
          icon={ShoppingBasket}
          label={t('payee.purchases')}
          value={formatNumber(purchases.length)}
        />
        <Stat icon={Phone} label={t('auth.phone')} value={payee.phone ?? '—'} hint={payee.address ?? undefined} />
      </div>

      {payee.phone && (
        <div className="mb-5">
          <a href={`tel:${payee.phone}`}>
            <Button variant="outline" size="sm">
              <Phone className="h-4 w-4" />
              <span className="tabular">{payee.phone}</span>
            </Button>
          </a>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <LedgerCard payeeId={id} />

        <div className="grid gap-5">
          <Card>
            <CardHeader title={t('payee.purchases')} />
            {purchases.length === 0 ? (
              <EmptyState icon={ShoppingBasket} title={t('app.none')} />
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {purchases.map((purchase) => (
                  <li
                    key={purchase.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="tabular truncate font-semibold">{purchase.purchaseCode}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(purchase.businessDate)}
                      </p>
                      {/* Only the exception is labelled: a received purchase is
                        * the normal state and a badge on every row is noise. */}
                      {purchase.status === 'cancelled' && (
                        <Badge tone="danger" className="mt-1">
                          {t('purchase.cancelled')}
                        </Badge>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular font-semibold">{formatMoney(purchase.payeeTotal)}</p>
                      <p className="text-xs text-muted-foreground">{t('purchase.payeeTotal')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={t('payee.expenses')} />
            {expenses.length === 0 ? (
              <EmptyState icon={HandCoins} title={t('app.none')} />
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{expense.categoryNameBn}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(expense.businessDate)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular font-semibold">{formatMoney(expense.amount)}</p>
                      <Badge tone={expense.paymentStatus === 'paid' ? 'success' : 'warning'}>
                        {expense.paymentStatus === 'paid' ? t('expense.paid') : t('expense.unpaid')}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {paying && <PayModal payee={payee} onClose={() => setPaying(false)} />}
      {manual && <ManualEntryModal payee={payee} onClose={() => setManual(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ ledger -- */

function LedgerCard({ payeeId }: { payeeId: string }) {
  const ledger = useInfiniteQuery({
    queryKey: ['owner', 'payee', payeeId, 'ledger'],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'ledger', PayeeLedgerEntry>>(
        `/owner/payees/${payeeId}/ledger?limit=${PAGE_SIZE}&page=${pageParam}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.ledger.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });

  const rows = ledger.data?.pages.flatMap((page) => page.ledger) ?? [];
  const total = ledger.data?.pages[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader title={t('payee.ledger')} />

      {ledger.isLoading && <ListSkeleton rows={4} />}

      {ledger.isError && rows.length === 0 && (
        <ErrorState
          onRetry={() => ledger.refetch()}
          isRetrying={ledger.isFetching}
          error={ledger.error}
        />
      )}

      {ledger.data && rows.length === 0 && (
        <EmptyState icon={HandCoins} title={t('payee.ledgerEmpty')} />
      )}

      {rows.length > 0 && (
        <>
          <ul className="-my-1 divide-y divide-border">
            {rows.map((entry) => (
              <li
                key={entry.id}
                /* A reversal is muted: the original row is never edited, so both
                 * stay, and the one that cancels should not shout as loudly. */
                className={cn(
                  'flex items-start justify-between gap-3 py-2.5',
                  entry.reversalOf && 'opacity-60'
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {tPayeeLedgerKind(entry.kind)}
                    </span>
                    {entry.reversalOf && <Badge>{tPayeeLedgerKind('REVERSAL')}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</p>
                  {entry.note && (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">{entry.note}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {/* Positive increased what we owe. */}
                  <p
                    className={cn(
                      'tabular font-semibold',
                      entry.amount < 0 ? 'text-success-ink' : 'text-warning-ink'
                    )}
                  >
                    {formatSignedMoney(entry.amount)}
                  </p>
                  <p className="tabular text-xs text-muted-foreground">
                    {runningText(entry.dueAfter)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <LoadMore
            compact
            hasMore={Boolean(ledger.hasNextPage)}
            loading={ledger.isFetchingNextPage}
            onLoadMore={() => ledger.fetchNextPage()}
            error={ledger.isFetchNextPageError ? ledger.error : undefined}
            shown={rows.length}
            total={total}
          />
        </>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- paying -- */

/**
 * After a payment or a hand entry, both the list and this record are stale.
 * Keyed by prefix, so the paged ledger under `['owner','payee',id,'ledger']`
 * goes with it.
 */
function useAfterEntry(payeeId: string, onDone: () => void) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['owner', 'payees'] }),
      queryClient.invalidateQueries({ queryKey: ['owner', 'payee', payeeId] }),
    ]);
    onDone();
  };
}

function PayModal({ payee, onClose }: { payee: Payee; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [paidFrom, setPaidFrom] = useState<string>('cash');
  const [note, setNote] = useState('');

  /*
   * One key per opening of this sheet, not per click. A double tap, or a retry
   * after a timeout that actually went through, reuses it and the API refuses
   * the second write rather than paying the man twice. Reopening the sheet is
   * how a deliberate second payment is made.
   */
  const [nonce] = useState(() => crypto.randomUUID());

  const done = useAfterEntry(payee.id, onClose);

  const pay = useMutation({
    mutationFn: (value: number) =>
      api.post(`/owner/payees/${payee.id}/payments`, {
        amount: value,
        nonce,
        paidFrom,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: done,
  });

  const check = checkMoney(amount);
  const errors = fieldErrors(pay.error);

  /*
   * No ceiling on the amount. Overpaying is legitimate in this trade — it
   * becomes an advance (বায়না) — and the API never refuses it, so the form must
   * not either. See docs/adr/0025.
   */
  const preview = check.ok ? payee.due - check.value : payee.due;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('payee.pay')}
      dirty={amount.trim().length > 0 || note.trim().length > 0}
      footerLead={
        check.ok ? (
          <p className="tabular text-sm text-muted-foreground">{runningText(preview)}</p>
        ) : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={pay.isPending}
            disabled={!check.ok}
            onClick={() => check.ok && pay.mutate(check.value)}
          >
            {t('payee.pay')}
          </Button>
        </>
      }
    >
      {pay.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(pay.error)}</Alert>
      )}

      <p className="mb-4 text-sm text-muted-foreground">
        {payee.nameBn} · {stateOf(payee.due).label} {stateOf(payee.due).value}
      </p>

      <Field
        label={t('payee.payAmount')}
        htmlFor="amount"
        error={errors.amount ?? moneyError(amount)}
        required
      >
        <MoneyInput id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>

      {/* A label, not an account: there is no cash book. See PLAN-3 decision 20. */}
      <Field label={t('payee.paidFrom')} htmlFor="paidFrom" error={errors.paidFrom}>
        <Select id="paidFrom" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
          {PAID_FROM.map((method) => (
            <option key={method} value={method}>
              {tPaidFrom(method)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('app.notes')} htmlFor="note" hint={t('app.optional')} error={errors.note}>
        <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/* ----------------------------------------------------------- manual entry -- */

function ManualEntryModal({ payee, onClose }: { payee: Payee; onClose: () => void }) {
  const [kind, setKind] = useState<ManualKind>('OPENING');
  const [direction, setDirection] = useState<'more' | 'less'>('more');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [nonce] = useState(() => crypto.randomUUID());

  const done = useAfterEntry(payee.id, onClose);

  const check = checkMoney(amount);

  /*
   * A discount only ever reduces what is owed, whichever way it was typed, so
   * the direction control is not offered for it. `OPENING` and `ADJUSTMENT` go
   * either way and the sign carries it: positive means the owner owes more.
   */
  const signed = !check.ok
    ? 0
    : kind === 'DISCOUNT' || direction === 'less'
      ? -check.value
      : check.value;

  const post = useMutation({
    mutationFn: () =>
      api.post(`/owner/payees/${payee.id}/ledger`, {
        kind,
        amount: signed,
        nonce,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: done,
  });

  const errors = fieldErrors(post.error);
  const preview = payee.due + signed;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('payee.manualEntry')}
      dirty={amount.trim().length > 0 || note.trim().length > 0}
      footerLead={
        check.ok ? (
          <p className="tabular text-sm text-muted-foreground">
            {formatSignedMoney(signed)} · {runningText(preview)}
          </p>
        ) : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={post.isPending} disabled={!check.ok} onClick={() => post.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {post.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(post.error)}</Alert>
      )}

      <p className="mb-4 text-sm text-muted-foreground">{t('payee.manualHelp')}</p>

      <Field label={t('supply.adjustKind')} htmlFor="kind" error={errors.kind}>
        <Select
          id="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ManualKind)}
        >
          {MANUAL_KINDS.map((option) => (
            <option key={option} value={option}>
              {tPayeeLedgerKind(option)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t('payee.payAmount')}
        htmlFor="manual-amount"
        error={errors.amount ?? moneyError(amount)}
        required
      >
        <MoneyInput
          id="manual-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </Field>

      {/*
       * Which way it moves, as the two signs the ledger itself uses, with the
       * resulting figure spelled out under the footer. A word for each direction
       * would have to be one of `ledger.manualCredit`/`manualDebit`, and those
       * say "ব্যালেন্স" — a reseller wallet, which runs the other way and is
       * exactly the confusion docs/adr/0025 exists to prevent.
       */}
      {kind !== 'DISCOUNT' && (
        <Field label={t('ledger.direction')} error={errors.amount}>
          <Segmented
            label={t('ledger.direction')}
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'more', label: t('payee.dueUp') },
              { value: 'less', label: t('payee.dueDown') },
            ]}
          />
        </Field>
      )}

      <Field label={t('app.notes')} htmlFor="manual-note" hint={t('app.optional')} error={errors.note}>
        <Textarea
          id="manual-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
