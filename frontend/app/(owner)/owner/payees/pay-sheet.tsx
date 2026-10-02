'use client';

import { useRef, useState } from 'react';
import { fieldErrors } from '@/lib/api';
import { t, tf, tMethod } from '@/lib/i18n/bn';
import { businessDate, formatMoney } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Payee } from '@/lib/types';
import { usePayPayeeMutation } from '@/lib/store/endpoints/cost';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, FormErrorSummary, Input, MoneyInput, Select, Textarea, focusFirstInvalid } from '@/components/ui/form';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { amountInWords } from '@/lib/amount-words';
import { entryErrorMessage, nonceFor, payeeState, runningText } from './payee-money';

export const PAID_FROM = ['cash', 'bkash', 'nagad', 'rocket', 'bank'] as const;

/*
 * From here a payment is read back once before it goes. Below it a payment is
 * routine and a second screen would only slow the owner down at the market.
 */
const LARGE_PAYMENT = 10_000;

/**
 * Paying a পার্টি, from the list or from their খাতা.
 *
 * Paying more than the due is legitimate in this trade — it becomes an advance
 * (বায়না) — and the API never refuses it, so nothing here caps the amount
 * (docs/adr/0025). What the sheet does instead is say so before it happens, and
 * read a large or an over-the-due amount back in words, because one zero too
 * many on a phone keypad is the mistake this screen exists to catch.
 *
 * Mount it only while open: the nonce below is one per opening.
 */
export function PaySheet({ payee, onClose }: { payee: Payee; onClose: () => void }) {
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const [amount, setAmount] = useState('');
  const [paidFrom, setPaidFrom] = useState<string>('cash');
  const [date, setDate] = useState(businessDate());
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /*
   * One key per payment, not per click. A double tap, or a retry after a
   * timeout that actually went through, reuses it and the API refuses the
   * second write rather than paying the man twice. A corrected amount after a
   * failure is a different payment and gets a fresh key (see `nonceFor`).
   */
  const sent = useRef<{ key: string; nonce: string } | null>(null);

  const [pay, payState] = usePayPayeeMutation();
  const errors = fieldErrors(payState.error);

  const check = checkMoney(amount);
  const state = payeeState(payee.due);
  const due = Math.max(payee.due, 0);
  const over = check.ok && check.value > due;
  const after = check.ok ? payee.due - check.value : payee.due;

  const send = async () => {
    if (!check.ok) return;
    const body = {
      amount: check.value,
      paidFrom,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(date && date !== businessDate() ? { date } : {}),
    };
    try {
      await pay({ id: payee.id, ...body, nonce: nonceFor(sent, body) }).unwrap();
      toast(tf('payee.paidToast', { name: payee.nameBn, amount: formatMoney(check.value) }));
      onClose();
    } catch {
      // Shown inline below; a field error goes back to the form beside its field.
      setConfirming(false);
    }
  };

  const submit = () => {
    setTried(true);
    if (!check.ok) {
      requestAnimationFrame(() => focusFirstInvalid(root.current));
      return;
    }
    if (check.value >= LARGE_PAYMENT || over) {
      setConfirming(true);
      return;
    }
    void send();
  };

  const amountError = errors.amount ?? (tried || amount ? moneyError(amount) : undefined);
  const generalError =
    payState.error && !Object.keys(errors).length ? entryErrorMessage(payState.error) : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={confirming ? t('payee.confirmPayTitle') : t('payee.pay')}
      dirty={amount.trim().length > 0 || note.trim().length > 0}
      footerLead={
        <>
          <FormErrorSummary message={generalError} />
          {check.ok && !confirming && (
            <p className="tabular text-sm text-muted-foreground">{runningText(after)}</p>
          )}
        </>
      }
      footer={
        confirming ? (
          <>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={payState.isLoading}>
              {t('payee.editAmount')}
            </Button>
            <Button loading={payState.isLoading} onClick={() => void send()}>
              {tf('payee.payVerb', { amount: check.ok ? formatMoney(check.value) : '' })}
            </Button>
          </>
        ) : (
          <>
            <ModalCancel />
            <Button loading={payState.isLoading} onClick={submit}>
              {t('payee.pay')}
            </Button>
          </>
        )
      }
    >
      {confirming && check.ok ? (
        <div>
          <p className="mb-1 text-sm text-muted-foreground">{payee.nameBn}</p>
          <p className="tabular text-3xl font-bold">{formatMoney(check.value)}</p>
          <p className="mt-1 text-sm font-medium">
            {tf('payee.inWords', { words: amountInWords(check.value) })}
          </p>
          <dl className="mt-4 divide-y divide-border rounded-xl border border-border text-sm">
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-muted-foreground">{state.label}</dt>
              <dd className="tabular">{state.value}</dd>
            </div>
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-muted-foreground">{t('payee.paidFrom')}</dt>
              <dd>{tMethod(paidFrom)}</dd>
            </div>
            <div className="flex justify-between gap-3 px-4 py-2.5 font-semibold">
              <dt>{t('app.after')}</dt>
              <dd className="tabular">{runningText(after)}</dd>
            </div>
          </dl>
          {over && (
            <Alert tone="warning" className="mt-4">
              {due > 0
                ? tf('payee.overpay', {
                    due: formatMoney(due),
                    amount: formatMoney(check.value),
                    extra: formatMoney(check.value - due),
                  })
                : tf('payee.overpayNoDue', { amount: formatMoney(check.value) })}
            </Alert>
          )}
        </div>
      ) : (
        <div ref={root}>
          <p className="mb-4 text-sm text-muted-foreground">
            {payee.nameBn} · {state.label}{' '}
            <span className={cn('tabular font-semibold', state.ink)}>{state.value}</span>
          </p>

          <Field label={t('payee.payAmount')} htmlFor="pay-amount" error={amountError} required>
            <MoneyInput
              id="pay-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              invalid={Boolean(amountError)}
              autoFocus
            />
          </Field>

          {/* The whole due in one tap: the commonest payment is "clear him". */}
          {due > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(due))}
              className="tap -mt-2 mb-3 inline-flex items-center rounded-full border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              {tf('payee.fullDue', { amount: formatMoney(due) })}
            </button>
          )}

          {check.ok && (
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">
              {tf('payee.inWords', { words: amountInWords(check.value) })}
            </p>
          )}

          {over && (
            <Alert tone="warning">
              {due > 0
                ? tf('payee.overpay', {
                    due: formatMoney(due),
                    amount: formatMoney(check.value),
                    extra: formatMoney(check.value - due),
                  })
                : tf('payee.overpayNoDue', { amount: formatMoney(check.value) })}
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {/* A label, not an account: there is no cash book. See PLAN-3 decision 20. */}
            <Field label={t('payee.paidFrom')} htmlFor="pay-from" error={errors.paidFrom}>
              <Select id="pay-from" value={paidFrom} onChange={(event) => setPaidFrom(event.target.value)}>
                {PAID_FROM.map((method) => (
                  <option key={method} value={method}>
                    {tMethod(method)}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Money handed over yesterday is written down today; the day it belongs to is asked. */}
            <Field label={t('payee.payDate')} htmlFor="pay-date" error={errors.date}>
              <Input
                id="pay-date"
                type="date"
                max={businessDate()}
                className="tabular"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
          </div>

          <Field label={t('app.notes')} htmlFor="pay-note" hint={t('app.optional')} error={errors.note}>
            <Textarea id="pay-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
