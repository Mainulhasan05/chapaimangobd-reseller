'use client';

/**
 * Expenses: the money that leaves and is recorded nowhere else.
 *
 * Two rules drive this whole screen, and both are refusals the API also makes:
 *
 * - **Scope.** Every expense belongs to one order or to a day, never both and
 *   never a share of one spread across the other. A category declares which it
 *   may be, so picking a category is what decides whether an order field exists
 *   at all. The order and period totals are therefore shown apart: a day's
 *   labour and one parcel's courier bill answer different questions, and summing
 *   them into a headline "total cost" invites exactly the mistake docs/adr/0027
 *   was written to prevent.
 * - **Unpaid needs a payee.** An unpaid expense owed to nobody is not something
 *   anybody can act on: there is no one to pay and no due to clear. Unpaid plus a
 *   payee is a due, and that is what makes a month of courier bills add up.
 *
 * Voiding is not deleting. A printed month's total must not change behind it.
 *
 * Built to the same four rules as the supplies screens: the words are the owner's
 * own ("সারা দিনের", "এই টাকাটা কাকে দিলেন"), the three totals carry a "কীভাবে?"
 * that says what each one does and does not include, an account with no categories
 * is told what to do rather than shown "কিছু নেই", and every row links out to the
 * order and the party it belongs to.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wallet } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tPaidFrom } from '@/lib/i18n/bn';
import { businessDate, formatDate, formatMoney } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { useDebounced } from '@/lib/use-debounced';
import type { Expense, ExpenseCategory, Order, Paged, Payee } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import {
  DateRangeFilter,
  rangeOf,
  rangeParams,
  type DateRange,
  type PresetKey,
} from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Segmented, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { LoadMore } from '@/components/ui/load-more';
import { WhyButton } from '@/components/why';

const PAGE_SIZE = 20;

const PAID_FROM = ['cash', 'bkash', 'nagad', 'rocket', 'bank'] as const;

type ExpensePage = Paged<'expenses', Expense> & {
  totals: { all: number; order: number; period: number; unpaid: number };
};

const SCOPES = [
  { value: '', label: t('app.all') },
  { value: 'order', label: t('expense.scopeOrder') },
  { value: 'period', label: t('expense.scopePeriod') },
];

/** One figure in the strip under the date filter. */
function MoneyCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="tabular mt-0.5 text-base font-bold leading-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------- where the numbers came from -- */

/** One line of the working. `strong` marks the answer. */
function WhyLine({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1.5 ${
        strong ? 'border-t border-border pt-2 font-semibold' : ''
      }`}
    >
      <span className="text-sm">
        {label}
        {note && <span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>}
      </span>
      <span className="tabular shrink-0 text-sm font-semibold">{value}</span>
    </div>
  );
}

/**
 * "এই তিনটা সংখ্যা কোথা থেকে এলো" — and, more to the point, why they are three.
 *
 * Modelled on the working in `components/why.tsx`, kept local because what wants
 * explaining here is not one arithmetic chain but a refusal to add two figures up.
 * A day's labour and one parcel's courier bill answer different questions, and a
 * single "মোট খরচ" would let the day's labour be charged to one mango parcel.
 */
function TotalsWhyModal({
  totals,
  onClose,
}: {
  totals: { order: number; period: number; unpaid: number };
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={t('why.title')}
      footer={<Button onClick={onClose}>{t('why.close')}</Button>}
    >
      <WhyLine
        label={t('expense.totalOrder')}
        note={t('expense.scopeOrderHint')}
        value={formatMoney(totals.order)}
      />
      <WhyLine
        label={t('expense.totalPeriod')}
        note={t('expense.scopePeriodHint')}
        value={formatMoney(totals.period)}
      />

      {/*
       * Not a sum of the two above, and shown without a subtotal rule so it cannot
       * be read as one. It cuts across both: some of each is still owed.
       * See docs/adr/0027.
       */}
      <div className="mt-3 border-t border-border pt-2">
        <WhyLine
          label={t('expense.totalUnpaid')}
          note={t('expense.unpaidHint')}
          value={formatMoney(totals.unpaid)}
        />
      </div>

      <p className="mt-3 rounded-md bg-muted p-2 text-xs">{t('expense.voidHelp')}</p>
    </Modal>
  );
}

export default function OwnerExpensesPage() {
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [scope, setScope] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [preset, setPreset] = useState<PresetKey | 'custom'>('thisMonth');
  const [range, setRange] = useState<DateRange>(rangeOf('thisMonth'));

  const queryClient = useQueryClient();

  const categories = useQuery({
    queryKey: ['owner', 'expense-categories'],
    queryFn: () => api.get<{ categories: ExpenseCategory[] }>('/owner/expense-categories'),
  });

  /*
   * The six defaults, one tap from the screen that needs them. Nothing can be
   * recorded until a category exists, so this is the primary action on an empty
   * account rather than something buried in the manage sheet.
   */
  const seed = useMutation({
    mutationFn: () =>
      api.post<{ created: number; categories: ExpenseCategory[] }>(
        '/owner/expense-categories/seed'
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'expense-categories'] }),
  });

  const filters =
    `${categoryId ? `&categoryId=${categoryId}` : ''}` +
    `${scope ? `&scope=${scope}` : ''}` +
    `${paymentStatus ? `&paymentStatus=${paymentStatus}` : ''}` +
    `${includeVoided ? '&includeVoided=true' : ''}` +
    `${range ? `&${rangeParams(range)}` : ''}`;

  const expenses = useInfiniteQuery({
    queryKey: ['owner', 'expenses', categoryId, scope, paymentStatus, includeVoided, range],
    queryFn: ({ pageParam }) =>
      api.get<ExpensePage>(`/owner/expenses?limit=${PAGE_SIZE}&page=${pageParam}${filters}`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.expenses.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  });

  const rows = expenses.data?.pages.flatMap((page) => page.expenses) ?? [];
  const total = expenses.data?.pages[0]?.total ?? 0;
  const totals = expenses.data?.pages[0]?.totals;
  const nextError = expenses.isFetchNextPageError ? expenses.error : null;

  const noCategories = categories.isSuccess && categories.data.categories.length === 0;

  return (
    <>
      <PageHeader
        title={t('nav.expenses')}
        subtitle={t('expense.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DownloadMenu range={range} only={['expenses']} />
            <Button variant="outline" onClick={() => setManaging(true)}>
              {t('expense.categories')}
            </Button>
            <Button disabled={noCategories} onClick={() => setCreating(true)}>
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
            <Button size="sm" loading={seed.isPending} onClick={() => seed.mutate()}>
              {t('expense.seedCategories')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setManaging(true)}>
              {t('expense.newCategory')}
            </Button>
          </div>
          {seed.error && (
            <p className="mt-2 text-xs text-danger-ink">{errorMessage(seed.error)}</p>
          )}
        </Alert>
      )}

      <DateRangeFilter
        className="mb-4"
        preset={preset}
        range={range}
        onChange={(nextPreset, nextRange) => {
          setPreset(nextPreset);
          setRange(nextRange);
        }}
      />

      <Toolbar>
        <Segmented label={t('expense.scope')} value={scope} onChange={setScope} options={SCOPES} />
        <ToolbarSpacer />
        <Select
          aria-label={t('expense.category')}
          className="w-auto"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">{t('app.all')}</option>
          {(categories.data?.categories ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.nameBn}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('expense.paymentStatus')}
          className="w-auto"
          value={paymentStatus}
          onChange={(event) => setPaymentStatus(event.target.value)}
        >
          <option value="">{t('app.all')}</option>
          <option value="paid">{t('expense.paid')}</option>
          <option value="unpaid">{t('expense.unpaid')}</option>
        </Select>
      </Toolbar>

      <div className="mb-4 divide-y divide-border">
        <Switch
          checked={includeVoided}
          onChange={setIncludeVoided}
          label={t('expense.includeVoided')}
          hint={t('expense.voidHelp')}
        />
      </div>

      {/*
       * Apart, never added together. A period cost and an order cost are used
       * differently by the P&L, and one headline figure would hide that.
       */}
      {totals && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            <MoneyCell
              label={t('expense.totalOrder')}
              value={formatMoney(totals.order)}
              hint={t('expense.scopeOrderHint')}
            />
            <MoneyCell
              label={t('expense.totalPeriod')}
              value={formatMoney(totals.period)}
              hint={t('expense.scopePeriodHint')}
            />
            <MoneyCell
              label={t('expense.totalUnpaid')}
              value={formatMoney(totals.unpaid)}
              hint={t('expense.unpaidHint')}
            />
          </div>
          {/* Three figures where somebody expects one is a question, so it is
              answered here rather than left to be guessed at. */}
          <div className="mb-4 mt-2">
            <WhyButton onClick={() => setExplaining(true)} />
          </div>
        </>
      )}

      {expenses.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {expenses.isError && rows.length === 0 && (
        <ErrorState
          onRetry={() => expenses.refetch()}
          isRetrying={expenses.isFetching}
          error={expenses.error}
        />
      )}

      {/* A filter that matched nothing. Nothing to teach: the account works. */}
      {expenses.isSuccess &&
        rows.length === 0 &&
        !noCategories &&
        Boolean(categoryId || scope || paymentStatus) && (
          <EmptyState icon={Wallet} title={t('app.none')} />
        )}

      {/*
       * Nothing recorded. The screen says what belongs here with the two kinds of
       * expense spelled out in the trade's own examples — a day's labour against
       * one parcel's courier bill — because picking the wrong one is the mistake
       * the API refuses with WRONG_EXPENSE_SCOPE.
       */}
      {expenses.isSuccess && rows.length === 0 && !(categoryId || scope || paymentStatus) && (
        <EmptyState
          icon={Wallet}
          title={t('expense.title')}
          description={t('expense.help')}
          action={
            <div className="flex flex-col items-center gap-3">
              {noCategories ? (
                <Button loading={seed.isPending} onClick={() => seed.mutate()}>
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
                  <span className="font-semibold text-foreground">
                    {t('expense.scopeOrder')}:
                  </span>{' '}
                  {t('expense.scopeOrderHint')}
                </li>
                <li>
                  <span className="font-semibold text-foreground">
                    {t('expense.scopePeriod')}:
                  </span>{' '}
                  {t('expense.scopePeriodHint')}
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
        <>
          <ul className="space-y-3 lg:hidden">
            {rows.map((expense) => (
              <li key={expense.id}>
                <Card className={`p-4 ${expense.isVoided ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`truncate font-semibold ${expense.isVoided ? 'line-through' : ''}`}>
                        {expense.categoryNameBn}
                      </p>
                      {/* The parcel this was spent on, and the party still owed
                          for it. Neither is a dead end. */}
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular">{formatDate(expense.businessDate)}</span>
                        {expense.order && expense.orderCode && (
                          <>
                            {' · '}
                            <Link
                              href={`/owner/orders/${expense.order}`}
                              className="tabular font-semibold text-primary-ink underline"
                            >
                              {expense.orderCode}
                            </Link>
                          </>
                        )}
                      </p>
                      {expense.payeeNameBn && (
                        <p className="truncate text-xs text-muted-foreground">
                          {t('expense.payee')}:{' '}
                          {expense.payee ? (
                            <Link
                              href={`/owner/payees/${expense.payee}`}
                              className="font-semibold text-primary-ink underline"
                            >
                              {expense.payeeNameBn}
                            </Link>
                          ) : (
                            expense.payeeNameBn
                          )}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`tabular text-xl font-bold ${expense.isVoided ? 'line-through' : ''}`}>
                        {formatMoney(expense.amount)}
                      </p>
                      <p className="text-[0.6875rem] text-muted-foreground">
                        {expense.scope === 'order'
                          ? t('expense.scopeOrder')
                          : t('expense.scopePeriod')}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <Badge tone={expense.paymentStatus === 'paid' ? 'success' : 'warning'} dot>
                      {expense.paymentStatus === 'paid' ? t('expense.paid') : t('expense.unpaid')}
                    </Badge>
                    {expense.paidFrom && (
                      <span className="text-xs text-muted-foreground">
                        {tPaidFrom(expense.paidFrom)}
                      </span>
                    )}
                    {expense.isVoided && (
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

                  {!expense.isVoided && (
                    <Button
                      className="mt-3"
                      full
                      variant="outline"
                      onClick={() => setVoiding(expense)}
                    >
                      {t('expense.void')}
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap from="lg" minWidth="44rem">
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
                  <Td className="tabular whitespace-nowrap text-sm">
                    {formatDate(expense.businessDate)}
                  </Td>
                  <Td>
                    <span className={expense.isVoided ? 'line-through' : 'font-medium'}>
                      {expense.categoryNameBn}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {expense.scope === 'order'
                        ? t('expense.scopeOrder')
                        : t('expense.scopePeriod')}
                    </div>
                    {expense.isVoided && (
                      <Badge tone="danger" dot>
                        {t('expense.voided')}
                      </Badge>
                    )}
                  </Td>
                  <Td className="tabular text-xs">
                    {expense.order && expense.orderCode ? (
                      <Link
                        href={`/owner/orders/${expense.order}`}
                        className="font-semibold hover:underline"
                      >
                        {expense.orderCode}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-sm">
                    {expense.payee && expense.payeeNameBn ? (
                      <Link
                        href={`/owner/payees/${expense.payee}`}
                        className="font-medium hover:underline"
                      >
                        {expense.payeeNameBn}
                      </Link>
                    ) : (
                      (expense.payeeNameBn ?? '—')
                    )}
                  </Td>
                  <Td className="tabular text-right font-semibold">
                    {formatMoney(expense.amount)}
                  </Td>
                  <Td>
                    <Badge tone={expense.paymentStatus === 'paid' ? 'success' : 'warning'} dot>
                      {expense.paymentStatus === 'paid' ? t('expense.paid') : t('expense.unpaid')}
                    </Badge>
                    {expense.paidFrom && (
                      <div className="text-xs text-muted-foreground">
                        {tPaidFrom(expense.paidFrom)}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right">
                    {!expense.isVoided && (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(expense)}>
                        {t('expense.void')}
                      </Button>
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
        </>
      )}

      {creating && (
        <ExpenseModal
          categories={categories.data?.categories ?? []}
          onClose={() => setCreating(false)}
        />
      )}

      {managing && (
        <CategoriesModal
          categories={categories.data?.categories ?? []}
          onClose={() => setManaging(false)}
        />
      )}

      {voiding && <VoidExpenseModal expense={voiding} onClose={() => setVoiding(null)} />}

      {explaining && totals && (
        <TotalsWhyModal totals={totals} onClose={() => setExplaining(false)} />
      )}
    </>
  );
}

/* --------------------------------------------------------------- the form -- */

/**
 * The order an order-scope expense belongs to.
 *
 * Searched by code rather than picked from a dropdown of every order there has
 * ever been: the owner is holding a courier receipt with a code printed on it,
 * and the API wants that order's identifier.
 */
function OrderPicker({
  value,
  code,
  onChange,
  error,
  required,
}: {
  value: string;
  code: string;
  onChange: (id: string, code: string) => void;
  error?: string;
  required?: boolean;
}) {
  const [term, setTerm] = useState('');
  const search = useDebounced(term);

  const orders = useQuery({
    queryKey: ['owner', 'orders', 'expense-picker', search],
    queryFn: () =>
      api.get<Paged<'orders', Order>>(
        `/owner/orders?limit=8&q=${encodeURIComponent(search)}`
      ),
    enabled: search.trim().length >= 2 && !value,
  });

  if (value) {
    return (
      <Field label={t('expense.order')} error={error} required={required}>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
          <span className="tabular font-semibold">{code}</span>
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="text-xs font-semibold text-danger"
          >
            {t('app.clear')}
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field
      label={t('expense.order')}
      htmlFor="orderSearch"
      hint={t('expense.orderHint')}
      error={error}
      required={required}
    >
      <Input
        id="orderSearch"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        autoComplete="off"
      />
      {orders.isFetching && <p className="mt-1.5 text-xs text-muted-foreground">{t('app.loading')}</p>}
      {orders.isSuccess && orders.data.orders.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">{t('app.noResults')}</p>
      )}
      {orders.isSuccess && orders.data.orders.length > 0 && (
        <ul className="mt-2 space-y-1">
          {orders.data.orders.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => onChange(order.id, order.orderCode)}
                className="tap flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="tabular font-semibold">{order.orderCode}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {order.customer.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

function ExpenseModal({
  categories,
  onClose,
}: {
  categories: ExpenseCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [orderId, setOrderId] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid'>('paid');
  const [paidFrom, setPaidFrom] = useState('cash');
  const [date, setDate] = useState(businessDate());
  const [note, setNote] = useState('');

  const payees = useQuery({
    queryKey: ['owner', 'payees'],
    queryFn: () => api.get<{ payees: Payee[] }>('/owner/payees'),
  });

  const category = categories.find((item) => item.id === categoryId);
  /*
   * The category's scope drives the form. An `order` category must name an order
   * and a `period` one must not; sending the wrong one is a 400 the API refuses
   * with WRONG_EXPENSE_SCOPE, so the field simply does not exist when it would
   * be wrong. See docs/adr/0027.
   */
  const allowsOrder = category ? category.scope !== 'period' : false;
  const requiresOrder = category?.scope === 'order';

  const unpaid = paymentStatus === 'unpaid';
  // An unpaid expense owed to nobody is not actionable: there is no due to clear.
  const payeeMissing = unpaid && !payeeId;

  const save = useMutation({
    mutationFn: () =>
      api.post<{ expense: Expense }>('/owner/expenses', {
        categoryId,
        amount: Number(amount),
        ...(allowsOrder && orderId ? { orderId } : {}),
        ...(payeeId ? { payeeId } : {}),
        paymentStatus,
        ...(paymentStatus === 'paid' ? { paidFrom } : {}),
        date,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      // An unpaid expense raises a payee's due, so that list moves too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner', 'expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'payees'] }),
      ]);
      onClose();
    },
  });

  const errors = fieldErrors(save.error);

  const valid =
    Boolean(categoryId) &&
    checkMoney(amount).ok &&
    !payeeMissing &&
    (!requiresOrder || Boolean(orderId));

  return (
    <Modal
      open
      onClose={onClose}
      dirty={Boolean(categoryId) || Boolean(amount)}
      title={t('expense.new')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field
        label={t('expense.category')}
        htmlFor="categoryId"
        hint={
          category
            ? category.scope === 'period'
              ? t('expense.scopePeriodHint')
              : category.scope === 'order'
                ? t('expense.scopeOrderHint')
                : // `both` may go either way, so it gets the rule for the case
                  // that has a field attached to it.
                  `${t('expense.scopeBoth')} — ${t('expense.scopeOrderHint')}`
            : undefined
        }
        error={errors.categoryId ?? errors.scope}
        required
      >
        <Select
          id="categoryId"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            // A period category must carry no order, so switching clears it
            // rather than sending something the API will refuse.
            const next = categories.find((item) => item.id === event.target.value);
            if (next && next.scope === 'period') {
              setOrderId('');
              setOrderCode('');
            }
          }}
        >
          <option value="">{t('expense.category')}</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nameBn}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t('expense.amount')}
        htmlFor="amount"
        error={errors.amount ?? moneyError(amount)}
        required
      >
        <MoneyInput
          id="amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoFocus
        />
      </Field>

      {allowsOrder && (
        <OrderPicker
          value={orderId}
          code={orderCode}
          onChange={(id, code) => {
            setOrderId(id);
            setOrderCode(code);
          }}
          error={errors.orderId}
          required={requiresOrder}
        />
      )}

      <Field label={t('expense.paymentStatus')} htmlFor="paymentStatus">
        <Select
          id="paymentStatus"
          value={paymentStatus}
          onChange={(event) => setPaymentStatus(event.target.value as 'paid' | 'unpaid')}
        >
          <option value="paid">{t('expense.paid')}</option>
          <option value="unpaid">{t('expense.unpaid')}</option>
        </Select>
      </Field>

      {/*
       * Unpaid without a payee is a 400 (PAYEE_REQUIRED), and on an account with
       * no parties at all the select below cannot fix it. So it links out.
       */}
      {unpaid && payees.isSuccess && payees.data.payees.length === 0 && (
        <Alert tone="primary" title={t('costSetup.next')}>
          {t('costSetup.thenPayee')}{' '}
          <Link href="/owner/payees" className="font-semibold underline">
            {t('nav.payees')}
          </Link>
        </Alert>
      )}

      <Field
        label={t('expense.payee')}
        htmlFor="payeeId"
        hint={unpaid ? t('expense.unpaidHint') : t('app.optional')}
        error={errors.payeeId ?? (payeeMissing ? t('expense.unpaidHint') : undefined)}
        required={unpaid}
      >
        <Select id="payeeId" value={payeeId} onChange={(event) => setPayeeId(event.target.value)}>
          <option value="">{t('expense.payee')}</option>
          {(payees.data?.payees ?? []).map((payee) => (
            <option key={payee.id} value={payee.id}>
              {payee.nameBn}
            </option>
          ))}
        </Select>
      </Field>

      {/* A label, not an account: there is no cash book. See docs/adr/0027. */}
      {!unpaid && (
        <Field label={t('expense.paidFrom')} htmlFor="paidFrom" error={errors.paidFrom}>
          <Select
            id="paidFrom"
            value={paidFrom}
            onChange={(event) => setPaidFrom(event.target.value)}
          >
            {PAID_FROM.map((method) => (
              <option key={method} value={method}>
                {tPaidFrom(method)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label={t('expense.date')} htmlFor="date" error={errors.date}>
        <Input
          id="date"
          type="date"
          max={businessDate()}
          className="tabular"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>

      <Field label={t('app.notes')} htmlFor="note" hint={t('app.optional')} error={errors.note}>
        <Textarea id="note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Modal>
  );
}

/** Voiding keeps the row and reverses its due. It is not a delete. */
function VoidExpenseModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const voidIt = useMutation({
    mutationFn: () =>
      api.post<{ expense: Expense }>(`/owner/expenses/${expense.id}/void`, { reason }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner', 'expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'payees'] }),
      ]);
      onClose();
    },
  });

  const errors = fieldErrors(voidIt.error);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('expense.void')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={voidIt.isPending}
            disabled={reason.trim().length < 2}
            onClick={() => voidIt.mutate()}
          >
            {t('expense.void')}
          </Button>
        </>
      }
    >
      {voidIt.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(voidIt.error)}</Alert>
      )}

      <p className="mb-1 text-sm">
        {expense.categoryNameBn} · <span className="tabular">{formatMoney(expense.amount)}</span> ·{' '}
        <span className="tabular">{formatDate(expense.businessDate)}</span>
      </p>
      <p className="mb-4 text-xs text-muted-foreground">{t('expense.voidHelp')}</p>

      <Field label={t('expense.voidReason')} htmlFor="void-reason" error={errors.reason} required>
        <Textarea
          id="void-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------- categories -- */

/**
 * The categories, managed from the screen they are used on.
 *
 * Archived rather than deleted, because an expense snapshots the name it was
 * filed under and a deleted category would leave last month's report unreadable.
 */
function CategoriesModal({
  categories,
  onClose,
}: {
  categories: ExpenseCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [nameBn, setNameBn] = useState('');
  const [scope, setScope] = useState<'order' | 'period' | 'both'>('period');

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['owner', 'expense-categories'] });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ category: ExpenseCategory }>('/owner/expense-categories', {
        nameBn: nameBn.trim(),
        scope,
      }),
    onSuccess: async () => {
      setNameBn('');
      await refresh();
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.del(`/owner/expense-categories/${id}`),
    onSuccess: () => refresh(),
  });

  const seed = useMutation({
    mutationFn: () =>
      api.post<{ created: number; categories: ExpenseCategory[] }>(
        '/owner/expense-categories/seed'
      ),
    onSuccess: () => refresh(),
  });

  const errors = fieldErrors(create.error);
  const failure = create.error ?? archive.error ?? seed.error;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('expense.categories')}
      footer={
        <Button variant="outline" onClick={onClose}>
          {t('app.close')}
        </Button>
      }
    >
      {failure && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(failure)}</Alert>
      )}

      {categories.length === 0 ? (
        <div className="mb-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('expense.help')}</p>
          <Button full loading={seed.isPending} onClick={() => seed.mutate()}>
            {t('expense.seedCategories')}
          </Button>
        </div>
      ) : (
        <ul className="mb-4 divide-y divide-border">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{category.nameBn}</p>
                <p className="text-xs text-muted-foreground">
                  {category.scope === 'order'
                    ? t('expense.scopeOrder')
                    : category.scope === 'period'
                      ? t('expense.scopePeriod')
                      : t('expense.scopeBoth')}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={archive.isPending && archive.variables === category.id}
                onClick={() => archive.mutate(category.id)}
              >
                {t('app.close')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-bold">{t('expense.newCategory')}</h3>

        <Field
          label={t('expense.categoryName')}
          htmlFor="categoryName"
          error={errors.nameBn}
          required
        >
          <Input
            id="categoryName"
            value={nameBn}
            onChange={(event) => setNameBn(event.target.value)}
          />
        </Field>

        <Field
          label={t('expense.categoryScope')}
          htmlFor="categoryScope"
          hint={scope === 'order' ? t('expense.scopeOrderHint') : t('expense.scopePeriodHint')}
          error={errors.scope}
        >
          <Select
            id="categoryScope"
            value={scope}
            onChange={(event) => setScope(event.target.value as 'order' | 'period' | 'both')}
          >
            <option value="period">{t('expense.scopePeriod')}</option>
            <option value="order">{t('expense.scopeOrder')}</option>
            <option value="both">{t('expense.scopeBoth')}</option>
          </Select>
        </Field>

        <Button
          full
          loading={create.isPending}
          disabled={nameBn.trim().length < 2}
          onClick={() => create.mutate()}
        >
          <Plus className="h-4 w-4" />
          {t('expense.newCategory')}
        </Button>
      </div>
    </Modal>
  );
}
