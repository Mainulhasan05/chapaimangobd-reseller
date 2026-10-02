'use client';

import { useRef, useState } from 'react';
import { PackageOpen, Plus, TriangleAlert } from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tPaidFrom } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { useGetOrderQuery, useGetPackagingEstimateQuery } from '@/lib/store/endpoints/orders';
import {
  useCreateExpenseMutation,
  useGetExpenseCategoriesQuery,
  useGetPayeesQuery,
} from '@/lib/store/endpoints/cost';
import { Alert, Badge, Card, CardHeader, ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button, ButtonLink } from '@/components/ui/button';
import { Modal, ModalCancel } from '@/components/ui/modal';
import {
  Field,
  FormErrorSummary,
  MoneyInput,
  Select,
  Textarea,
  focusFirstInvalid,
} from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';

/**
 * What this parcel cost the owner, and what packing it takes.
 *
 * The owner's side of the books, on the owner's copy of the order only. A
 * reseller never sees any of it: `order.totals` is what they are party to, and
 * everything here is money going out that is billed to nobody. See
 * docs/adr/0027.
 */

/**
 * Two figures that look alike and are not: what was billed for delivery, and
 * what the courier was actually paid. The second is an order-scope expense and
 * lives in `cost.items`; the first is revenue. The app held only the first until
 * PLAN-3, and adding them together is the mistake this layout exists to prevent.
 */
function CostRow({ label, value, hint, tone }: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'danger' | 'success' | 'muted';
}) {
  const colour =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : '';
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className={`tabular shrink-0 text-sm font-medium ${colour}`}>{formatMoney(value)}</div>
    </div>
  );
}

/**
 * The cost block travels on the order response itself, so this reads the cache
 * entry the order page already filled rather than asking again.
 */
export function OrderCostPanel({ id }: { id: string }) {
  const query = useGetOrderQuery({ role: 'owner', id });
  const [adding, setAdding] = useState(false);
  const cost = query.data?.cost;

  if (query.isLoading) return <Card><ListSkeleton rows={3} /></Card>;
  // The order page above already says when the order itself failed; this says
  // the costs did, rather than the panel quietly not being there.
  if (query.isError && !cost) {
    return (
      <Card>
        <CardHeader title={t('cost.title')} />
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
      </Card>
    );
  }
  if (!cost) return null;

  const isLoss = cost.margin < 0;

  return (
    <Card id="order-cost" className="scroll-mt-20">
      <CardHeader
        title={t('cost.title')}
        action={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            {t('cost.addExpense')}
          </Button>
        }
      />
      {adding && <OrderExpenseModal orderId={id} onClose={() => setAdding(false)} />}

      <div className="divide-y divide-border">
        <CostRow label={t('cost.goods')} value={cost.goods} />
        <CostRow label={t('cost.packaging')} value={cost.packaging} />
        <CostRow label={t('cost.expenses')} value={cost.expenses} />
        <CostRow label={t('cost.total')} value={cost.total} />
        <CostRow label={t('cost.revenue')} value={cost.revenue} hint={t('profit.revenueHint')} />
        <CostRow
          label={isLoss ? t('cost.loss') : t('cost.margin')}
          value={cost.margin}
          tone={isLoss ? 'danger' : 'success'}
        />
        {/*
          * Beside the margin rather than inside it: this is what the reseller was
          * charged for delivery, and the courier's own bill is one of the expenses
          * above. Presented so the two can be compared, never netted for the reader.
          */}
        <CostRow
          label={t('cost.deliveryCharged')}
          value={cost.deliveryCharged}
          hint={t('profit.deliveryGapHint')}
          tone="muted"
        />
      </div>

      {cost.items.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {cost.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                {item.categoryNameBn}
                {item.payeeNameBn && (
                  <span className="text-muted-foreground"> · {item.payeeNameBn}</span>
                )}
                {item.paymentStatus === 'unpaid' && (
                  <Badge tone="warning" className="ml-2">
                    {t('expense.unpaid')}
                  </Badge>
                )}
              </span>
              <span className="tabular shrink-0">{formatMoney(item.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * What packing this order is expected to take.
 *
 * Shown from accept onwards, long before anything is deducted, because the point
 * is to find out that কাগজ has run out while there is still time to buy more —
 * not at the packing table. Every figure says it is an estimate, because the
 * recipe says "about one and a half sheets" and nobody counted. See
 * docs/adr/0026.
 *
 * Rows rather than a table: four columns in a sideways scroller on a phone hid
 * the cost column, which is the one the owner opened this to read.
 */
export function PackagingPanel({ id }: { id: string }) {
  const estimate = useGetPackagingEstimateQuery({ id });

  if (estimate.isLoading) return <Card><ListSkeleton rows={2} /></Card>;
  if (estimate.isError && !estimate.data) {
    return (
      <Card>
        <CardHeader title={t('packaging.title')} />
        <ErrorState
          onRetry={() => estimate.refetch()}
          isRetrying={estimate.isFetching}
          error={estimate.error}
        />
      </Card>
    );
  }
  if (!estimate.data) return null;

  const { rows, cost, shortages, isRecorded, recordedCost } = estimate.data;

  return (
    <Card>
      <CardHeader
        title={t('packaging.title')}
        subtitle={isRecorded ? undefined : t('packaging.estimateHint')}
        action={
          <Badge tone={isRecorded ? 'success' : 'neutral'}>
            {isRecorded ? t('packaging.recorded') : t('packaging.estimate')}
          </Badge>
        }
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('packaging.none')}</p>
      ) : (
        <>
          {/*
            * A short shelf is said out loud but never blocks anything: the parcel
            * is real and refusing to record it would be refusing to write down
            * what happened. docs/adr/0026.
            */}
          {shortages.length > 0 && (
            <Alert tone="warning" icon={TriangleAlert} title={t('packaging.shortage')}>
              <div className="text-sm">{t('packaging.shortageHint')}</div>
              <ul className="mt-2 space-y-0.5 text-sm">
                {shortages.map((s) => (
                  <li key={s.supply}>
                    {s.supplyNameBn} — {t('packaging.need')} {formatNumber(s.need)},{' '}
                    {t('supply.onHand')} {formatNumber(s.onHand)}, {t('packaging.short')}{' '}
                    <span className="font-medium">{formatNumber(s.short)}</span>
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.supply} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{row.supplyNameBn}</span>
                  <span className="tabular block text-xs text-muted-foreground">
                    {formatNumber(row.quantity)} × {formatMoney(row.unitCost)}
                  </span>
                </span>
                <span className="tabular shrink-0">{formatMoney(row.cost)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <span className="inline-flex items-center gap-2 text-sm">
              <PackageOpen className="h-4 w-4" />
              {t('packaging.cost')}
            </span>
            <span className="tabular font-medium">
              {formatMoney(isRecorded ? recordedCost : cost)}
            </span>
          </div>
          {!isRecorded && (
            <p className="mt-1 text-xs text-muted-foreground">{t('recipe.estimateNote')}</p>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * An expense against this one parcel: the courier bill, the home-delivery extra.
 * Mount only while open.
 *
 * Deliberately not a field on the ship dialog, where an earlier draft of the plan
 * put it. A courier bill usually arrives days after the parcel leaves, and the
 * home-delivery extra is a different category, so a field at ship would be the
 * wrong moment for one of them and a second code path for both. This uses the
 * ordinary expense endpoint.
 *
 * Only **order**-scope categories are offered. A period cost like labour belongs
 * to a day, and the API refuses it here. See docs/adr/0027.
 */
function OrderExpenseModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [unpaid, setUnpaid] = useState(false);
  const [paidFrom, setPaidFrom] = useState('cash');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const categories = useGetExpenseCategoriesQuery();
  const payees = useGetPayeesQuery();
  const [save, saveState] = useCreateExpenseMutation();

  // A period category cannot be filed against an order at all.
  const usable = (categories.data?.categories ?? []).filter(
    (c) => !c.isArchived && (c.scope === 'order' || c.scope === 'both')
  );

  const errors = fieldErrors(saveState.error);
  const money = checkMoney(amount);
  // Unpaid and owed to nobody is not actionable; the API refuses it too.
  const needsPayee = unpaid && !payeeId;

  const problems = [!categoryId, !money.ok, needsPayee].filter(Boolean).length;

  const submit = async () => {
    setTried(true);
    if (problems > 0) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    try {
      await save({
        categoryId,
        amount: Number(amount),
        orderId,
        ...(payeeId ? { payeeId } : {}),
        paymentStatus: unpaid ? 'unpaid' : 'paid',
        ...(unpaid ? {} : { paidFrom }),
        ...(note.trim() ? { note: note.trim() } : {}),
      }).unwrap();
      const category = usable.find((c) => c.id === categoryId)?.nameBn ?? '';
      onClose();
      toast(`${category} ${formatMoney(Number(amount))} · ${t('orders.expenseSaved')}`);
    } catch {
      // Shown in the sheet: inline per field, or as the summary above the buttons.
    }
  };

  const noCategories = categories.isSuccess && usable.length === 0;

  return (
    <Modal
      open
      onClose={saveState.isLoading ? () => {} : onClose}
      title={t('cost.addExpense')}
      dirty={Boolean(categoryId || amount || payeeId || note.trim())}
      footerLead={
        saveState.error && !Object.keys(errors).length ? (
          <FormErrorSummary message={errorMessage(saveState.error)} />
        ) : tried && problems > 0 ? (
          <FormErrorSummary message={t('app.fixFields')} />
        ) : undefined
      }
      footer={
        <>
          <ModalCancel disabled={saveState.isLoading} />
          <Button loading={saveState.isLoading} disabled={noCategories} onClick={submit}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef}>
        {noCategories && (
          <Alert tone="warning" title={t('orders.noOrderCategory')}>
            <p className="mb-2">{t('orders.noOrderCategoryHelp')}</p>
            <ButtonLink href="/owner/expenses" size="sm" variant="outline">
              {t('orders.openExpenses')}
            </ButtonLink>
          </Alert>
        )}

        <div data-invalid={(tried && !categoryId) || undefined}>
          <Field
            label={t('expense.category')}
            htmlFor="order-expense-category"
            error={errors.categoryId ?? (tried && !categoryId ? t('orders.pickCategory') : undefined)}
            required
          >
            <Select
              id="order-expense-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{categories.isLoading ? t('customerSms.loading') : t('orders.pickCategory')}</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameBn}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={t('expense.amount')}
          htmlFor="order-expense-amount"
          error={errors.amount ?? (tried || amount ? moneyError(amount) : undefined)}
          required
        >
          <MoneyInput
            id="order-expense-amount"
            value={amount}
            invalid={tried && !money.ok}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        <div data-invalid={(tried && needsPayee) || undefined}>
          <Field
            label={t('expense.payee')}
            htmlFor="order-expense-payee"
            error={errors.payeeId ?? (tried && needsPayee ? t('orders.payeeNeeded') : undefined)}
            hint={unpaid ? t('expense.unpaidHint') : t('app.optional')}
          >
            <Select id="order-expense-payee" value={payeeId} onChange={(e) => setPayeeId(e.target.value)}>
              <option value="">{t('orders.noPayee')}</option>
              {(payees.data?.payees ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameBn}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Switch
          checked={unpaid}
          onChange={setUnpaid}
          label={t('expense.unpaid')}
          hint={t('expense.unpaidHint')}
        />

        {!unpaid && (
          <Field label={t('expense.paidFrom')} htmlFor="order-expense-paid-from">
            <Select id="order-expense-paid-from" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
              {['cash', 'bkash', 'nagad', 'rocket', 'bank'].map((m) => (
                <option key={m} value={m}>
                  {tPaidFrom(m)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('expense.note')} htmlFor="order-expense-note" error={errors.note} hint={t('app.optional')}>
          <Textarea id="order-expense-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
