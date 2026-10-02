'use client';

import { useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { Check, MapPin } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tComplaintKind } from '@/lib/i18n/bn';
import { districtLabel } from '@/lib/districts';
import { formatAge } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import { useCreateComplaintMutation } from '@/lib/store/endpoints/complaints';
import { useGetOwnerOrdersInfiniteQuery } from '@/lib/store/endpoints/orders';
import type { ComplaintKind, Order } from '@/lib/types';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Button, Spinner } from '@/components/ui/button';
import { Field, FormErrorSummary, Select, Textarea } from '@/components/ui/form';
import { SearchInput } from '@/components/ui/toolbar';
import { itemAmount, ownerStatusLabel } from '@/components/orders-panel';
import { cn } from '@/lib/utils';

/**
 * Writing down what a customer said was wrong. Mount only while open.
 *
 * The lines are the reason this screen exists. A source is chosen per line at
 * accept (docs/adr/0006), so ticking the product that was bad is what turns a
 * phone call into a mark against one orchard — and the orchard's name is shown
 * beside each line here, so the person logging it can see, as they tick, whose
 * record they are about to move.
 *
 * Nothing about the order changes. It may be delivered and paid for; a return
 * or a refund is a separate decision with its own ledger entries.
 *
 * Opened from an order it already knows which one. Opened from the complaints
 * list it starts with a lookup, because the customer on the phone gives a code
 * or a number, not an order page.
 */
const KINDS: ComplaintKind[] = [
  'quality',
  'damaged',
  'short_weight',
  'wrong_item',
  'late',
  'other',
];

export function ComplaintModal({
  order: given,
  onClose,
}: {
  order?: Order;
  onClose: () => void;
}) {
  const toast = useToast();
  const [log] = useCreateComplaintMutation();
  const [picked, setPicked] = useState<Order | null>(null);
  const [kind, setKind] = useState<ComplaintKind>('quality');
  const [note, setNote] = useState('');
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const order = given ?? picked;
  const noteMissing = note.trim().length < 3;

  const toggle = (id: string) =>
    setItemIds((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id]
    );

  const submit = async () => {
    if (!order) return;
    setTried(true);
    if (noteMissing) return;
    setBusy(true);
    setError(null);
    try {
      await log({ orderId: order.id, kind, note: note.trim(), itemIds }).unwrap();
      onClose();
      toast(`${order.orderCode} · ${t('complaint.saved')}`);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={order ? `${t('complaint.add')} · ${order.orderCode}` : t('complaint.add')}
      dirty={note.trim().length > 0 || itemIds.length > 0}
      footerLead={error ? <FormErrorSummary message={error} /> : undefined}
      footer={
        <>
          <ModalCancel disabled={busy} />
          {order && (
            <Button loading={busy} onClick={submit}>
              {t('complaint.add')}
            </Button>
          )}
        </>
      }
    >
      {!order ? (
        <OrderLookup onPick={setPicked} />
      ) : (
        <>
          {!given && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {order.customer.name} · {districtLabel(order.customer.district)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  setItemIds([]);
                }}
                className="tap shrink-0 rounded-lg px-2 text-sm font-semibold text-primary-ink hover:bg-primary-softer"
              >
                {t('orders.complaintOtherOrder')}
              </button>
            </div>
          )}

          <Field label={t('complaint.kind')} htmlFor="kind" required>
            <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as ComplaintKind)}>
              {KINDS.map((one) => (
                <option key={one} value={one}>
                  {tComplaintKind(one)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('complaint.items')} hint={t('complaint.itemsHint')} htmlFor="complaint-items">
            <div id="complaint-items" className="space-y-1.5">
              {order.items.map((item) => (
                <ItemPick
                  key={item.id}
                  item={item}
                  checked={itemIds.includes(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </div>
          </Field>

          {/*
           * Nothing ticked is a real answer, not an unfinished form: a parcel that
           * arrived three days late is nobody's fruit. Said out loud so an empty
           * list does not read as a step that was missed.
           */}
          {itemIds.length === 0 && (
            <p className="-mt-2 mb-4 text-xs text-muted-foreground">{t('complaint.noItems')}</p>
          )}

          <Field
            label={t('complaint.note')}
            htmlFor="note"
            required
            error={tried && noteMissing ? t('orders.noteRequired') : undefined}
          >
            <Textarea
              id="note"
              rows={3}
              value={note}
              invalid={tried && noteMissing}
              placeholder={t('complaint.notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </>
      )}
    </Modal>
  );
}

/**
 * Finding the order a customer is ringing about, by its code or their number.
 * Searches every status: a complaint usually arrives after delivery.
 */
function OrderLookup({ onPick }: { onPick: (order: Order) => void }) {
  const [input, setInput] = useState('');
  const term = useDebounced(input.trim(), 350);
  const results = useGetOwnerOrdersInfiniteQuery(term.length >= 3 ? { q: term, limit: 6 } : skipToken);
  const rows = results.data?.pages.flatMap((page) => page.orders) ?? [];

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">{t('orders.complaintLookupHelp')}</p>
      <SearchInput
        value={input}
        onChange={setInput}
        placeholder={t('app.searchOrders')}
        className="sm:max-w-none"
        autoFocus
      />

      {term.length >= 3 && (
        <div className="mt-3" aria-live="polite">
          {results.isFetching && rows.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" />
              {t('orders.searching')}
            </p>
          )}
          {results.isError && <FormErrorSummary message={errorMessage(results.error)} />}
          {results.isSuccess && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('app.noResults')}</p>
          )}
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onPick(row)}
                  className="tap w-full rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="tabular font-semibold">{row.orderCode}</span>
                    <span className="text-xs text-muted-foreground">
                      {ownerStatusLabel(row.status)} · {formatAge(row.createdAt)}
                    </span>
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {row.customer.name} · {districtLabel(row.customer.district)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One line of the order, as a tick.
 *
 * Written here rather than composed from the shared `Checkbox`, because that
 * component is itself a `<label>` and nesting one label inside another is
 * invalid and breaks the click target it exists to provide. The whole row is
 * the target, which is what matters on a phone.
 */
function ItemPick({
  item,
  checked,
  onToggle,
}: {
  item: Order['items'][number];
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
        checked ? 'border-primary bg-primary-softer' : 'border-border hover:bg-muted'
      )}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-[0.35rem] border transition-colors',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface'
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{item.productName}</span>
        <span className="tabular block text-xs text-muted-foreground">{itemAmount(item)}</span>
        {/*
         * Whose record this tick moves. Shown as the tick is made rather than
         * afterwards, because that is the moment somebody would notice they
         * were about to blame the wrong orchard.
         */}
        {item.sourceName ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-primary-ink">
            <MapPin aria-hidden className="h-3 w-3 shrink-0" />
            {item.sourceName}
          </span>
        ) : (
          <span className="mt-0.5 block text-xs text-muted-foreground">{t('complaint.noSource')}</span>
        )}
      </span>
    </label>
  );
}
