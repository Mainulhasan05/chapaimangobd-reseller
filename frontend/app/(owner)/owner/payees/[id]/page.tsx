'use client';

/**
 * One পার্টি, and what is owed to them.
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
 *
 * Rebuilt to the same brief as `owner/supplies/[id]`:
 *
 * 1. **Spoken Bengali.** "দিতে হবে", "টাকা দিন", "লেনদেনের খাতা" — every string
 *    comes from the dictionary, none of it from an accountant.
 * 2. **The due explains itself.** It is a running total of an append-only ledger,
 *    which is exactly the kind of number somebody disbelieves while holding a
 *    paper slip, so it carries a "কীভাবে?" that opens the working: every entry,
 *    its amount, and where the balance stood after it.
 * 3. **An inert account says what to do.** A payee with no ledger, no purchase and
 *    no খরচ is doing nothing, and the screen says so and links to the places that
 *    change that.
 * 4. **Nothing is a dead end.** A ledger row posted by a purchase or an expense
 *    links to that screen, and both side cards carry the arrow to their list.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  HandCoins,
  Phone,
  Receipt,
  ShoppingBasket,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
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
import { ExplainedStat } from '@/components/why';

const PAGE_SIZE = 20;

const PAID_FROM = ['cash', 'bkash', 'nagad', 'rocket', 'bank'] as const;

/** The only three a person has any business typing. The rest are posted by
 * whatever happened: a purchase, an expense, a payment. */
const MANUAL_KINDS = ['OPENING', 'ADJUSTMENT', 'DISCOUNT'] as const;
type ManualKind = (typeof MANUAL_KINDS)[number];

/**
 * Where an account stands, in words rather than in a sign.
 *
 * Zero and a due both read as "দিতে হবে"; a negative due is not that sentence
 * with a minus in it, so it gets the advance wording and a different tone.
 */
function stateOf(due: number): {
  label: string;
  value: string;
  hint: string;
  tone: 'warning' | 'primary' | 'neutral';
} {
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

/** The ink a due or an advance is written in. Never the same colour as the other. */
function inkOf(tone: 'warning' | 'primary' | 'neutral'): string {
  if (tone === 'primary') return 'text-primary-ink';
  if (tone === 'warning') return 'text-warning-ink';
  return 'text-muted-foreground';
}

/** A running figure on a ledger row, which may have crossed into advance. */
function runningText(dueAfter: number): string {
  return dueAfter < 0
    ? `${t('payee.advance')} ${formatMoney(-dueAfter)}`
    : `${t('payee.dueAfter')} ${formatMoney(dueAfter)}`;
}

/**
 * Where a ledger row came from, so no row is a dead end.
 *
 * A payment and a hand entry were made on this screen and have nowhere else to
 * go; a purchase and an unpaid খরচ were written somewhere else, and that is where
 * somebody who disputes the row needs to look.
 */
function refHref(entry: PayeeLedgerEntry): '/owner/purchases' | '/owner/expenses' | null {
  if (entry.refType === 'purchase') return '/owner/purchases';
  if (entry.refType === 'expense') return '/owner/expenses';
  return null;
}

export default function PayeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [paying, setPaying] = useState(false);
  const [manual, setManual] = useState(false);
  const [whyDue, setWhyDue] = useState(false);

  const query = useQuery({
    queryKey: ['owner', 'payee', id],
    queryFn: () => api.get<PayeeDetail>(`/owner/payees/${id}`),
  });

  /*
   * The ledger is paged, and it is read twice: once as the খাতা itself and once
   * as the working behind the due. One query, so the two can never disagree and
   * a "load more" fills both.
   */
  const ledger = useInfiniteQuery({
    queryKey: ['owner', 'payee', id, 'ledger'],
    queryFn: ({ pageParam }) =>
      api.get<Paged<'ledger', PayeeLedgerEntry>>(
        `/owner/payees/${id}/ledger?limit=${PAGE_SIZE}&page=${pageParam}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.ledger.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });

  const entries = ledger.data?.pages.flatMap((page) => page.ledger) ?? [];
  const entryTotal = ledger.data?.pages[0]?.total ?? 0;

  const back = (
    <Link
      href="/owner/payees"
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('payee.title')}
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

  /*
   * Nothing has ever been written against this পার্টি. Not an error — it is the
   * normal state of a row somebody added this morning — so it reads as
   * instructions rather than as a warning.
   */
  const inert =
    Boolean(ledger.data) && entryTotal === 0 && purchases.length === 0 && expenses.length === 0;

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
            {/* On a phone a number is for calling, not for reading. */}
            {payee.phone && (
              <a href={`tel:${payee.phone}`}>
                <Button variant="outline">
                  <Phone className="h-4 w-4" />
                  <span className="tabular">{payee.phone}</span>
                </Button>
              </a>
            )}
          </div>
        }
      />

      {payee.address && <p className="-mt-4 mb-5 text-sm text-muted-foreground">{payee.address}</p>}

      {/* --- what is wrong, loudest first --- */}

      {/*
       * The append-only ledger disagrees with the cached due. That is a bug in
       * our software, not a number to reconcile by hand, so it is said in full
       * and in red.
       */}
      {!health.ok && (
        <Alert tone="danger" icon={TriangleAlert} title={t('payee.healthBad')}>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
            {health.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/*
       * An advance is its own fact, announced in its own words. The stat below
       * already carries the figure; this is here so nobody reads the screen as
       * "৳500 owed" when the ৳500 is already in the other man's pocket.
       */}
      {payee.isAdvance && (
        <Alert tone="primary" icon={Wallet} title={t('payee.advance')}>
          {t('payee.advanceHint')}
        </Alert>
      )}

      {payee.isArchived && <Alert tone="neutral">{t('supply.archived')}</Alert>}

      {/* --- what to do next, when nothing has been written against this পার্টি --- */}

      {inert && (
        <Alert tone="primary" title={t('costSetup.next')}>
          <ul className="mt-1 space-y-2 text-sm">
            <li className="flex flex-wrap items-center gap-2">
              <span>{t('costSetup.thenPurchase')}</span>
              <Link href="/owner/purchases" className="font-semibold underline">
                {t('costSetup.recordPurchase')}
              </Link>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span>{t('expense.unpaidHint')}</span>
              <Link href="/owner/expenses" className="font-semibold underline">
                {t('expense.new')}
              </Link>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span>{t('payee.manualHelp')}</span>
              <button
                type="button"
                onClick={() => setManual(true)}
                className="font-semibold underline"
              >
                {t('payee.manualEntry')}
              </button>
            </li>
          </ul>
        </Alert>
      )}

      {/* --- the numbers. The one the system worked out explains itself. --- */}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {/*
         * A due is not typed by anybody: it is every entry in the খাতা added up.
         * So it is the one figure here that carries its working, the way
         * প্রতিটা পড়েছে does on a supply.
         *
         * No `delta`: there is no prior-period due in the API, and inventing one
         * would be a number somebody pays money against.
         */}
        <ExplainedStat
          label={state.label}
          value={<span className={inkOf(state.tone)}>{state.value}</span>}
          hint={state.hint}
          onWhy={() => setWhyDue(true)}
        />
        <Stat
          icon={ShoppingBasket}
          label={t('payee.purchases')}
          value={formatNumber(purchases.length)}
          href="/owner/purchases"
        />
        <Stat
          icon={Receipt}
          label={t('payee.ledger')}
          value={formatNumber(entryTotal)}
          hint={t('payee.dueHint')}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('payee.ledger')} />

          {ledger.isLoading && <ListSkeleton rows={4} />}

          {ledger.isError && entries.length === 0 && (
            <ErrorState
              onRetry={() => ledger.refetch()}
              isRetrying={ledger.isFetching}
              error={ledger.error}
            />
          )}

          {/* Empty, and the way out of empty. Nothing here says "কিছু নেই". */}
          {ledger.data && entries.length === 0 && (
            <div className="text-sm">
              <p className="mb-2 text-muted-foreground">{t('payee.ledgerEmpty')}</p>
              <p className="mb-2 text-muted-foreground">{t('costSetup.thenPurchase')}</p>
              <Link
                href="/owner/purchases"
                className="font-semibold text-primary-ink underline"
              >
                {t('costSetup.recordPurchase')}
              </Link>
            </div>
          )}

          {entries.length > 0 && (
            <>
              <ul className="-my-1 divide-y divide-border">
                {entries.map((entry) => {
                  const href = refHref(entry);
                  return (
                    <li
                      key={entry.id}
                      /* A reversal is muted: the original row is never edited, so
                       * both stay, and the one that cancels should not shout as
                       * loudly. */
                      className={cn(
                        'flex items-start justify-between gap-3 py-2.5',
                        entry.reversalOf && 'opacity-60'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {href ? (
                            <Link
                              href={href}
                              className="truncate text-sm font-semibold text-primary-ink hover:underline"
                            >
                              {tPayeeLedgerKind(entry.kind)}
                            </Link>
                          ) : (
                            <span className="truncate text-sm font-semibold">
                              {tPayeeLedgerKind(entry.kind)}
                            </span>
                          )}
                          {entry.reversalOf && <Badge>{tPayeeLedgerKind('REVERSAL')}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                        </p>
                        {entry.note && (
                          <p className="mt-0.5 break-words text-xs text-muted-foreground">
                            {entry.note}
                          </p>
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
                  );
                })}
              </ul>

              <LoadMore
                compact
                hasMore={Boolean(ledger.hasNextPage)}
                loading={ledger.isFetchingNextPage}
                onLoadMore={() => ledger.fetchNextPage()}
                error={ledger.isFetchNextPageError ? ledger.error : undefined}
                shown={entries.length}
                total={entryTotal}
              />
            </>
          )}
        </Card>

        <div className="grid gap-5">
          <Card>
            <CardHeader
              title={t('payee.purchases')}
              subtitle={t('purchase.landedHint')}
              href="/owner/purchases"
              hrefLabel={t('nav.purchases')}
            />
            {purchases.length === 0 ? (
              <div className="text-sm">
                <p className="mb-2 text-muted-foreground">{t('costSetup.noPurchaseYet')}</p>
                <Link href="/owner/purchases" className="font-semibold text-primary-ink underline">
                  {t('costSetup.recordPurchase')}
                </Link>
              </div>
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {purchases.map((purchase) => (
                  <li key={purchase.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href="/owner/purchases"
                        className="tabular block truncate font-semibold text-primary-ink hover:underline"
                      >
                        {purchase.purchaseCode}
                      </Link>
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
            <CardHeader
              title={t('payee.expenses')}
              subtitle={t('expense.unpaidHint')}
              href="/owner/expenses"
              hrefLabel={t('nav.expenses')}
            />
            {expenses.length === 0 ? (
              <div className="text-sm">
                <p className="mb-2 text-muted-foreground">{t('expense.help')}</p>
                <Link href="/owner/expenses" className="font-semibold text-primary-ink underline">
                  {t('expense.new')}
                </Link>
              </div>
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href="/owner/expenses"
                        className="block truncate font-semibold text-primary-ink hover:underline"
                      >
                        {expense.categoryNameBn}
                      </Link>
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

      <DueWhyModal
        open={whyDue}
        onClose={() => setWhyDue(false)}
        entries={entries}
        total={entryTotal}
        due={payee.due}
      />
      {paying && <PayModal payee={payee} onClose={() => setPaying(false)} />}
      {manual && <ManualEntryModal payee={payee} onClose={() => setManual(false)} />}
    </>
  );
}

/* --------------------------------------------------------------- why, due -- */

/**
 * One line of the working, laid out the way it would be added up on paper.
 *
 * Local rather than shared: `components/why.tsx` has the same shape for a
 * supply's arithmetic, but a ledger line carries a running balance underneath the
 * amount and a charge line does not.
 */
function WhyLine({
  label,
  note,
  value,
  running,
  strong,
  muted,
}: {
  label: string;
  note?: string;
  value: string;
  running?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1',
        strong && 'mt-1 border-t border-border pt-2 font-semibold'
      )}
    >
      <span className={cn('min-w-0 text-sm', muted && 'text-muted-foreground')}>
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className={cn('tabular block text-sm', muted && 'text-muted-foreground')}>
          {value}
        </span>
        {running && <span className="tabular block text-xs text-muted-foreground">{running}</span>}
      </span>
    </div>
  );
}

/**
 * "দিতে হবে ৳৪,৫০০ — কীভাবে?"
 *
 * A due is the only figure on this screen nobody typed: it is every entry in the
 * খাতা added up, and the owner checking it is usually holding a paper slip that
 * says something else. So the working is laid out oldest first, each entry with
 * what it did to the balance and where the balance stood afterwards, ending on
 * the figure printed on the screen behind this sheet.
 *
 * Not a tooltip. This is arithmetic somebody wants to sit and follow on a phone.
 */
function DueWhyModal({
  open,
  onClose,
  entries,
  total,
  due,
}: {
  open: boolean;
  onClose: () => void;
  entries: PayeeLedgerEntry[];
  total: number;
  due: number;
}) {
  if (!open) return null;

  const state = stateOf(due);
  // The API sends the খাতা newest first; the working reads the other way.
  const oldestFirst = [...entries].reverse();

  return (
    <Modal
      open
      onClose={onClose}
      title={t('why.title')}
      footer={<Button onClick={onClose}>{t('why.close')}</Button>}
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('payee.dueHint')}</p>

      {oldestFirst.length === 0 ? (
        <p className="text-sm">{t('payee.ledgerEmpty')}</p>
      ) : (
        <>
          {/*
            * Only the loaded pages are in here. Said in the same "20 / 57" form
            * the foot of every paged list uses, so the owner knows the top line
            * is not where the খাতা begins and can load the rest behind this sheet.
            */}
          {total > oldestFirst.length && (
            <p className="tabular mb-2 text-xs text-muted-foreground">
              {formatNumber(oldestFirst.length)} / {formatNumber(total)}
            </p>
          )}

          {oldestFirst.map((entry) => (
            <WhyLine
              key={entry.id}
              label={tPayeeLedgerKind(entry.kind)}
              note={formatDateTime(entry.createdAt)}
              value={formatSignedMoney(entry.amount)}
              running={runningText(entry.dueAfter)}
              // A cancelled row is still in the book and still in this sum, but
              // it is greyed so the pair reads as one another's opposite.
              muted={Boolean(entry.reversalOf)}
            />
          ))}

          <WhyLine label={state.label} value={state.value} strong />
        </>
      )}
    </Modal>
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
  const state = stateOf(payee.due);

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
        {payee.nameBn} · {state.label}{' '}
        <span className={cn('tabular font-semibold', inkOf(state.tone))}>{state.value}</span>
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
        <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as ManualKind)}>
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
       * Which way it moves, in the payee's own words, with the resulting figure
       * spelled out under the footer. Not `ledger.manualCredit`/`manualDebit`:
       * those say "ব্যালেন্স" — a reseller wallet, which runs the other way and is
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
