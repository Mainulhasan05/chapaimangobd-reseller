'use client';

import { useState } from 'react';
import { t, tf, tMethod } from '@/lib/i18n/bn';
import { businessDate, formatMoney } from '@/lib/format';
import { useMarkExpensePaidMutation } from '@/lib/store/endpoints/cost';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Field, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { PAID_FROM } from './expense-parts';

export type MarkPaidTarget = {
  id: string;
  categoryNameBn: string;
  amount: number;
  payeeNameBn?: string | null;
};

/**
 * "দিয়ে দিয়েছি" on an expense that was left unpaid.
 *
 * It used to take a manual payment on the payee's page plus remembering which
 * expense it was for, and the expense itself stayed "এখনো দিইনি" forever. Now one
 * sheet posts the payment and flips the expense together. A wrong one is undone
 * by reversing that payment on the payee's খাতা, which reopens the expense.
 */
export function MarkPaidSheet({ expense, onClose }: { expense: MarkPaidTarget; onClose: () => void }) {
  const toast = useToast();
  const [paidFrom, setPaidFrom] = useState('cash');
  const [date, setDate] = useState(businessDate());
  const [markPaid] = useMarkExpensePaidMutation();

  return (
    <ConfirmSheet
      title={t('expense.markPaidTitle')}
      confirmLabel={tf('expense.markPaidVerb', { amount: formatMoney(expense.amount) })}
      tone="success"
      onClose={onClose}
      onConfirm={async () => {
        await markPaid({
          id: expense.id,
          paidFrom,
          ...(date && date !== businessDate() ? { date } : {}),
        }).unwrap();
        toast(
          tf('expense.markedPaidToast', {
            category: expense.categoryNameBn,
            amount: formatMoney(expense.amount),
          })
        );
      }}
      summary={
        <>
          <p className="font-semibold">{expense.categoryNameBn}</p>
          <p className="tabular text-lg font-bold">{formatMoney(expense.amount)}</p>
        </>
      }
      consequences={
        expense.payeeNameBn
          ? [tf('expense.markPaidDue', { name: expense.payeeNameBn, amount: formatMoney(expense.amount) })]
          : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {/* A label, not an account: there is no cash book. */}
        <Field label={t('expense.paidFrom')} htmlFor="mark-paid-from">
          <Select id="mark-paid-from" value={paidFrom} onChange={(event) => setPaidFrom(event.target.value)}>
            {PAID_FROM.map((method) => (
              <option key={method} value={method}>
                {tMethod(method)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('payee.payDate')} htmlFor="mark-paid-date">
          <Input
            id="mark-paid-date"
            type="date"
            max={businessDate()}
            className="tabular"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
      </div>
    </ConfirmSheet>
  );
}
