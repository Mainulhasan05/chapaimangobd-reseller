'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import type { Source } from '@/lib/types';
import { Alert, Card, EmptyState, PageHeader, TableWrap, Td, Th } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

type Draft = { name: string; address: string; phone: string; note: string };
const blank: Draft = { name: '', address: '', phone: '', note: '' };

export default function OwnerSourcesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Source | null>(null);
  const [creating, setCreating] = useState(false);

  const sources = useQuery({
    queryKey: ['owner', 'sources'],
    queryFn: () => api.get<{ sources: Source[] }>('/owner/sources'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.del(`/owner/sources/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'sources'] }),
  });

  return (
    <>
      <PageHeader
        title={t('nav.sources')}
        subtitle="যেখান থেকে পণ্য সংগ্রহ করা হয়"
        action={<Button onClick={() => setCreating(true)}>{t('nav.sources')} +</Button>}
      />

      {sources.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {sources.data?.sources.length === 0 && <EmptyState title={t('app.none')} />}

      {sources.data && sources.data.sources.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('nav.sources')}</Th>
              <Th>{t('order.address')}</Th>
              <Th>{t('auth.phone')}</Th>
              <Th className="text-right">{t('app.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {sources.data.sources.map((source) => (
              <tr key={source._id}>
                <Td className="font-medium">{source.name}</Td>
                <Td className="text-sm text-muted-foreground">{source.address ?? '—'}</Td>
                <Td className="tabular text-sm">{source.phoneE164 ?? '—'}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(source)}>
                      {t('app.save')}
                    </Button>
                    {/* Archived, never deleted: shipped orders still reference it. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archive.mutate(source._id)}
                      loading={archive.isPending && archive.variables === source._id}
                    >
                      {t('app.close')}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {(creating || editing) && (
        <SourceModal
          source={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function SourceModal({ source, onClose }: { source: Source | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(
    source
      ? {
          name: source.name,
          address: source.address ?? '',
          phone: source.phoneE164 ?? '',
          note: source.note ?? '',
        }
      : blank
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name,
        ...(draft.address ? { address: draft.address } : {}),
        ...(draft.phone ? { phone: draft.phone } : {}),
        ...(draft.note ? { note: draft.note } : {}),
      };
      return source ? api.patch(`/owner/sources/${source._id}`, body) : api.post('/owner/sources', body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'sources'] });
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      title={source ? source.name : t('nav.sources')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field label={t('nav.sources')} htmlFor="name" error={errors.name} required>
        <Input id="name" value={draft.name} onChange={set('name')} autoFocus />
      </Field>

      <Field label={t('order.address')} htmlFor="address" error={errors.address}>
        <Textarea id="address" rows={2} value={draft.address} onChange={set('address')} />
      </Field>

      <Field label={t('auth.phone')} htmlFor="phone" hint={t('app.optional')} error={errors.phone}>
        <Input id="phone" type="tel" inputMode="numeric" value={draft.phone} onChange={set('phone')} />
      </Field>

      <Field label={t('app.notes')} htmlFor="note">
        <Textarea id="note" rows={2} value={draft.note} onChange={set('note')} />
      </Field>
    </Modal>
  );
}
