'use client';

/**
 * The small pieces the expense screen and its sheets share: the payment
 * methods, the scope words, the totals strip and its explanation, and the order
 * lookup an order-scope expense needs.
 */

import { useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { t } from '@/lib/i18n/bn';
import { formatMoney } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import type { ExpenseCategory } from '@/lib/types';
import { useGetOwnerOrdersInfiniteQuery } from '@/lib/store/endpoints/orders';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

export const PAID_FROM = ['cash', 'bkash', 'nagad', 'rocket', 'bank'] as const;

/**
 * A scope in the owner's words. "সারা দিনের" read as "this one day only" to an
 * owner filing a monthly rent, so the period scope is called what it is in a
 * shop's own books: সাধারণ খরচ, the cost of running the business.
 */
export function scopeLabel(scope: ExpenseCategory['scope']): string {
  if (scope === 'order') return t('expense.scopeOrder');
  if (scope === 'period') return t('expense.scopeGeneral');
  return t('expense.scopeBoth');
}

/** What picking a category of this scope means for the form below it. */
export function scopeHint(scope: ExpenseCategory['scope']): string {
  if (scope === 'order') return t('expense.scopeOrderHint');
  if (scope === 'period') return t('expense.scopeGeneralHint');
  return t('expense.scopeBothHint');
}

/** One figure in the strip under the filters. */
export function MoneyCell({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2">
      <p className="text-[0.6875rem] font-medium text-muted-foreground">{label}</p>
      <p className={`tabular mt-0.5 leading-tight ${strong ? 'text-lg font-bold' : 'text-base font-semibold'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 hidden text-[0.6875rem] text-muted-foreground sm:block">{hint}</p>}
    </div>
  );
}

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
 * Where the figures in the strip come from, and why the unpaid one is not added.
 *
 * The rule is the one the printed sheet follows, so screen and paper agree: an
 * order cost and a general cost are each shown, their sum is the total, and the
 * unpaid figure is a slice of that total rather than an addition to it. A day's
 * labour and one parcel's courier bill answer different questions; the sum is
 * shown, but under them, never as the headline. See docs/adr/0027.
 */
export function TotalsWhyModal({
  totals,
  onClose,
}: {
  totals: { all: number; order: number; period: number; unpaid: number };
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
        label={t('expense.scopeGeneral')}
        note={t('expense.scopeGeneralHint')}
        value={formatMoney(totals.period)}
      />
      <WhyLine label={t('expense.totalAll')} value={formatMoney(totals.all)} strong />

      {/* A slice of the total above, not an addition to it: some of each is still owed. */}
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

/**
 * The order an order-scope expense belongs to.
 *
 * Searched by code rather than picked from a dropdown of every order there has
 * ever been: the owner is holding a courier receipt with a code printed on it,
 * and the API wants that order's identifier.
 */
export function OrderPicker({
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
  const search = useDebounced(term).trim();

  // The orders list's own endpoint with a small page: one cache entry per term.
  const orders = useGetOwnerOrdersInfiniteQuery(
    search.length >= 2 && !value ? { q: search, limit: 8 } : skipToken
  );
  const found = orders.data?.pages[0]?.orders ?? [];

  if (value) {
    return (
      <Field label={t('expense.order')} error={error} required={required}>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border py-1 pl-3 pr-1">
          <span className="tabular font-semibold">{code}</span>
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="tap rounded-lg px-3 text-xs font-semibold text-danger hover:bg-muted"
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
        type="search"
        value={term}
        invalid={Boolean(error)}
        onChange={(event) => setTerm(event.target.value)}
        autoComplete="off"
      />
      {orders.isFetching && <p className="mt-1.5 text-xs text-muted-foreground">{t('app.loading')}</p>}
      {orders.isSuccess && !orders.isFetching && found.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">{t('app.noResults')}</p>
      )}
      {found.length > 0 && (
        <ul className="mt-2 space-y-1">
          {found.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => onChange(order.id, order.orderCode)}
                className="tap flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="tabular font-semibold">{order.orderCode}</span>
                <span className="truncate text-xs text-muted-foreground">{order.customer.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}
