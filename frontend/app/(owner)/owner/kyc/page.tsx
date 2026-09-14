'use client';

import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime } from '@/lib/format';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  statusTone,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { LoadMore } from '@/components/ui/load-more';
import type { CursorPaged } from '@/lib/types';

/** Document types arrive as identifiers; the owner reads them in Bengali. */
const DOC_LABEL: Record<string, DictKey> = {
  nid_front: 'kyc.nidFront',
  nid_back: 'kyc.nidBack',
  selfie: 'kyc.selfie',
  trade_license: 'kyc.tradeLicense',
};

const DICT_STATUS: Record<string, DictKey> = {
  pending: 'kyc.pending',
  approved: 'kyc.approved',
  rejected: 'kyc.rejected',
};

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

const PAGE_SIZE = 30;

export default function OwnerKycPage() {
  const [status, setStatus] = useState('pending');
  const [reviewing, setReviewing] = useState<Submission | null>(null);

  /*
   * Oldest first, a page at a time. The pending queue is worked from the front;
   * the approved and rejected histories only grow, which is why this pages by
   * cursor rather than by number.
   */
  const queue = useInfiniteQuery({
    queryKey: ['owner', 'kyc', status],
    queryFn: ({ pageParam }) =>
      api.get<CursorPaged<'submissions', Submission>>(
        `/owner/kyc?status=${status}&limit=${PAGE_SIZE}` +
          `${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const submissions = queue.data?.pages.flatMap((page) => page.submissions) ?? [];

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

      {queue.isError && submissions.length === 0 && (
        <ErrorState onRetry={() => queue.refetch()} isRetrying={queue.isFetching} error={queue.error} />
      )}

      {queue.isSuccess && submissions.length === 0 && (
        <EmptyState icon={BadgeCheck} title={t('app.none')} />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {submissions.map((submission) => (
          <Card key={submission.id}>
            <CardHeader
              title={submission.reseller?.shopName ?? '—'}
              subtitle={submission.reseller?.user?.phoneE164}
              action={
                <Badge tone={statusTone(submission.status)} dot>
                  {DICT_STATUS[submission.status] ? t(DICT_STATUS[submission.status]) : submission.status}
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

      {submissions.length > 0 && (
        <LoadMore
          hasMore={Boolean(queue.hasNextPage)}
          loading={queue.isFetchingNextPage}
          onLoadMore={() => queue.fetchNextPage()}
          error={queue.isFetchNextPageError ? queue.error : null}
        />
      )}

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
            <figcaption className="mb-1 text-xs text-muted-foreground">
              {DOC_LABEL[doc.type] ? t(DOC_LABEL[doc.type]) : doc.type}
            </figcaption>
            {/* Signed R2 URLs expire, so a plain img avoids Next caching them. */}
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
