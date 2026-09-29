'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageOpen, Plus, TriangleAlert } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tPaidFrom } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import type {
  Expense,
  ExpenseCategory,
  Order,
  OrderCost,
  PackagingEstimate,
  Payee,
} from '@/lib/types';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/layout';
import { Th, Td, Tr, TableWrap } from '@/components/ui/table';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { orderQueryKey } from '@/components/order-page';

/**
 * What this parcel cost the owner, and what packing it takes.
 *
 * The owner's side of the books, on the owner's copy of the order only. A
 * reseller never sees any of it: `order.totals` is what they are party to, and
 * everything here is money going out that is billed to nobody. See
 * docs/adr/0027.
 */

/**
 * The cost block travels on the order response itself, so this reads the cache
 * entry `OrderPage` already filled rather than asking again. Same key, same
 * fetcher, one request.
 */
function useOrderCost(id: string) {
  return useQuery({
    queryKey: orderQueryKey('owner', id),
    queryFn: () => api.get<{ order: Order; cost: OrderCost }>(`/owner/orders/${encodeURIComponent(id)}`),
  });
}

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
      ? 'text-[var(--danger)]'
      : tone === 'success'
        ? 'text-[var(--success)]'
        : tone === 'muted'
          ? 'text-[var(--muted-fg)]'
          : '';
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-[var(--muted-fg)]">{hint}</div>}
      </div>
      <div className={`tabular text-sm font-medium ${colour}`}>{formatMoney(value)}</div>
    </div>
  );
}

export function OrderCostPanel({ id }: { id: string }) {
  const query = useOrderCost(id);
  const [adding, setAdding] = useState(false);
  const cost = query.data?.cost;

  if (query.isLoading) return <Card><ListSkeleton rows={3} /></Card>;
  if (!cost) return null;

  const isLoss = cost.margin < 0;

  return (
    <Card>
      <CardHeader
        title={t('cost.title')}
        action={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            {t('cost.addExpense')}
          </Button>
        }
      />
      <OrderExpenseModal orderId={id} open={adding} onClose={() => setAdding(false)} />

      <div className="divide-y divide-[var(--border)]">
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
        <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-3">
          {cost.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span>
                {item.categoryNameBn}
                {item.payeeNameBn && (
                  <span className="text-[var(--muted-fg)]"> · {item.payeeNameBn}</span>
                )}
                {item.paymentStatus === 'unpaid' && (
                  <Badge tone="warning" className="ml-2">
                    {t('expense.unpaid')}
                  </Badge>
                )}
              </span>
              <span className="tabular">{formatMoney(item.amount)}</span>
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
 */
export function PackagingPanel({ id }: { id: string }) {
  const estimate = useQuery({
    queryKey: ['owner', 'order', id, 'packaging'],
    queryFn: () =>
      api.get<PackagingEstimate>(`/owner/orders/${encodeURIComponent(id)}/packaging-estimate`),
  });

  if (estimate.isLoading) return <Card><ListSkeleton rows={2} /></Card>;
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
        <p className="text-sm text-[var(--muted-fg)]">{t('packaging.none')}</p>
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

          <TableWrap alwaysVisible minWidth="20rem">
            <thead>
              <tr>
                <Th>{t('supply.title')}</Th>
                <Th align="right">{t('supply.quantity')}</Th>
                <Th align="right">{t('supply.unitCost')}</Th>
                <Th align="right">{t('packaging.cost')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.supply}>
                  <Td>{row.supplyNameBn}</Td>
                  <Td align="right" className="tabular">{formatNumber(row.quantity)}</Td>
                  <Td align="right" className="tabular">{formatMoney(row.unitCost)}</Td>
                  <Td align="right" className="tabular">{formatMoney(row.cost)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="inline-flex items-center gap-2 text-sm">
              <PackageOpen className="h-4 w-4" />
              {t('packaging.cost')}
            </span>
            <span className="tabular font-medium">
              {formatMoney(isRecorded ? recordedCost : cost)}
            </span>
          </div>
          {!isRecorded && (
            <p className="mt-1 text-xs text-[var(--muted-fg)]">{t('recipe.estimateNote')}</p>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * An expense against this one parcel: the courier bill, the home-delivery extra.
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
function OrderExpenseModal({
  orderId,
  open,
  onClose,
}: {
  orderId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [unpaid, setUnpaid] = useState(false);
  const [paidFrom, setPaidFrom] = useState('cash');
  const [note, setNote] = useState('');

  const categories = useQuery({
    queryKey: ['owner', 'expense-categories'],
    queryFn: () => api.get<{ categories: ExpenseCategory[] }>('/owner/expense-categories'),
    enabled: open,
  });
  const payees = useQuery({
    queryKey: ['owner', 'payees'],
    queryFn: () => api.get<{ payees: Payee[] }>('/owner/payees'),
    enabled: open,
  });

  // A period category cannot be filed against an order at all.
  const usable = (categories.data?.categories ?? []).filter(
    (c) => c.scope === 'order' || c.scope === 'both'
  );

  const save = useMutation({
    mutationFn: () =>
      api.post<{ expense: Expense }>('/owner/expenses', {
        categoryId,
        amount: Number(amount),
        orderId,
        ...(payeeId ? { payeeId } : {}),
        paymentStatus: unpaid ? 'unpaid' : 'paid',
        ...(unpaid ? {} : { paidFrom }),
        ...(note ? { note } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      onClose();
      setAmount('');
      setNote('');
    },
  });

  const errors = fieldErrors(save.error);
  const money = checkMoney(amount);
  // Unpaid and owed to nobody is not actionable; the API refuses it too.
  const needsPayee = unpaid && !payeeId;

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('cost.addExpense')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!categoryId || !money.ok || needsPayee}
            onClick={() => save.mutate()}
          >
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field label={t('expense.category')} error={errors.categoryId} required>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">-</option>
          {usable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameBn}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('expense.amount')} error={errors.amount ?? moneyError(amount)} required>
        <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>

      <Field
        label={t('expense.payee')}
        error={errors.payeeId}
        hint={unpaid ? t('expense.unpaidHint') : undefined}
      >
        <Select value={payeeId} onChange={(e) => setPayeeId(e.target.value)}>
          <option value="">-</option>
          {(payees.data?.payees ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameBn}
            </option>
          ))}
        </Select>
      </Field>

      <Switch
        checked={unpaid}
        onChange={setUnpaid}
        label={t('expense.unpaid')}
        hint={t('expense.unpaidHint')}
      />

      {!unpaid && (
        <Field label={t('expense.paidFrom')}>
          <Select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
            {['cash', 'bkash', 'nagad', 'rocket', 'bank'].map((m) => (
              <option key={m} value={m}>
                {tPaidFrom(m)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label={t('expense.note')} error={errors.note}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
    </Modal>
  );
}
