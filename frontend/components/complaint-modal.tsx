'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, MapPin } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t, tComplaintKind } from '@/lib/i18n/bn';
import { formatQuantity } from '@/lib/format';
import type { Complaint, ComplaintKind, Order } from '@/lib/types';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/layout';
import { cn } from '@/lib/utils';

/**
 * Writing down what a customer said was wrong.
 *
 * The lines are the reason this screen exists. A source is chosen per line at
 * accept (docs/adr/0006), so ticking the product that was bad is what turns a
 * phone call into a mark against one orchard — and the orchard's name is shown
 * beside each line here, so the person logging it can see, as they tick, whose
 * record they are about to move.
 *
 * Nothing about the order changes. It may be delivered and paid for; a return
 * or a refund is a separate decision with its own ledger entries.
 */
const KINDS: ComplaintKind[] = [
  'quality',
  'damaged',
  'short_weight',
  'wrong_item',
  'late',
  'other',
];

export function ComplaintModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<ComplaintKind>('quality');
  const [note, setNote] = useState('');
  const [itemIds, setItemIds] = useState<string[]>([]);

  const log = useMutation({
    mutationFn: () =>
      api.post<{ complaint: Complaint }>(`/owner/orders/${order!.id}/complaints`, {
        kind,
        note,
        itemIds,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['complaints'] });
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setNote('');
      setItemIds([]);
      setKind('quality');
      onClose();
      toast(t('complaint.saved'));
    },
  });

  if (!order) return null;

  const toggle = (id: string) =>
    setItemIds((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id]
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('complaint.add')} · ${order.orderCode}`}
      dirty={note.trim().length > 0 || itemIds.length > 0}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.close')}
          </Button>
          <Button
            loading={log.isPending}
            disabled={note.trim().length < 3}
            onClick={() => log.mutate()}
          >
            {t('complaint.add')}
          </Button>
        </>
      }
    >
      {log.error && <Alert tone="danger">{errorMessage(log.error)}</Alert>}

      <Field label={t('complaint.kind')} htmlFor="kind" required>
        <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as ComplaintKind)}>
          {KINDS.map((one) => (
            <option key={one} value={one}>
              {tComplaintKind(one)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t('complaint.items')}
        hint={t('complaint.itemsHint')}
        htmlFor="complaint-items"
      >
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

      <Field label={t('complaint.note')} htmlFor="note" required>
        <Textarea
          id="note"
          rows={3}
          value={note}
          placeholder={t('complaint.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </Modal>
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
        'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
        checked ? 'border-primary bg-primary-softer' : 'border-border hover:bg-muted'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="peer sr-only"
      />
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
        <span className="block text-xs text-muted-foreground">
          {formatQuantity(item.quantity, item.unit)}
        </span>
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
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t('complaint.noSource')}
          </span>
        )}
      </span>
    </label>
  );
}
