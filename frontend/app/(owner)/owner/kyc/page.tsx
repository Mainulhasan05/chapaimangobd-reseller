'use client';

import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatDateTime } from '@/lib/format';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, statusTone } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

type Submission = {
  id: string;
  reseller: {
    _id: string;
    shopName: string;
    slug: string;
    user?: { name: string; phoneE164: string };
  };
  status: string;
  documentTypes: string[];
  createdAt: string;
};

export default function OwnerKycPage() {
  const [status, setStatus] = useState('pending');
  const [reviewing, setReviewing] = useState<Submission | null>(null);

  const queue = useQuery({
    queryKey: ['owner', 'kyc', status],
    queryFn: () => api.get<{ submissions: Submission[] }>(`/owner/kyc?status=${status}`),
  });

  return (
    <>
      <PageHeader
        title={t('nav.kyc')}
        action={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="pending">{t('kyc.pending')}</option>
            <option value="approved">{t('kyc.approved')}</option>
            <option value="rejected">{t('kyc.rejected')}</option>
          </Select>
        }
      />

      {queue.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {queue.data?.submissions.length === 0 && (
        <EmptyState icon={BadgeCheck} title={t('app.none')} />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {queue.data?.submissions.map((submission) => (
          <Card key={submission.id}>
            <CardHeader
              title={submission.reseller?.shopName ?? '—'}
              subtitle={submission.reseller?.user?.phoneE164}
              action={
                <Badge tone={statusTone(submission.status)} dot>
                  {submission.status}
                </Badge>
              }
            />
            <p className="mb-3 text-xs text-muted-foreground">
              {submission.documentTypes.join(', ')} · {formatDateTime(submission.createdAt)}
            </p>
            <Button size="sm" variant="outline" full onClick={() => setReviewing(submission)}>
              {t('kyc.viewDocuments')}
            </Button>
          </Card>
        ))}
      </div>

      <ReviewModal submission={reviewing} onClose={() => setReviewing(null)} />
    </>
  );
}

function ReviewModal({
  submission,
  onClose,
}: {
  submission: Submission | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  /**
   * Documents are fetched on demand rather than listed with the queue. The URLs
   * are signed and short lived, and every fetch is written to the audit log,
   * because these are national ID scans.
   */
  const documents = useQuery({
    queryKey: ['owner', 'kyc-docs', submission?.id],
    queryFn: () =>
      api.get<{ documents: { type: string; url: string }[] }>(
        `/owner/kyc/${submission!.id}/documents`
      ),
    enabled: Boolean(submission),
    staleTime: 0,
  });

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post(`/owner/kyc/${submission!.id}/${decision}`, reason ? { reason } : {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setReason('');
      onClose();
    },
  });

  if (!submission) return null;

  const pending = submission.status === 'pending';

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={submission.reseller?.shopName ?? t('kyc.title')}
      footer={
        pending ? (
          <>
            <Button
              variant="danger"
              loading={decide.isPending && decide.variables === 'reject'}
              disabled={reason.trim().length < 3}
              onClick={() => decide.mutate('reject')}
            >
              {t('kyc.reject')}
            </Button>
            <Button
              variant="success"
              loading={decide.isPending && decide.variables === 'approve'}
              onClick={() => decide.mutate('approve')}
            >
              {t('kyc.approve')}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            {t('app.close')}
          </Button>
        )
      }
    >
      {decide.error && <Alert tone="danger">{errorMessage(decide.error)}</Alert>}

      {documents.isLoading && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}

      {documents.error && <Alert tone="warning">{errorMessage(documents.error)}</Alert>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        {documents.data?.documents.map((doc) => (
          <figure key={doc.type}>
            <figcaption className="mb-1 text-xs text-muted-foreground">{doc.type}</figcaption>
            {/* Signed Cloudinary URLs expire, so a plain img avoids Next caching them. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={doc.url}
              alt={doc.type}
              className="w-full rounded-lg border border-border object-contain"
            />
          </figure>
        ))}
      </div>

      {pending && (
        <Field label={t('kyc.rejectReason')} htmlFor="reason" hint={t('app.optional')}>
          <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}
