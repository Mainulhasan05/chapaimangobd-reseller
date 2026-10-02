'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { BadgeCheck, CircleCheckBig } from 'lucide-react';
import { t, tf, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUrlState } from '@/lib/use-url-state';
import { LIVE } from '@/lib/store/api';
import { useGetDashboardQuery } from '@/lib/store/endpoints/dashboard';
import {
  useApproveKycMutation,
  useGetKycDocumentsQuery,
  useGetKycSubmissionsInfiniteQuery,
  useRejectKycMutation,
  type KycSubmission,
} from '@/lib/store/endpoints/people';
import { Badge, Card, EmptyState, ErrorState, PageHeader, PhoneLink, statusTone } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Segmented, Toolbar } from '@/components/ui/toolbar';
import { ListSkeleton, Skeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';
import { useToast } from '@/components/ui/toast';
import { ZoomableImage } from '@/components/document-viewer';

/**
 * The KYC queue: documents a reseller was asked for, waiting to be read.
 *
 * Only resellers the owner asked to verify ever appear here (docs/adr/0017).
 * Reading a submission opens its scans, which are national ID cards: they are
 * fetched as short-lived signed links when the sheet opens, every fetch is
 * audited, and nothing is kept once the sheet closes.
 */

/** Document types arrive as identifiers; the owner reads them in Bengali. */
const DOC_LABEL: Record<string, DictKey> = {
  nid_front: 'kyc.nidFront',
  nid_back: 'kyc.nidBack',
  selfie: 'kycReview.selfie',
  trade_license: 'kyc.tradeLicense',
};

const docLabel = (type: string) => (DOC_LABEL[type] ? t(DOC_LABEL[type]) : type);

type Status = 'pending' | 'approved' | 'rejected';
const STATUSES: Status[] = ['pending', 'approved', 'rejected'];

const STATUS_LABEL: Record<Status, DictKey> = {
  pending: 'kyc.pending',
  approved: 'kyc.approved',
  rejected: 'kyc.rejected',
};

const MIN_REASON = 3;

export default function OwnerKycPage() {
  const [filters, setFilters] = useUrlState({ status: 'pending' });
  const status: Status = STATUSES.includes(filters.status as Status) ? (filters.status as Status) : 'pending';
  // One submission and what is being done with it. A new one starts clean.
  const [open, setOpen] = useState<{ submission: KycSubmission; mode: 'review' | 'approve' | 'reject' } | null>(
    null
  );

  /*
   * The pending count is the dashboard's, so it matches the nav badge. The
   * approved and rejected tabs carry none: no endpoint counts them, and a
   * count of the loaded page would be wrong once there is a second page.
   */
  const dashboard = useGetDashboardQuery(undefined, LIVE);

  /*
   * Oldest first, a page at a time. The pending queue is worked from the front;
   * the approved and rejected histories only grow, which is why this pages by
   * cursor rather than by number.
   */
  const queue = useGetKycSubmissionsInfiniteQuery({ status }, status === 'pending' ? LIVE : undefined);
  const submissions = queue.data?.pages.flatMap((page) => page.submissions) ?? [];
  const switching = queue.isFetching && !queue.isFetchingNextPage && !queue.currentData;

  return (
    <>
      <PageHeader title={t('nav.kyc')} subtitle={t('kycReview.subtitle')} />

      <Toolbar>
        <Segmented
          label={t('app.status')}
          value={status}
          onChange={(value) => setFilters({ status: value })}
          options={STATUSES.map((value) => ({
            value,
            label: t(STATUS_LABEL[value]),
            count: value === 'pending' ? dashboard.data?.pendingKyc : undefined,
          }))}
        />
      </Toolbar>

      {queue.isLoading && <ListSkeleton rows={4} />}

      {queue.isError && submissions.length === 0 && (
        <ErrorState onRetry={() => queue.refetch()} isRetrying={queue.isFetching} error={queue.error} />
      )}

      {queue.isSuccess && submissions.length === 0 &&
        (status === 'pending' ? (
          <EmptyState icon={CircleCheckBig} title={t('kycReview.allDone')} description={t('kycReview.allDoneHelp')} />
        ) : (
          <EmptyState icon={BadgeCheck} title={t('kycReview.none')} />
        ))}

      {submissions.length > 0 && (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {submissions.map((submission) => (
              <li key={submission.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/owner/resellers/${submission.reseller?._id}` as Route}
                        // Padded to a thumb's height on a phone: the phone link sits right under it.
                        className="block truncate py-2.5 font-semibold underline-offset-2 hover:underline sm:py-0"
                      >
                        {submission.reseller?.shopName ?? '—'}
                      </Link>
                      {submission.reseller?.user?.name && (
                        <p className="truncate text-xs text-muted-foreground">{submission.reseller.user.name}</p>
                      )}
                      <PhoneLink
                        phone={submission.reseller?.user?.phoneE164}
                        className="text-xs text-muted-foreground"
                      />
                    </div>
                    <Badge tone={statusTone(submission.status)} dot className="shrink-0">
                      {STATUS_LABEL[submission.status as Status]
                        ? t(STATUS_LABEL[submission.status as Status])
                        : submission.status}
                    </Badge>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {submission.documentTypes.map((type) => (
                      <li key={type} className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium">
                        {docLabel(type)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tf('kycReview.submittedAt', { at: formatDateTime(submission.createdAt) })}
                  </p>
                  {/* The decision, on the history tabs: who, when, and the reason they gave. */}
                  {submission.status !== 'pending' && submission.reviewedAt && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {submission.reviewedBy
                        ? tf('finance.reviewedBy', {
                            name: submission.reviewedBy.name,
                            at: formatDateTime(submission.reviewedAt),
                          })
                        : tf('finance.reviewedAt', { at: formatDateTime(submission.reviewedAt) })}
                    </p>
                  )}
                  {submission.status === 'rejected' && submission.note && (
                    <p className="mt-1 break-words text-xs text-danger-ink">
                      {tf('finance.reasonShown', { reason: submission.note })}
                    </p>
                  )}
                  <Button
                    className="mt-3"
                    variant={submission.status === 'pending' ? 'primary' : 'outline'}
                    full
                    onClick={() => setOpen({ submission, mode: 'review' })}
                  >
                    {submission.status === 'pending' ? t('kycReview.review') : t('kyc.viewDocuments')}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>

          <LoadMore
            hasMore={Boolean(queue.hasNextPage)}
            loading={queue.isFetchingNextPage}
            onLoadMore={() => queue.fetchNextPage()}
            error={queue.isFetchNextPageError ? queue.error : null}
          />
        </div>
      )}

      {open?.mode === 'review' && (
        <ReviewSheet
          key={open.submission.id}
          submission={open.submission}
          onClose={() => setOpen(null)}
          onDecide={(mode) => setOpen({ submission: open.submission, mode })}
        />
      )}
      {open?.mode === 'approve' && (
        <ApproveSheet key={open.submission.id} submission={open.submission} onClose={() => setOpen(null)} />
      )}
      {open?.mode === 'reject' && (
        <RejectSheet key={open.submission.id} submission={open.submission} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

/** The scans, one under another, each enlargeable and re-fetched when its link expires. */
function Documents({ submission }: { submission: KycSubmission }) {
  const documents = useGetKycDocumentsQuery({ id: submission.id });

  if (documents.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {submission.documentTypes.map((type) => (
          <Skeleton key={type} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (documents.isError || !documents.data) {
    return (
      <ErrorState onRetry={() => documents.refetch()} isRetrying={documents.isFetching} error={documents.error} />
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {documents.data.documents.map((doc) => (
        <div key={doc.type} className="min-w-0">
          <p className="mb-1.5 text-sm font-semibold">{docLabel(doc.type)}</p>
          <ZoomableImage src={doc.url} alt={docLabel(doc.type)} onBroken={() => documents.refetch()} />
        </div>
      ))}
    </div>
  );
}

function ReviewSheet({
  submission,
  onClose,
  onDecide,
}: {
  submission: KycSubmission;
  onClose: () => void;
  onDecide: (mode: 'approve' | 'reject') => void;
}) {
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
            <Button variant="outline" className="text-danger" onClick={() => onDecide('reject')}>
              {t('owner.reject')}
            </Button>
            <Button variant="success" onClick={() => onDecide('approve')}>
              {t('owner.approve')}
            </Button>
          </>
        ) : (
          <ModalCancel label={t('app.close')} />
        )
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {tf('kycReview.submittedAt', { at: formatDateTime(submission.createdAt) })}
        </span>
        <Link
          href={`/owner/resellers/${submission.reseller?._id}` as Route}
          className="tap inline-flex items-center font-semibold underline-offset-2 hover:underline"
        >
          {t('kycReview.openReseller')}
        </Link>
      </div>
      {pending && <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">{t('kycReview.checkHint')}</p>}
      <Documents submission={submission} />
    </Modal>
  );
}

function ApproveSheet({ submission, onClose }: { submission: KycSubmission; onClose: () => void }) {
  const toast = useToast();
  const [approve] = useApproveKycMutation();
  const shop = submission.reseller?.shopName ?? '—';
  return (
    <ConfirmSheet
      title={t('kycReview.approveTitle')}
      tone="success"
      confirmLabel={t('owner.approve')}
      onClose={onClose}
      // No reason on approval: there is nothing for the reseller to act on.
      onConfirm={async () => {
        await approve({ id: submission.id }).unwrap();
        toast(tf('kycReview.approved', { shop }));
      }}
      summary={
        <>
          <p className="font-semibold">{shop}</p>
          <p className="mt-0.5 text-muted-foreground">
            {submission.documentTypes.map(docLabel).join(', ')}
          </p>
        </>
      }
      consequences={[t('kycReview.approveConsequence')]}
    />
  );
}

function RejectSheet({ submission, onClose }: { submission: KycSubmission; onClose: () => void }) {
  const toast = useToast();
  const [reject] = useRejectKycMutation();
  const shop = submission.reseller?.shopName ?? '—';
  return (
    <ConfirmSheet
      title={t('kycReview.rejectTitle')}
      tone="danger"
      confirmLabel={t('owner.reject')}
      onClose={onClose}
      onConfirm={async (reason) => {
        await reject({ id: submission.id, reason }).unwrap();
        toast(tf('kycReview.rejected', { shop }));
      }}
      summary={
        <>
          <p className="font-semibold">{shop}</p>
          <p className="mt-0.5 text-muted-foreground">
            {tf('kycReview.submittedAt', { at: formatDateTime(submission.createdAt) })}
          </p>
        </>
      }
      consequences={[t('kycReview.rejectConsequence')]}
      reason={{
        required: true,
        minLength: MIN_REASON,
        label: t('kycReview.rejectReason'),
        placeholder: tf('app.minChars', { count: formatNumber(MIN_REASON) }),
        presets: [t('kycReview.presetBlurry'), t('kycReview.presetMissing'), t('kycReview.presetMismatch')],
      }}
    />
  );
}
