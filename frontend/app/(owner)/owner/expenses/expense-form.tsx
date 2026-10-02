'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf, tMethod } from '@/lib/i18n/bn';
import { businessDate, formatMoney, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { ExpenseCategory } from '@/lib/types';
import { useCreateExpenseMutation, useGetPayeesQuery } from '@/lib/store/endpoints/cost';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import {
  Field,
  FormErrorSummary,
  Input,
  MoneyInput,
  Select,
  Textarea,
  focusFirstInvalid,
} from '@/components/ui/form';
import { Segmented } from '@/components/ui/toolbar';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { OrderPicker, PAID_FROM, scopeHint } from './expense-parts';

const LAST_CATEGORY = 'cm.expense.lastCategory';

/** Device storage can be missing or refuse (a private window); the form works without it. */
function readLast(): string {
  try {
    return window.localStorage.getItem(LAST_CATEGORY) ?? '';
  } catch {
    return '';
  }
}

function writeLast(id: string) {
  try {
    window.localStorage.setItem(LAST_CATEGORY, id);
  } catch {
    // Remembering is a convenience; failing to is not worth a word.
  }
}

/**
 * Writing down an expense.
 *
 * The category comes first, as a row of chips with the last one used already
 * picked: most days it is the same labour or the same courier bill again, and
 * one tap beats opening a dropdown. Its scope then decides whether an order
 * field exists at all — an `order` category must name an order and a `period`
 * one must not, which the API refuses with WRONG_EXPENSE_SCOPE.
 *
 * Save is never greyed out. On submit the missing fields are marked, the first
 * is scrolled to, and a one-line summary says how many are left.
 */
export function ExpenseModal({
  categories,
  onClose,
}: {
  categories: ExpenseCategory[];
  onClose: () => void;
}) {
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);

  // The last category used, if it still exists, is picked already and listed first.
  const [initialCategory] = useState(() => {
    const last = readLast();
    return categories.some((item) => item.id === last) ? last : '';
  });
  const ordered = initialCategory
    ? [
        ...categories.filter((item) => item.id === initialCategory),
        ...categories.filter((item) => item.id !== initialCategory),
      ]
    : categories;

  const [categoryId, setCategoryId] = useState(initialCategory);
  const [amount, setAmount] = useState('');
  const [orderId, setOrderId] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid'>('paid');
  const [paidFrom, setPaidFrom] = useState('cash');
  const [date, setDate] = useState(businessDate());
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const payees = useGetPayeesQuery();
  const [create, createState] = useCreateExpenseMutation();
  const errors = fieldErrors(createState.error);

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

  const missing = {
    category: !categoryId,
    amount: !checkMoney(amount).ok,
    order: requiresOrder && !orderId,
    // An unpaid expense owed to nobody is not actionable: there is no due to clear.
    payee: unpaid && !payeeId,
  };
  const missingCount = Object.values(missing).filter(Boolean).length;

  const save = async () => {
    setTried(true);
    if (missingCount > 0) {
      requestAnimationFrame(() => focusFirstInvalid(root.current));
      return;
    }
    try {
      await create({
        categoryId,
        amount: Number(amount),
        ...(allowsOrder && orderId ? { orderId } : {}),
        ...(payeeId ? { payeeId } : {}),
        paymentStatus,
        ...(paymentStatus === 'paid' ? { paidFrom } : {}),
        date,
        ...(note.trim() ? { note: note.trim() } : {}),
      }).unwrap();
      writeLast(categoryId);
      toast(
        tf('expense.savedToast', {
          category: category?.nameBn ?? '',
          amount: formatMoney(Number(amount)),
        })
      );
      onClose();
    } catch {
      // Field errors land beside their fields; anything else above the buttons.
    }
  };

  const categoryError = errors.categoryId ?? errors.scope ?? (tried && missing.category ? t('app.required') : undefined);
  const amountError = errors.amount ?? (tried || amount ? moneyError(amount) : undefined);
  const orderError = errors.orderId ?? (tried && missing.order ? t('app.required') : undefined);
  // Said only once Save was pressed: an unpaid switch is not a mistake by itself.
  const payeeError = errors.payeeId ?? (tried && missing.payee ? t('expense.payeeRequired') : undefined);

  const summary =
    tried && missingCount > 0
      ? tf('app.fieldsMissing', { count: formatNumber(missingCount) })
      : createState.error && !Object.keys(errors).length
        ? errorMessage(createState.error)
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      dirty={Boolean(amount) || Boolean(note.trim()) || Boolean(orderId) || Boolean(payeeId)}
      title={t('expense.new')}
      footerLead={<FormErrorSummary message={summary} />}
      footer={
        <>
          <ModalCancel />
          <Button loading={createState.isLoading} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={root}>
        <Field label={t('expense.category')} error={categoryError} required>
          <div role="radiogroup" aria-label={t('expense.category')} className="flex flex-wrap gap-2">
            {ordered.map((item, index) => {
              const active = item.id === categoryId;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-invalid={categoryError && index === 0 ? true : undefined}
                  onClick={() => {
                    setCategoryId(item.id);
                    // A period category must carry no order, so switching clears it
                    // rather than sending something the API will refuse.
                    if (item.scope === 'period') {
                      setOrderId('');
                      setOrderCode('');
                    }
                  }}
                  className={cn(
                    'min-h-11 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary-softer font-semibold text-primary-ink'
                      : 'border-border text-foreground hover:bg-muted'
                  )}
                >
                  {item.nameBn}
                </button>
              );
            })}
          </div>
          {category && <p className="mt-1.5 text-xs text-muted-foreground">{scopeHint(category.scope)}</p>}
        </Field>

        <Field label={t('expense.amount')} htmlFor="expense-amount" error={amountError} required>
          <MoneyInput
            id="expense-amount"
            value={amount}
            invalid={Boolean(amountError)}
            onChange={(event) => setAmount(event.target.value)}
            // Straight to the keypad when the category is already picked.
            autoFocus={Boolean(initialCategory)}
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
            error={orderError}
            required={requiresOrder}
          />
        )}

        <Field label={t('expense.paymentStatus')}>
          <Segmented
            label={t('expense.paymentStatus')}
            value={paymentStatus}
            onChange={setPaymentStatus}
            options={[
              { value: 'paid', label: t('expense.paid') },
              { value: 'unpaid', label: t('expense.unpaid') },
            ]}
          />
          {unpaid && <p className="mt-1.5 text-xs text-muted-foreground">{t('expense.unpaidHint')}</p>}
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

        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field
            label={t('expense.payee')}
            htmlFor="expense-payee"
            hint={unpaid ? undefined : t('app.optional')}
            error={payeeError}
            required={unpaid}
          >
            <Select
              id="expense-payee"
              value={payeeId}
              aria-invalid={payeeError ? true : undefined}
              onChange={(event) => setPayeeId(event.target.value)}
            >
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
            <Field label={t('expense.paidFrom')} htmlFor="expense-paid-from" error={errors.paidFrom}>
              <Select
                id="expense-paid-from"
                value={paidFrom}
                onChange={(event) => setPaidFrom(event.target.value)}
              >
                {PAID_FROM.map((method) => (
                  <option key={method} value={method}>
                    {tMethod(method)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label={t('expense.date')} htmlFor="expense-date" error={errors.date}>
            <Input
              id="expense-date"
              type="date"
              max={businessDate()}
              className="tabular"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        </div>

        <Field label={t('app.notes')} htmlFor="expense-note" hint={t('app.optional')} error={errors.note}>
          <Textarea id="expense-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
