'use client';

import { useRef, useState } from 'react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import type { Source } from '@/lib/types';
import {
  useArchiveSourceMutation,
  useCreateSourceMutation,
  useRestoreSourceMutation,
  useUpdateSourceMutation,
} from '@/lib/store/endpoints/catalog';
import { Button } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Field, Input, Textarea, focusFirstInvalid } from '@/components/ui/form';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { PhoneField } from '@/components/ui/phone-field';
import { useToast } from '@/components/ui/toast';

/**
 * The source form and the archive confirmation, shared by the list and the
 * detail page so a source can be changed from wherever the owner is looking at
 * it.
 */

type Draft = { name: string; address: string; phone: string; note: string };

const draftOf = (source: Source | null): Draft => ({
  name: source?.name ?? '',
  address: source?.address ?? '',
  phone: source?.phoneE164 ?? '',
  note: source?.note ?? '',
});

/**
 * Add or change one source. Nothing takes focus on open: on a phone that brings
 * the keyboard up over a sheet the owner has not read yet.
 */
export function SourceSheet({ source, onClose }: { source: Source | null; onClose: () => void }) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [initial] = useState(() => draftOf(source));
  const [draft, setDraft] = useState<Draft>(initial);
  const [tried, setTried] = useState(false);

  const [createSource, creating] = useCreateSourceMutation();
  const [updateSource, updating] = useUpdateSourceMutation();
  const saving = creating.isLoading || updating.isLoading;
  const error = source ? updating.error : creating.error;
  const errors = fieldErrors(error);

  const nameProblem = draft.name.trim().length < 2 ? t('sources.nameRequired') : undefined;
  const nameError = errors.name ?? (tried ? nameProblem : undefined);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async () => {
    setTried(true);
    if (nameProblem) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    // Empty strings are sent on an edit, so a cleared address is cleared.
    const body = {
      name: draft.name.trim(),
      address: draft.address.trim(),
      phone: draft.phone.trim(),
      note: draft.note.trim(),
    };
    try {
      const result = source
        ? await updateSource({ id: source._id, ...body }).unwrap()
        : await createSource({
            name: body.name,
            ...(body.address ? { address: body.address } : {}),
            ...(body.phone ? { phone: body.phone } : {}),
            ...(body.note ? { note: body.note } : {}),
          }).unwrap();
      toast(tf(source ? 'sources.saved' : 'sources.created', { name: result.source.name }));
      onClose();
    } catch {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      title={source ? source.name : t('sources.new')}
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
        <Field label={t('sources.name')} htmlFor="source-name" error={nameError} required>
          <Input
            id="source-name"
            value={draft.name}
            invalid={Boolean(nameError)}
            onChange={set('name')}
          />
        </Field>

        <Field label={t('order.address')} htmlFor="source-address" hint={t('app.optional')} error={errors.address}>
          <Textarea id="source-address" rows={2} value={draft.address} onChange={set('address')} />
        </Field>

        <PhoneField
          id="source-phone"
          label={t('auth.phone')}
          hint={t('app.optional')}
          value={draft.phone}
          onChange={(phone) => setDraft((prev) => ({ ...prev, phone }))}
          error={errors.phone}
          autoComplete="off"
        />

        <Field label={t('app.notes')} htmlFor="source-note" hint={t('app.optional')} error={errors.note}>
          <Textarea id="source-note" rows={2} value={draft.note} onChange={set('note')} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Archive and restore, with an undo in the toast. Archived, never deleted:
 * shipped orders and complaints still name the source.
 */
export function useSourceArchive() {
  const toast = useToast();
  const [archiveSource] = useArchiveSourceMutation();
  const [restoreSource, restoring] = useRestoreSourceMutation();

  const restore = async (source: Source) => {
    try {
      await restoreSource({ id: source._id }).unwrap();
      toast(tf('sources.restored', { name: source.name }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  const archive = async (source: Source) => {
    await archiveSource({ id: source._id }).unwrap();
    toast(tf('sources.archived', { name: source.name }), 'neutral', {
      action: { label: t('app.undo'), onClick: () => void restore(source) },
    });
  };

  return {
    archive,
    restore,
    restoringId: restoring.isLoading ? restoring.originalArgs?.id : undefined,
  };
}

/** The confirmation before a source leaves the accept sheet. Mount only while open. */
export function ArchiveSourceSheet({
  source,
  onClose,
  onConfirm,
}: {
  source: Source;
  onClose: () => void;
  onConfirm: (source: Source) => Promise<void>;
}) {
  return (
    <ConfirmSheet
      title={tf('sources.archiveTitle', { name: source.name })}
      tone="danger"
      confirmLabel={t('app.archive')}
      consequences={[t('sources.archiveLine1'), t('sources.archiveLine2')]}
      onClose={onClose}
      onConfirm={() => onConfirm(source)}
    />
  );
}
