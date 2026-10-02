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
 * nothing here caps the amount at the balance; the pay sheet warns instead.
 *
 * Rebuilt to the same brief as `owner/supplies/[id]`:
 *
 * 1. **Spoken Bengali.** "দিতে হবে", "টাকা দিন", "লেনদেনের খাতা" — every string
 *    comes from the dictionary, none of it from an accountant.
 * 2. **The due explains itself.** It is a running total of an append-only ledger,
 *    which is exactly the kind of number somebody disbelieves while holding a
 *    paper slip, so it carries a "কীভাবে?" that opens the working: where the
 *    balance stood, every entry, and where it stood after each.
 * 3. **An inert account says what to do.** A payee with no ledger, no purchase and
 *    no খরচ is doing nothing, and the screen says so and links to the places that
 *    change that.
 * 4. **Nothing is a dead end.** A ledger row names what it came from and links to
 *    that payee's purchases or expenses; a wrong payment is taken back from the
 *    row itself, with a reason, and never edited.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { HandCoins, Receipt, ShoppingBasket, TriangleAlert, Undo2, Wallet } from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf, tPayeeKind, tPayeeLedgerKind } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber, formatSignedMoney } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Payee } from '@/lib/types';
import {
  useGetPayeeLedgerInfiniteQuery,
  useGetPayeeQuery,
  usePostPayeeLedgerEntryMutation,
  useRestorePayeeMutation,
  useReversePayeeEntryMutation,
  type PayeeLedgerRow,
} from '@/lib/store/endpoints/cost';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  PhoneLink,
  Stat,
} from '@/components/ui/layout';
import { BackLink } from '@/components/ui/back-link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FormErrorSummary, MoneyInput, Select, Textarea, focusFirstInvalid } from '@/components/ui/form';
import { Segmented } from '@/components/ui/toolbar';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { LoadMore } from '@/components/ui/load-more';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ExplainedStat } from '@/components/why';
import { PaySheet } from '../pay-sheet';
import { payeeState, runningText } from '../payee-money';
import { MarkPaidSheet, type MarkPaidTarget } from '../../expenses/mark-paid-sheet';

/** The only three a person has any business typing. The rest are posted by
 * whatever happened: a purchase, an expense, a payment. */
const MANUAL_KINDS = ['OPENING', 'ADJUSTMENT', 'DISCOUNT'] as const;
type ManualKind = (typeof MANUAL_KINDS)[number];

/** Kinds a person may take back here; a purchase is cancelled and an expense voided instead. */
const REVERSIBLE_KINDS = ['PAYMENT', 'OPENING', 'ADJUSTMENT', 'DISCOUNT'];

/**
 * Whether a row can still be taken back. The API says so on every row it
 * enriches; an older answer without the flag falls back to the same rule.
 */
function canReverse(entry: PayeeLedgerRow): boolean {
  if (entry.reversible !== undefined) return entry.reversible;
  return REVERSIBLE_KINDS.includes(entry.kind) && !entry.reversalOf && !entry.reversedBy;
}

/** The day a row belongs to: the business date, or for an old row the day it was written. */
const dayOf = (entry: PayeeLedgerRow) => formatDate(entry.businessDate ?? entry.createdAt);

export default function PayeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [manual, setManual] = useState(false);
  const [whyDue, setWhyDue] = useState(false);
  const [reversing, setReversing] = useState<PayeeLedgerRow | null>(null);
  const [markingPaid, setMarkingPaid] = useState<MarkPaidTarget | null>(null);

  const query = useGetPayeeQuery({ id });

  /*
   * The ledger is paged, and it is read twice: once as the খাতা itself and once
   * as the working behind the due. One query, so the two can never disagree and
   * a "load more" fills both.
   */
  const ledger = useGetPayeeLedgerInfiniteQuery({ id });
  const [reverse] = useReversePayeeEntryMutation();
  const [restore, restoreState] = useRestorePayeeMutation();

  const entries = ledger.data?.pages.flatMap((page) => page.ledger) ?? [];
  const entryTotal = ledger.data?.pages[0]?.total ?? 0;

  const back = <BackLink fallback="/owner/payees" label={t('payee.title')} />;

  if (query.isLoading) {
    return (
      <>
        {back}
        <StatSkeleton count={3} />
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (!query.data) {
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

  const { payee, purchases, expenses, health } = query.data;
  const purchaseCount = query.data.purchaseCount ?? purchases.length;
  const expenseCount = query.data.expenseCount ?? expenses.length;
  const state = payeeState(payee.due);
  const archived = payee.isArchived;
  const purchasesHref = `/owner/purchases?payeeId=${payee.id}&range=all` as Route;
  const expensesHref = `/owner/expenses?payeeId=${payee.id}&range=all` as Route;

  /*
   * Nothing has ever been written against this পার্টি. Not an error — it is the
   * normal state of a row somebody added this morning — so it reads as
   * instructions rather than as a warning.
   */
  const inert =
    Boolean(ledger.data) && entryTotal === 0 && purchaseCount === 0 && expenses.length === 0;

  const doRestore = async () => {
    try {
      await restore({ id: payee.id }).unwrap();
      toast(tf('payee.restoredToast', { name: payee.nameBn }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  return (
    <>
      {back}

      <PageHeader
        title={payee.nameBn}
        subtitle={tPayeeKind(payee.kind)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* An archived পার্টি is paid only after it is back on the list, so
              * nothing is paid to a name the owner thought was closed. */}
            {!archived && (
              <>
                <Button onClick={() => setPaying(true)}>
                  <HandCoins className="h-4 w-4" />
                  {t('payee.pay')}
                </Button>
                <Button variant="outline" onClick={() => setManual(true)}>
                  {t('payee.manualEntry')}
                </Button>
              </>
            )}
            {/* On a phone a number is for calling, in the local 01… form, not +880. */}
            <PhoneLink
              phone={payee.phone}
              className={buttonVariants({ variant: 'outline', className: 'hover:no-underline' })}
            />
          </div>
        }
      />

      {payee.address && <p className="-mt-4 mb-5 text-sm text-muted-foreground">{payee.address}</p>}

      {/* --- what is wrong, loudest first --- */}

      {/*
       * The append-only ledger disagrees with the cached due. That is a bug in
       * our software, not a number to reconcile by hand, so it says so plainly.
       * The server's own diagnostics are English and for us, not the owner.
       */}
      {!health.ok && (
        <Alert tone="danger" icon={TriangleAlert} title={t('payee.healthBad')}>
          <p className="mt-1 text-xs">{t('payee.healthBadHelp')}</p>
        </Alert>
      )}

      {archived && (
        <Alert tone="neutral" title={t('payee.archivedBadge')}>
          <p className="mb-2">{t('payee.archivedNotice')}</p>
          <Button size="sm" variant="outline" loading={restoreState.isLoading} onClick={doRestore}>
            {t('app.restore')}
          </Button>
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

      {/* --- what to do next, when nothing has been written against this পার্টি --- */}

      {inert && !archived && (
        <Alert tone="primary" title={t('costSetup.next')}>
          <ul className="mt-1 space-y-1 text-sm">
            <li className="flex flex-wrap items-center gap-x-2">
              <span>{t('costSetup.thenPurchase')}</span>
              <Link href="/owner/purchases" className="tap inline-flex items-center font-semibold underline">
                {t('costSetup.recordPurchase')}
              </Link>
            </li>
            <li className="flex flex-wrap items-center gap-x-2">
              <span>{t('expense.unpaidHint')}</span>
              <Link href="/owner/expenses" className="tap inline-flex items-center font-semibold underline">
                {t('expense.new')}
              </Link>
            </li>
            <li className="flex flex-wrap items-center gap-x-2">
              <span>{t('payee.manualHelp')}</span>
              <button
                type="button"
                onClick={() => setManual(true)}
                className="tap inline-flex items-center font-semibold underline"
              >
                {t('payee.manualEntry')}
              </button>
            </li>
          </ul>
        </Alert>
      )}

      {/* --- the numbers. The one the system worked out explains itself. --- */}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {/*
         * A due is not typed by anybody: it is every entry in the খাতা added up.
         * So it is the one figure here that carries its working, the way
         * প্রতিটা পড়েছে does on a supply.
         *
         * No `delta`: there is no prior-period due in the API, and inventing one
         * would be a number somebody pays money against.
         */}
        <div className="col-span-2 sm:col-span-1">
          <ExplainedStat
            label={state.label}
            value={<span className={state.ink}>{state.value}</span>}
            hint={state.hint}
            onWhy={() => setWhyDue(true)}
          />
        </div>
        <Stat
          icon={ShoppingBasket}
          label={t('payee.purchases')}
          value={formatNumber(purchaseCount)}
          hint={t('payee.purchaseCountHint')}
          href={purchasesHref}
        />
        <Stat
          icon={Receipt}
          label={t('payee.ledger')}
          value={formatNumber(entryTotal)}
          hint={t('payee.ledgerCountHint')}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-4 sm:p-6">
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
              <p className="mb-1 text-muted-foreground">{t('payee.ledgerEmpty')}</p>
              <p className="text-muted-foreground">{t('costSetup.thenPurchase')}</p>
              <Link href="/owner/purchases" className="tap inline-flex items-center font-semibold text-primary-ink underline">
                {t('costSetup.recordPurchase')}
              </Link>
            </div>
          )}

          {entries.length > 0 && (
            <>
              <ul className="-my-1 divide-y divide-border">
                {entries.map((entry) => (
                  <LedgerRow
                    key={entry.id}
                    entry={entry}
                    purchasesHref={purchasesHref}
                    expensesHref={expensesHref}
                    onReverse={!archived && canReverse(entry) ? () => setReversing(entry) : undefined}
                  />
                ))}
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

        <div className="grid content-start gap-5">
          <Card className="p-4 sm:p-6">
            <CardHeader
              title={t('payee.recentPurchases')}
              subtitle={t('purchase.landedHint')}
              href={purchasesHref}
              hrefLabel={t('app.viewAll')}
            />
            {purchases.length === 0 ? (
              <div className="text-sm">
                <p className="text-muted-foreground">{t('costSetup.noPurchaseYet')}</p>
                <Link href="/owner/purchases" className="tap inline-flex items-center font-semibold text-primary-ink underline">
                  {t('costSetup.recordPurchase')}
                </Link>
              </div>
            ) : (
              <>
                <ul className="-my-1 divide-y divide-border">
                  {purchases.map((purchase) => (
                    <li key={purchase.id}>
                      {/* The purchase itself, opened over the list whatever its range. */}
                      <Link
                        href={`/owner/purchases?purchase=${purchase.id}` as Route}
                        className="flex items-start justify-between gap-3 py-2.5 hover:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span
                            className={cn(
                              'tabular block truncate font-semibold text-primary-ink',
                              purchase.status === 'cancelled' && 'line-through'
                            )}
                          >
                            {purchase.purchaseCode}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(purchase.businessDate)}
                          </span>
                          {/* Only the exception is labelled: a received purchase is
                            * the normal state and a badge on every row is noise. */}
                          {purchase.status === 'cancelled' && (
                            <Badge tone="danger" className="mt-1">
                              {t('purchase.cancelled')}
                            </Badge>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="tabular block font-semibold">{formatMoney(purchase.payeeTotal)}</span>
                          <span className="block text-xs text-muted-foreground">{t('purchase.payeeTotal')}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {purchaseCount > purchases.length && (
                  <Link href={purchasesHref} className="tap mt-2 inline-flex items-center text-sm font-semibold text-primary-ink underline">
                    {t('app.viewAll')} ({formatNumber(purchaseCount)})
                  </Link>
                )}
              </>
            )}
          </Card>

          <Card className="p-4 sm:p-6">
            <CardHeader
              title={t('payee.recentExpenses')}
              subtitle={t('expense.unpaidHint')}
              href={expensesHref}
              hrefLabel={t('app.viewAll')}
            />
            {expenses.length === 0 ? (
              <div className="text-sm">
                <p className="text-muted-foreground">{t('expense.help')}</p>
                <Link href="/owner/expenses" className="tap inline-flex items-center font-semibold text-primary-ink underline">
                  {t('expense.new')}
                </Link>
              </div>
            ) : (
              <>
                <ul className="-my-1 divide-y divide-border">
                  {expenses.map((expense) => (
                    <li key={expense.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link
                          href={expensesHref}
                          className="block truncate py-2.5 font-semibold leading-6 text-primary-ink hover:underline sm:py-0"
                        >
                          {expense.categoryNameBn}
                        </Link>
                        <p className="text-xs text-muted-foreground">{formatDate(expense.businessDate)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular font-semibold">{formatMoney(expense.amount)}</p>
                        <Badge tone={expense.paymentStatus === 'paid' ? 'success' : 'warning'}>
                          {expense.paymentStatus === 'paid' ? t('expense.paid') : t('expense.unpaid')}
                        </Badge>
                        {/* Settled from here too: this is where the owner sees what is still owed. */}
                        {expense.paymentStatus === 'unpaid' && !archived && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1.5 flex"
                            onClick={() =>
                              setMarkingPaid({
                                id: expense.id,
                                categoryNameBn: expense.categoryNameBn,
                                amount: expense.amount,
                                payeeNameBn: payee.nameBn,
                              })
                            }
                          >
                            {t('expense.paid')}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {expenseCount > expenses.length && (
                  <Link href={expensesHref} className="tap mt-2 inline-flex items-center text-sm font-semibold text-primary-ink underline">
                    {t('app.viewAll')} ({formatNumber(expenseCount)})
                  </Link>
                )}
              </>
            )}
          </Card>
        </div>
      </div>

      {whyDue && (
        <DueWhyModal
          onClose={() => setWhyDue(false)}
          entries={entries}
          total={entryTotal}
          due={payee.due}
        />
      )}
      {paying && <PaySheet payee={payee} onClose={() => setPaying(false)} />}
      {manual && <ManualEntryModal payee={payee} onClose={() => setManual(false)} />}
      {markingPaid && <MarkPaidSheet expense={markingPaid} onClose={() => setMarkingPaid(null)} />}

      {reversing && (
        <ConfirmSheet
          title={t('payee.reverseTitle')}
          confirmLabel={t('payee.reverseVerb')}
          tone="danger"
          onClose={() => setReversing(null)}
          onConfirm={async (reason) => {
            await reverse({ id: payee.id, entryId: reversing.id, reason }).unwrap();
            toast(t('payee.reversedToast'));
          }}
          summary={
            <>
              <p className="font-semibold">
                {tPayeeLedgerKind(reversing.kind)} · {dayOf(reversing)}
              </p>
              {reversing.note && <p className="text-xs text-muted-foreground">{reversing.note}</p>}
            </>
          }
          rows={[
            { label: t('expense.amount'), value: formatSignedMoney(reversing.amount), strong: true },
            { label: t('app.before'), value: state.value },
            { label: t('app.after'), value: runningText(payee.due - reversing.amount) },
          ]}
          consequences={[
            t('payee.reverseKeep'),
            // Only a payment can have settled an expense; the API reopens it.
            ...(reversing.kind === 'PAYMENT' && reversing.refType === 'payment' && reversing.refId
              ? [t('payee.reverseExpense')]
              : []),
          ]}
          reason={{
            required: true,
            minLength: 3,
            presets: [
              t('payee.reversePresetAmount'),
              t('payee.reversePresetPayee'),
              t('payee.reversePresetTwice'),
            ],
          }}
        />
      )}
    </>
  );
}

/**
 * One line of the খাতা: what happened, on which day, what it points at, and
 * where the balance stood after it.
 */
function LedgerRow({
  entry,
  purchasesHref,
  expensesHref,
  onReverse,
}: {
  entry: PayeeLedgerRow;
  purchasesHref: Route;
  expensesHref: Route;
  onReverse?: () => void;
}) {
  const reference = entry.reference;
  // A purchase opens by itself; an expense has no page of its own, so its payee's list.
  const purchaseId = reference?.type === 'purchase' ? reference.id : entry.refType === 'purchase' ? entry.refId : null;
  const href: Route | null = purchaseId
    ? (`/owner/purchases?purchase=${purchaseId}` as Route)
    : reference?.type === 'expense' || entry.refType === 'expense'
      ? expensesHref
      : entry.refType === 'purchase'
        ? purchasesHref
        : null;
  // Both halves of a reversal stay in the book; neither should shout.
  const quiet = Boolean(entry.reversalOf || entry.reversedBy);

  return (
    <li className={cn('flex items-start justify-between gap-3 py-2.5', quiet && 'opacity-70')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold">{tPayeeLedgerKind(entry.kind)}</span>
          {entry.reversedBy && <Badge>{t('payee.reversedBadge')}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {dayOf(entry)}
          {reference && (
            <>
              {' · '}
              {href ? (
                <Link
                  href={href}
                  className={cn(
                    'tap inline-flex items-center font-semibold text-primary-ink underline',
                    reference.cancelled && 'line-through'
                  )}
                >
                  {reference.label}
                </Link>
              ) : (
                reference.label
              )}
              {reference.cancelled && ` · ${t('purchase.cancelled')}`}
            </>
          )}
          {!reference && href && (
            <>
              {' · '}
              <Link href={href} className="tap inline-flex items-center font-semibold text-primary-ink underline">
                {t('app.details')}
              </Link>
            </>
          )}
        </p>
        {entry.note && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{entry.note}</p>
        )}
        {onReverse && (
          <button
            type="button"
            onClick={onReverse}
            className="tap -ml-1 mt-0.5 inline-flex items-center gap-1 rounded-md px-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Undo2 aria-hidden className="h-3.5 w-3.5" />
            {t('payee.reverse')}
          </button>
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
        <p className="tabular text-xs text-muted-foreground">{runningText(entry.dueAfter)}</p>
      </div>
    </li>
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
 * says something else. So the working starts from where the balance stood before
 * the oldest loaded entry, then lists each entry with what it did and where the
 * balance stood afterwards, ending on the figure printed on the screen behind.
 * Without that first line, a খাতা with more pages than are loaded added up to
 * a different number and read as a mistake.
 *
 * Not a tooltip. This is arithmetic somebody wants to sit and follow on a phone.
 */
function DueWhyModal({
  onClose,
  entries,
  total,
  due,
}: {
  onClose: () => void;
  entries: PayeeLedgerRow[];
  total: number;
  due: number;
}) {
  const state = payeeState(due);
  // The API sends the খাতা newest first; the working reads the other way.
  const oldestFirst = [...entries].reverse();
  const oldest = oldestFirst[0];
  const opening = oldest ? oldest.dueAfter - oldest.amount : 0;

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

          <WhyLine label={t('payee.openingLine')} value={runningText(opening)} muted />

          {oldestFirst.map((entry) => (
            <WhyLine
              key={entry.id}
              label={tPayeeLedgerKind(entry.kind)}
              note={[dayOf(entry), entry.reference?.label].filter(Boolean).join(' · ')}
              value={formatSignedMoney(entry.amount)}
              running={runningText(entry.dueAfter)}
              // A taken-back row is still in the book and still in this sum, but
              // it is greyed so the pair reads as one another's opposite.
              muted={Boolean(entry.reversalOf || entry.reversedBy)}
            />
          ))}

          <WhyLine label={state.label} value={state.value} strong />
        </>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------- manual entry -- */

function ManualEntryModal({ payee, onClose }: { payee: Payee; onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<ManualKind>('OPENING');
  const [direction, setDirection] = useState<'more' | 'less'>('more');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [nonce] = useState(() => crypto.randomUUID());

  const [post, postState] = usePostPayeeLedgerEntryMutation();
  const errors = fieldErrors(postState.error);

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

  const preview = payee.due + signed;

  const save = async () => {
    setTried(true);
    if (!check.ok) {
      requestAnimationFrame(() => focusFirstInvalid(document.getElementById('manual-form')));
      return;
    }
    try {
      await post({
        id: payee.id,
        kind,
        amount: signed,
        nonce,
        ...(note.trim() ? { note: note.trim() } : {}),
      }).unwrap();
      toast(t('payee.entryToast'));
      onClose();
    } catch {
      // Shown inline.
    }
  };

  const amountError = errors.amount ?? (tried || amount ? moneyError(amount) : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('payee.manualEntry')}
      dirty={amount.trim().length > 0 || note.trim().length > 0}
      footerLead={
        <>
          <FormErrorSummary
            message={postState.error && !Object.keys(errors).length ? errorMessage(postState.error) : null}
          />
          {check.ok && (
            <p className="tabular text-sm text-muted-foreground">
              {formatSignedMoney(signed)} · {runningText(preview)}
            </p>
          )}
        </>
      }
      footer={
        <>
          <ModalCancel />
          <Button loading={postState.isLoading} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div id="manual-form">
        <p className="mb-4 text-sm text-muted-foreground">{t('payee.manualHelp')}</p>

        <Field label={t('supply.adjustKind')} htmlFor="manual-kind" error={errors.kind}>
          <Select id="manual-kind" value={kind} onChange={(e) => setKind(e.target.value as ManualKind)}>
            {MANUAL_KINDS.map((option) => (
              <option key={option} value={option}>
                {tPayeeLedgerKind(option)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('payee.payAmount')} htmlFor="manual-amount" error={amountError} required>
          <MoneyInput
            id="manual-amount"
            value={amount}
            invalid={Boolean(amountError)}
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
          <Field label={t('payee.directionQuestion')}>
            <Segmented
              label={t('payee.directionQuestion')}
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
          <Textarea id="manual-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
