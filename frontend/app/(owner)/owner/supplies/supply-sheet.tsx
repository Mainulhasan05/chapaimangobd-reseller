'use client';

import { useRef, useState } from 'react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf, tUnit } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import type { Supply } from '@/lib/types';
import {
  useCreateSupplyMutation,
  useGetSupplyQuery,
  useUpdateSupplyMutation,
} from '@/lib/store/endpoints/catalog';
import { Alert } from '@/components/ui/layout';
import { Field, Input, Select, Textarea, focusFirstInvalid } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';

/** The supply form, shared by the list and the detail page. */

const UNITS = ['pcs', 'sheet', 'roll', 'kg', 'gram', 'metre', 'packet', 'bundle', 'litre'];

/**
 * Add or change one item.
 *
 * The unit is offered only when creating. Changing it afterwards would silently
 * restate every quantity ever recorded against this item, so the API refuses it
 * and this form does not pretend otherwise.
 *
 * No field takes focus on open: on a phone that pushes the keyboard up over the
 * sheet before the owner has read what it is for.
 */
export function SupplySheet({ supply, onClose }: { supply: Supply | null; onClose: () => void }) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [nameBn, setNameBn] = useState(supply?.nameBn ?? '');
  const [unit, setUnit] = useState(supply?.unit ?? 'pcs');
  // Empty, not '0': a box pre-filled with a zero is a box to clear before typing.
  // A plain number, not a money format: this is a count of things.
  const [reorderLevel, setReorderLevel] = useState(
    supply && supply.reorderLevel > 0 ? String(supply.reorderLevel) : ''
  );
  const [note, setNote] = useState(supply?.note ?? '');
  const [isArchived, setIsArchived] = useState(Boolean(supply?.isArchived));
  const [tried, setTried] = useState(false);

  const [createSupply, creating] = useCreateSupplyMutation();
  const [updateSupply, updating] = useUpdateSupplyMutation();
  const saving = creating.isLoading || updating.isLoading;
  const error = supply ? updating.error : creating.error;
  const errors = fieldErrors(error);

  // Only asked for once archiving is on the table: which boxes still name this.
  const detail = useGetSupplyQuery(
    { id: supply?.id ?? '' },
    { skip: !supply || !isArchived || supply.isArchived }
  );
  const usedBy = detail.data?.usedBy ?? [];

  const nameProblem = nameBn.trim().length < 2 ? t('supplies.nameRequired') : undefined;
  const dirty =
    nameBn !== (supply?.nameBn ?? '') ||
    note !== (supply?.note ?? '') ||
    reorderLevel !== (supply && supply.reorderLevel > 0 ? String(supply.reorderLevel) : '') ||
    isArchived !== Boolean(supply?.isArchived) ||
    (!supply && unit !== 'pcs');

  const save = async () => {
    setTried(true);
    if (nameProblem) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    const body = {
      nameBn: nameBn.trim(),
      reorderLevel: Number(reorderLevel) || 0,
      note: note.trim(),
    };
    try {
      const result = supply
        ? await updateSupply({ id: supply.id, ...body, isArchived }).unwrap()
        : await createSupply({ ...body, unit }).unwrap();
      toast(tf(supply ? 'supplies.saved' : 'supplies.created', { name: result.supply.nameBn }));
      onClose();
    } catch {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
    }
  };

  const nameError = errors.nameBn ?? (tried ? nameProblem : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      title={supply ? t('supply.edit') : t('supply.new')}
      footerLead={
        error && !Object.keys(errors).length ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
            {errorMessage(error)}
          </p>
        ) : undefined
      }
      footer={
        <>
          <ModalCancel disabled={saving} />
          <Button loading={saving} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef}>
        <Field label={t('supply.name')} htmlFor="supply-name" error={nameError} required>
          <Input
            id="supply-name"
            value={nameBn}
            invalid={Boolean(nameError)}
            onChange={(e) => setNameBn(e.target.value)}
            placeholder={t('supplies.namePlaceholder')}
          />
        </Field>

        {!supply && (
          <Field label={t('supply.unit')} htmlFor="supply-unit" error={errors.unit} required>
            <Select id="supply-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {tUnit(u)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label={t('supply.reorderLevel')}
          htmlFor="supply-reorder"
          hint={t('supplies.reorderHint')}
          error={errors.reorderLevel}
        >
          <Input
            id="supply-reorder"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.001"
            value={reorderLevel}
            onChange={(e) => setReorderLevel(e.target.value)}
            className="tabular"
            trailing={<span className="text-sm text-muted-foreground">{tUnit(supply?.unit ?? unit)}</span>}
          />
        </Field>

        <Field label={t('expense.note')} htmlFor="supply-note" error={errors.note}>
          <Textarea id="supply-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>

        {supply && (
          <div className="rounded-xl border border-border px-3">
            <Switch
              checked={isArchived}
              onChange={setIsArchived}
              label={t('supplies.archiveSwitch')}
              hint={t('supplies.archiveHint')}
            />
          </div>
        )}

        {/* Archiving something a recipe still names leaves that box consuming nothing. */}
        {supply && isArchived && !supply.isArchived && usedBy.length > 0 && (
          <Alert tone="warning" className="mt-3">
            {tf('supplies.usedByWarn', {
              count: formatNumber(usedBy.length),
              boxes: usedBy.map((row) => `${row.productNameBn} · ${row.variantLabel}`).join(', '),
            })}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
