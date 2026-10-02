'use client';

import { useRef, useState } from 'react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf, tPayeeKind } from '@/lib/i18n/bn';
import type { Payee } from '@/lib/types';
import { useCreatePayeeMutation, useUpdatePayeeMutation } from '@/lib/store/endpoints/cost';
import { Button } from '@/components/ui/button';
import { Field, FormErrorSummary, Input, Select, Textarea, focusFirstInvalid } from '@/components/ui/form';
import { PhoneField } from '@/components/ui/phone-field';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

export type PayeeKind = Payee['kind'];

export const PAYEE_KINDS: PayeeKind[] = ['supplier', 'labour', 'courier', 'transport', 'landlord', 'other'];

type Draft = { nameBn: string; kind: PayeeKind; phone: string; address: string; note: string };

const blank: Draft = { nameBn: '', kind: 'supplier', phone: '', address: '', note: '' };

/**
 * Adding or editing a পার্টি. Only the name is required; a phone number and an
 * address are for the owner's own convenience and can be filled in later.
 *
 * Mount only while open, keyed by the payee being edited.
 */
export function PayeeModal({ payee, onClose }: { payee: Payee | null; onClose: () => void }) {
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const initial: Draft = payee
    ? {
        nameBn: payee.nameBn,
        kind: payee.kind,
        phone: payee.phone ?? '',
        address: payee.address ?? '',
        note: payee.note ?? '',
      }
    : blank;
  const [draft, setDraft] = useState<Draft>(initial);
  const [tried, setTried] = useState(false);

  const [create, createState] = useCreatePayeeMutation();
  const [update, updateState] = useUpdatePayeeMutation();
  const state = payee ? updateState : createState;
  const errors = fieldErrors(state.error);

  const nameMissing = draft.nameBn.trim().length < 2;
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((key) => draft[key] !== initial[key]);

  const save = async () => {
    setTried(true);
    if (nameMissing) {
      requestAnimationFrame(() => focusFirstInvalid(root.current));
      return;
    }
    const body = {
      nameBn: draft.nameBn.trim(),
      kind: draft.kind,
      ...(draft.phone ? { phone: draft.phone } : {}),
      ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    };
    try {
      if (payee) await update({ id: payee.id, ...body }).unwrap();
      else await create(body).unwrap();
      toast(tf('payee.savedToast', { name: body.nameBn }));
      onClose();
    } catch {
      // Field errors land beside their fields; anything else above the buttons.
    }
  };

  const nameError = errors.nameBn ?? (tried && nameMissing ? t('app.required') : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title={payee ? t('payee.edit') : t('payee.new')}
      dirty={dirty}
      footerLead={
        <FormErrorSummary
          message={state.error && !Object.keys(errors).length ? errorMessage(state.error) : null}
        />
      }
      footer={
        <>
          <ModalCancel />
          <Button loading={state.isLoading} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={root}>
        {/* What belongs here, said once, at the top. */}
        {!payee && <p className="mb-4 text-sm text-muted-foreground">{t('payee.formIntro')}</p>}

        <Field label={t('payee.name')} htmlFor="payee-name" error={nameError} required>
          <Input
            id="payee-name"
            value={draft.nameBn}
            invalid={Boolean(nameError)}
            onChange={(e) => setDraft((prev) => ({ ...prev, nameBn: e.target.value }))}
            autoFocus={!payee}
          />
        </Field>

        {/* The kind changes the label a reader sees and nothing else, so it is a
          * plain select rather than a decision the form makes a fuss about. */}
        <Field label={t('payee.kind')} htmlFor="payee-kind" error={errors.kind}>
          <Select
            id="payee-kind"
            value={draft.kind}
            onChange={(e) => setDraft((prev) => ({ ...prev, kind: e.target.value as PayeeKind }))}
          >
            {PAYEE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {tPayeeKind(kind)}
              </option>
            ))}
          </Select>
        </Field>

        <PhoneField
          id="payee-phone"
          label={t('auth.phone')}
          hint={t('app.optional')}
          value={draft.phone}
          onChange={(phone) => setDraft((prev) => ({ ...prev, phone }))}
          error={errors.phone}
          autoComplete="off"
        />

        <Field label={t('order.address')} htmlFor="payee-address" hint={t('app.optional')} error={errors.address}>
          <Textarea
            id="payee-address"
            rows={2}
            value={draft.address}
            onChange={(e) => setDraft((prev) => ({ ...prev, address: e.target.value }))}
          />
        </Field>

        <Field label={t('app.notes')} htmlFor="payee-note" hint={t('app.optional')} error={errors.note}>
          <Textarea
            id="payee-note"
            rows={2}
            value={draft.note}
            onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
          />
        </Field>
      </div>
    </Modal>
  );
}
