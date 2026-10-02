'use client';

/**
 * Expenses: the money that leaves and is recorded nowhere else.
 *
 * Two rules drive this whole screen, and both are refusals the API also makes:
 *
 * - **Scope.** Every expense belongs to one order or to the business at large
 *   (সাধারণ খরচ), never both and never a share of one spread across the other.
 *   A category declares which it may be, so picking a category is what decides
 *   whether an order field exists at all. The order and general totals are
 *   therefore shown apart, with their sum under them rather than as the
 *   headline: a month's labour and one parcel's courier bill answer different
 *   questions (docs/adr/0027). The printed sheet follows the same rule.
 * - **Unpaid needs a payee.** An unpaid expense owed to nobody is not something
 *   anybody can act on: there is no one to pay and no due to clear. Unpaid plus a
 *   payee is a due, and "দিয়ে দিয়েছি" on the row settles it later.
 *
 * Voiding is not deleting. A printed month's total must not change behind it.
 *
 * Every filter lives in the URL, so a payee's "সব দেখুন" lands here already
 * narrowed and Back keeps the list as it was. The sheets live in this folder:
 * the form (expense-form), the categories (categories-sheet), mark-paid.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Plus, SlidersHorizontal, Wallet } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tf, tMethod } from '@/lib/i18n/bn';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUrlRange, useUrlState } from '@/lib/use-url-state';
import {
  useGetExpenseCategoriesQuery,
  useGetExpensesInfiniteQuery,
  useGetPayeesQuery,
  useSeedExpenseCategoriesMutation,
  useVoidExpenseMutation,
  type ExpenseRow,
} from '@/lib/store/endpoints/cost';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { DateRangeFilter } from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Segmented, Toolbar } from '@/components/ui/toolbar';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { LoadMore } from '@/components/ui/load-more';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { WhyButton } from '@/components/why';
import { MoneyCell, TotalsWhyModal, scopeLabel } from './expense-parts';
import { ExpenseModal } from './expense-form';
import { CategoriesModal } from './categories-sheet';
import { MarkPaidSheet, type MarkPaidTarget } from './mark-paid-sheet';

const FILTER_KEYS = ['scope', 'categoryId', 'payeeId', 'paymentStatus', 'voided'] as const;

export default function OwnerExpensesPage() {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseRow | null>(null);
  const [markingPaid, setMarkingPaid] = useState<MarkPaidTarget | null>(null);
  const [explaining, setExplaining] = useState(false);

  // This month, the same default as every cost screen.
  const { preset, range, setRange } = useUrlRange('thisMonth');
  const [filters, setFilters, { reset, activeCount }] = useUrlState({
    scope: '',
    categoryId: '',
    payeeId: '',
    paymentStatus: '',
    voided: false as boolean,
  });

  const categories = useGetExpenseCategoriesQuery();
  // Archived parties too: a link from an archived payee's page still names them here.
  const payees = useGetPayeesQuery({ includeArchived: true });
  const [seed, seedState] = useSeedExpenseCategoriesMutation();
  const [voidExpense] = useVoidExpenseMutation();

  const listArgs = {
    categoryId: filters.categoryId,
    payeeId: filters.payeeId,
    scope: filters.scope,
    paymentStatus: filters.paymentStatus,
    includeVoided: filters.voided,
    ...(range ?? {}),
  };
  const expenses = useGetExpensesInfiniteQuery(listArgs);

  const rows = expenses.data?.pages.flatMap((page) => page.expenses) ?? [];
  const total = expenses.data?.pages[0]?.total ?? 0;
  const totals = expenses.data?.pages[0]?.totals;
  const nextError = expenses.isFetchNextPageError ? expenses.error : null;
  // The previous list stays, dimmed, while the next filter loads: no spinner flash per tap.
  const switching = expenses.isFetching && !expenses.isFetchingNextPage && !expenses.isLoading;

  const filterCount = activeCount([...FILTER_KEYS]);
  const narrowed = filterCount > 0 || preset !== 'all';
  const emptyNow = expenses.isSuccess && !expenses.isFetching && rows.length === 0;

  /*
   * Whether the account has any expense at all, asked only when the filtered
   * list came back empty. "Record your first expense" under an empty date range
   * told an owner with a full history that they had none.
   */
  const anyAtAll = useGetExpensesInfiniteQuery({ limit: 1 }, { skip: !(emptyNow && narrowed) });
  const firstTime = emptyNow && (!narrowed || anyAtAll.data?.pages[0]?.total === 0);
  const filteredEmpty = emptyNow && narrowed && anyAtAll.data?.pages[0]?.total !== 0 && !anyAtAll.isLoading;

  const noCategories = categories.isSuccess && categories.data.categories.length === 0;

  const clearFilters = () => {
    reset();
    setRange('all', null);
  };

  const seedNow = async () => {
    try {
      await seed().unwrap();
      toast(t('expense.seededToast'));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  // Without a category nothing can be written, so the button leads to where one is made.
  const startNew = () => (noCategories ? setManaging(true) : setCreating(true));

  const reportExtra = {
    categoryId: filters.categoryId || undefined,
    payeeId: filters.payeeId || undefined,
    scope: filters.scope || undefined,
    paymentStatus: filters.paymentStatus || undefined,
  };

  /** The filters, inline from `sm` and in a sheet on a phone. `at` keeps the two copies' ids apart. */
  const filterControls = (at: string) => (
    <>
      <div className="min-w-0">
        <p className="mb-1.5 text-[0.8125rem] font-semibold">{t('expense.scope')}</p>
        <Segmented
          label={t('expense.scope')}
          value={filters.scope}
          onChange={(scope) => setFilters({ scope })}
          options={[
            { value: '', label: t('app.all') },
            { value: 'order', label: t('expense.scopeOrder') },
            { value: 'period', label: t('expense.scopeGeneral') },
          ]}
        />
      </div>
      <div className="min-w-0">
        <Label htmlFor={`${at}-category`}>{t('expense.category')}</Label>
        <Select
          id={`${at}-category`}
          value={filters.categoryId}
          onChange={(event) => setFilters({ categoryId: event.target.value })}
        >
          <option value="">{t('expense.allCategories')}</option>
          {(categories.data?.categories ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.nameBn}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-0">
        <Label htmlFor={`${at}-payee`}>{t('expense.filterPayee')}</Label>
        <Select
          id={`${at}-payee`}
          value={filters.payeeId}
          onChange={(event) => setFilters({ payeeId: event.target.value })}
        >
          <option value="">{t('expense.allPayees')}</option>
          {(payees.data?.payees ?? []).map((payee) => (
            <option key={payee.id} value={payee.id}>
              {payee.nameBn}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-0">
        <Label htmlFor={`${at}-payment`}>{t('expense.paymentStatus')}</Label>
        <Select
          id={`${at}-payment`}
          value={filters.paymentStatus}
          onChange={(event) => setFilters({ paymentStatus: event.target.value })}
        >
          <option value="">{t('expense.allPayment')}</option>
          <option value="paid">{t('expense.paid')}</option>
          <option value="unpaid">{t('expense.unpaid')}</option>
        </Select>
      </div>
      <div className="min-w-0 sm:col-span-2 lg:col-span-4">
        <Switch
          checked={filters.voided}
          onChange={(voided) => setFilters({ voided })}
          label={t('expense.includeVoided')}
          hint={t('expense.voidHelp')}
        />
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        title={t('nav.expenses')}
        subtitle={t('expense.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DownloadMenu
              range={range}
              preset={preset}
              only={['expenses']}
              extra={reportExtra}
              csv={[
                {
                  file: 'expenses.csv',
                  label: t('nav.expenses'),
                  params: { ...reportExtra, ...(range ?? {}) },
                },
              ]}
            />
            {/* On a phone this sits beside the filter button, keeping the header to one row. */}
            <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => setManaging(true)}>
              {t('expense.categories')}
            </Button>
            <Button onClick={startNew}>
              <Plus className="h-4 w-4" />
              {t('expense.new')}
            </Button>
          </div>
        }
      />

      {/*
       * Nothing can be recorded without a category, which makes this the one thing
       * worth interrupting for. It says what a category is for in the owner's own
       * examples, then offers the whole set in one tap.
       */}
      {noCategories && (
        <Alert tone="primary" title={t('costSetup.next')}>
          <p className="mb-3">{t('expense.help')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={seedState.isLoading} onClick={seedNow}>
              {t('expense.seedCategories')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setManaging(true)}>
              {t('expense.newCategory')}
            </Button>
          </div>
        </Alert>
      )}

      <DateRangeFilter className="mb-3" preset={preset} range={range} onChange={setRange} />

      {/* Phones: one button that says how many filters are on, opening a sheet. */}
      <Toolbar className="sm:hidden">
        <Button variant="outline" onClick={() => setFiltering(true)} className="flex-1">
          <SlidersHorizontal className="h-4 w-4" />
          {t('app.filters')}
          {filterCount > 0 && ` (${formatNumber(filterCount)})`}
        </Button>
        <Button variant="outline" onClick={() => setManaging(true)} className="flex-1">
          {t('expense.categories')}
        </Button>
      </Toolbar>

      <div className="mb-4 hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4">{filterControls('inline')}</div>

      {/*
       * Apart, then added, then the unpaid slice: the same rule as the printed
       * sheet. Summed over the whole filter, so they do not move as pages load.
       */}
      {totals && (rows.length > 0 || switching) && (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
            <MoneyCell
              label={t('expense.totalOrder')}
              value={formatMoney(totals.order)}
              hint={t('expense.scopeOrderHint')}
            />
            <MoneyCell
              label={t('expense.scopeGeneral')}
              value={formatMoney(totals.period)}
              hint={t('expense.scopeGeneralHint')}
            />
            <MoneyCell label={t('expense.totalAll')} value={formatMoney(totals.all)} strong />
            <MoneyCell
              label={t('expense.totalUnpaid')}
              value={formatMoney(totals.unpaid)}
              hint={t('expense.unpaidHint')}
            />
          </div>
          {/* Figures somebody expects to be one are a question, answered here. */}
          <div className="mb-4 mt-1">
            <WhyButton onClick={() => setExplaining(true)} />
          </div>
        </>
      )}

      {expenses.isLoading && <ListSkeleton rows={4} />}

      {expenses.isError && !expenses.data && (
        <ErrorState
          onRetry={() => expenses.refetch()}
          isRetrying={expenses.isFetching}
          error={expenses.error}
        />
      )}

      {filteredEmpty && <FilteredEmpty onClear={clearFilters} />}

      {/*
       * Nothing recorded. The screen says what belongs here with the two kinds of
       * expense spelled out in the trade's own examples — a month's labour against
       * one parcel's courier bill — because picking the wrong one is the mistake
       * the API refuses with WRONG_EXPENSE_SCOPE.
       */}
      {firstTime && (
        <EmptyState
          icon={Wallet}
          title={t('expense.title')}
          description={t('expense.help')}
          action={
            <div className="flex flex-col items-center gap-3">
              {noCategories ? (
                <Button loading={seedState.isLoading} onClick={seedNow}>
                  {t('expense.seedCategories')}
                </Button>
              ) : (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" />
                  {t('expense.new')}
                </Button>
              )}
              <ul className="max-w-sm space-y-1.5 text-left text-xs text-muted-foreground">
                <li>
                  <span className="font-semibold text-foreground">{t('expense.scopeOrder')}:</span>{' '}
                  {t('expense.scopeOrderHint')}
                </li>
                <li>
                  <span className="font-semibold text-foreground">{t('expense.scopeGeneral')}:</span>{' '}
                  {t('expense.scopeGeneralHint')}
                </li>
                <li>
                  <Link href="/owner/payees" className="font-semibold text-primary-ink underline">
                    {t('costSetup.thenPayee')}
                  </Link>{' '}
                  {t('expense.unpaidHint')}
                </li>
              </ul>
            </div>
          }
        />
      )}

      {rows.length > 0 && (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          <ul className="space-y-3 lg:hidden">
            {rows.map((expense) => (
              <li key={expense.id}>
                <ExpenseCard
                  expense={expense}
                  onVoid={() => setVoiding(expense)}
                  onMarkPaid={() => setMarkingPaid(expense)}
                />
              </li>
            ))}
          </ul>

          <TableWrap from="lg" minWidth="48rem">
            <thead>
              <tr>
                <Th>{t('expense.date')}</Th>
                <Th>{t('expense.category')}</Th>
                <Th>{t('expense.order')}</Th>
                <Th>{t('expense.payee')}</Th>
                <Th className="text-right">{t('expense.amount')}</Th>
                <Th>{t('expense.paymentStatus')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((expense) => (
                <Tr key={expense.id} className={expense.isVoided ? 'opacity-60' : undefined}>
                  <Td className="tabular whitespace-nowrap text-sm">{formatDate(expense.businessDate)}</Td>
                  <Td>
                    <span className={expense.isVoided ? 'line-through' : 'font-medium'}>
                      {expense.categoryNameBn}
                    </span>
                    <div className="text-xs text-muted-foreground">{scopeLabel(expense.scope)}</div>
                    {expense.isVoided && (
                      <Badge tone="danger" dot>
                        {t('expense.voided')}
                      </Badge>
                    )}
                  </Td>
                  <Td className="tabular text-xs">
                    {expense.order && expense.orderCode ? (
                      <Link href={`/owner/orders/${expense.order}`} className="font-semibold hover:underline">
                        {expense.orderCode}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-sm">
                    {expense.payee && expense.payeeNameBn ? (
                      <Link href={`/owner/payees/${expense.payee}`} className="font-medium hover:underline">
                        {expense.payeeNameBn}
                      </Link>
                    ) : (
                      (expense.payeeNameBn ?? '—')
                    )}
                  </Td>
                  <Td className={cn('tabular text-right font-semibold', expense.isVoided && 'line-through')}>
                    {formatMoney(expense.amount)}
                  </Td>
                  <Td>
                    <PaymentBadge expense={expense} />
                  </Td>
                  <Td className="text-right">
                    {!expense.isVoided && (
                      <div className="flex justify-end gap-1">
                        {expense.paymentStatus === 'unpaid' && (
                          <Button size="sm" variant="outline" onClick={() => setMarkingPaid(expense)}>
                            {t('expense.paid')}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setVoiding(expense)}>
                          {t('expense.void')}
                        </Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          <LoadMore
            hasMore={Boolean(expenses.hasNextPage)}
            loading={expenses.isFetchingNextPage}
            onLoadMore={() => expenses.fetchNextPage()}
            error={nextError}
            shown={rows.length}
            total={total}
          />
        </div>
      )}

      {filtering && (
        <Modal
          open
          onClose={() => setFiltering(false)}
          title={t('app.filters')}
          footer={
            <>
              <Button variant="outline" onClick={reset} disabled={filterCount === 0}>
                {t('app.clearFilters')}
              </Button>
              <Button onClick={() => setFiltering(false)}>{t('app.close')}</Button>
            </>
          }
        >
          <div className="grid gap-4">{filterControls('sheet')}</div>
        </Modal>
      )}

      {creating && (
        <ExpenseModal categories={categories.data?.categories ?? []} onClose={() => setCreating(false)} />
      )}

      {managing && <CategoriesModal onClose={() => setManaging(false)} />}

      {markingPaid && <MarkPaidSheet expense={markingPaid} onClose={() => setMarkingPaid(null)} />}

      {voiding && (
        <ConfirmSheet
          title={t('expense.voidTitle')}
          confirmLabel={t('expense.voidVerb')}
          tone="danger"
          onClose={() => setVoiding(null)}
          onConfirm={async (reason) => {
            await voidExpense({ id: voiding.id, reason }).unwrap();
            toast(t('expense.voidedToast'));
          }}
          summary={
            <>
              <p className="font-semibold">{voiding.categoryNameBn}</p>
              <p className="text-xs text-muted-foreground">
                <span className="tabular">{formatMoney(voiding.amount)}</span> ·{' '}
                {formatDate(voiding.businessDate)}
                {voiding.orderCode && ` · ${voiding.orderCode}`}
              </p>
            </>
          }
          consequences={[
            t('expense.voidHelp'),
            ...(voiding.paymentStatus === 'unpaid' && voiding.payeeNameBn
              ? [tf('expense.voidDue', { name: voiding.payeeNameBn, amount: formatMoney(voiding.amount) })]
              : []),
          ]}
          reason={{
            required: true,
            minLength: 2,
            label: t('expense.voidReason'),
            presets: [t('expense.voidPresetWrong'), t('expense.voidPresetTwice')],
          }}
        />
      )}

      {explaining && totals && <TotalsWhyModal totals={totals} onClose={() => setExplaining(false)} />}
    </>
  );
}

/** Paid, with how and when; or still owed. Words beside the colour, never colour alone. */
function PaymentBadge({ expense }: { expense: ExpenseRow }) {
  const paid = expense.paymentStatus === 'paid';
  return (
    <div>
      <Badge tone={paid ? 'success' : 'warning'} dot>
        {paid ? t('expense.paid') : t('expense.unpaid')}
      </Badge>
      {expense.paidFrom && <div className="mt-0.5 text-xs text-muted-foreground">{tMethod(expense.paidFrom)}</div>}
      {expense.paidAt && (
        <div className="text-xs text-muted-foreground">
          {tf('expense.paidAt', { date: formatDate(expense.paidAt) })}
        </div>
      )}
    </div>
  );
}

/** One expense on a phone: what, how much, for which order and whom, and what can be done. */
function ExpenseCard({
  expense,
  onVoid,
  onMarkPaid,
}: {
  expense: ExpenseRow;
  onVoid: () => void;
  onMarkPaid: () => void;
}) {
  const voided = expense.isVoided;
  return (
    <Card className={cn('p-4', voided && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('truncate font-semibold', voided && 'line-through')}>{expense.categoryNameBn}</p>
          {/* The parcel this was spent on, and the party still owed for it. Neither is a dead end. */}
          <p className="text-xs text-muted-foreground">
            <span className="tabular">{formatDate(expense.businessDate)}</span>
            {' · '}
            {scopeLabel(expense.scope)}
          </p>
          {expense.order && expense.orderCode && (
            <Link
              href={`/owner/orders/${expense.order}`}
              className="tap tabular inline-flex items-center text-sm font-semibold text-primary-ink underline"
            >
              {expense.orderCode}
            </Link>
          )}
          {expense.payeeNameBn && (
            <p className="truncate text-xs text-muted-foreground">
              {t('expense.payee')}:{' '}
              {expense.payee ? (
                <Link href={`/owner/payees/${expense.payee}`} className="font-semibold text-primary-ink underline">
                  {expense.payeeNameBn}
                </Link>
              ) : (
                expense.payeeNameBn
              )}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('tabular text-xl font-bold', voided && 'line-through')}>{formatMoney(expense.amount)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-border pt-3">
        <PaymentBadge expense={expense} />
        {voided && (
          <Badge tone="danger" dot>
            {t('expense.voided')}
          </Badge>
        )}
      </div>

      {expense.voidReason && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('expense.voidReason')}: {expense.voidReason}
        </p>
      )}

      {!voided && (
        <div className="mt-3 flex gap-2 [&>button]:flex-1">
          {expense.paymentStatus === 'unpaid' && (
            <Button variant="outline" onClick={onMarkPaid}>
              {t('expense.paid')}
            </Button>
          )}
          <Button variant="ghost" onClick={onVoid}>
            {t('expense.void')}
          </Button>
        </div>
      )}
    </Card>
  );
}
