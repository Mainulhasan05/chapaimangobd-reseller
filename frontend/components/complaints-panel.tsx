'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { MapPin, MessageSquareWarning, RotateCcw } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tComplaintKind } from '@/lib/i18n/bn';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  useReopenComplaintMutation,
  useResolveComplaintMutation,
} from '@/lib/store/endpoints/complaints';
import type { Complaint } from '@/lib/types';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FormErrorSummary, Textarea } from '@/components/ui/form';
import { Badge, EmptyState, PhoneLink } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';

/**
 * A list of complaints, used on the order screen, the orchard screen and the
 * complaints page.
 *
 * Every row names the orchard the complaint was traced to, and that name is a
 * link. That is the whole path this feature exists to shorten: a customer rings
 * about one parcel, and two taps later the owner is looking at everything else
 * that came out of the same orchard.
 */
export function ComplaintList({
  complaints,
  showOrder,
  showSource = true,
  compactEmpty,
}: {
  complaints: Complaint[];
  /** On the orchard screen and the complaints page, where the order is not implied. */
  showOrder?: boolean;
  showSource?: boolean;
  /** One quiet line instead of a boxed empty state, inside a card that has its own frame. */
  compactEmpty?: boolean;
}) {
  const toast = useToast();
  const [resolving, setResolving] = useState<Complaint | null>(null);
  const [reopen, reopenState] = useReopenComplaintMutation();

  const reopenOne = async (complaint: Complaint) => {
    try {
      await reopen({ id: complaint.id }).unwrap();
      toast(`${complaint.orderCode} · ${t('orders.complaintReopened')}`);
    } catch (failure) {
      toast(errorMessage(failure), 'danger');
    }
  };

  if (complaints.length === 0) {
    return compactEmpty ? (
      <EmptyState compact title={t('complaint.none')} />
    ) : (
      <EmptyState icon={MessageSquareWarning} title={t('complaint.none')} />
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {complaints.map((complaint) => (
          <li key={complaint.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={complaint.resolved ? 'neutral' : 'danger'} dot>
                    {tComplaintKind(complaint.kind)}
                  </Badge>
                  {complaint.resolved ? (
                    <span className="text-xs text-success">{t('complaint.resolved')}</span>
                  ) : (
                    <span className="text-xs font-medium text-danger">{t('complaint.open')}</span>
                  )}
                  {showOrder && (
                    <Link
                      href={`/owner/orders/${complaint.order}` as Route}
                      className="tabular inline-flex min-h-11 items-center rounded-md px-1.5 text-xs font-semibold text-primary-ink hover:bg-primary-softer sm:min-h-0 sm:bg-subtle sm:py-0.5"
                    >
                      {complaint.orderCode}
                    </Link>
                  )}
                </div>
                {/* Who rang, and the number to ring them back on. */}
                {showOrder && (complaint.customerName || complaint.customerPhone) && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {complaint.customerName && (
                      <span className="font-medium text-foreground">{complaint.customerName}</span>
                    )}
                    <PhoneLink phone={complaint.customerPhone} className="text-xs" />
                  </p>
                )}
                <p className="mt-1.5 whitespace-pre-wrap">{complaint.note}</p>
              </div>

              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDate(complaint.businessDate)}
              </span>
            </div>

            {/*
             * Which lines, and therefore which orchard. The name is a link
             * because "what else came from there" is the next question every
             * single time, and it used to be unanswerable.
             */}
            {showSource && complaint.items.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {complaint.items.map((item) => (
                  <li key={item.itemId}>
                    {item.source ? (
                      <Link
                        href={`/owner/sources/${item.source}` as Route}
                        className="inline-flex min-h-11 items-center gap-1 rounded-md bg-subtle px-2 py-1 text-xs font-medium text-primary-ink transition-colors hover:bg-primary-softer sm:min-h-0"
                      >
                        <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                        {item.sourceName}
                        <span className="text-muted-foreground">· {item.productName}</span>
                      </Link>
                    ) : (
                      <span className="inline-flex flex-col rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                        <span>
                          {item.productName} · {t('complaint.noSource')}
                        </span>
                        {/* Said, not hidden in a tooltip a phone cannot show. */}
                        <span className="text-[0.6875rem]">{t('complaint.noSourceHint')}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {complaint.resolved && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                <p className="min-w-0 text-xs text-muted-foreground">
                  <span className="font-medium">{t('complaint.resolvedOn')}:</span>{' '}
                  {complaint.resolution || t('orders.noResolutionNote')}
                  {complaint.resolvedAt && ` · ${formatDateTime(complaint.resolvedAt)}`}
                </p>
                <Button
                  variant="quiet"
                  size="sm"
                  loading={reopenState.isLoading && reopenState.originalArgs?.id === complaint.id}
                  onClick={() => reopenOne(complaint)}
                >
                  <RotateCcw aria-hidden className="h-4 w-4" />
                  {t('orders.complaintReopen')}
                </Button>
              </div>
            )}

            {!complaint.resolved && (
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={() => setResolving(complaint)}>
                  {t('complaint.resolve')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {resolving && (
        <ResolveModal
          key={resolving.id}
          complaint={resolving}
          onClose={() => setResolving(null)}
          onResolved={(complaint) =>
            toast(`${complaint.orderCode} · ${t('complaint.resolved')}`, 'success', {
              action: { label: t('app.undo'), onClick: () => void reopenOne(complaint) },
            })
          }
        />
      )}
    </>
  );
}

/**
 * Closing one out. The note is optional but offered, because "what did we do
 * about it" is the part that is forgotten first and asked about later. Mounted
 * only while open, so a note written for one complaint never lands on the next.
 */
function ResolveModal({
  complaint,
  onClose,
  onResolved,
}: {
  complaint: Complaint;
  onClose: () => void;
  onResolved: (complaint: Complaint) => void;
}) {
  const [resolve] = useResolveComplaintMutation();
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await resolve({ id: complaint.id, resolution: resolution.trim() }).unwrap();
      onClose();
      onResolved(complaint);
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
      title={`${t('complaint.resolve')} · ${complaint.orderCode}`}
      dirty={resolution.trim().length > 0}
      footerLead={error ? <FormErrorSummary message={error} /> : undefined}
      footer={
        <>
          <ModalCancel disabled={busy} />
          <Button variant="success" loading={busy} onClick={submit}>
            {t('complaint.resolve')}
          </Button>
        </>
      }
    >
      <p className="mb-3 rounded-lg bg-muted p-3 text-sm">{complaint.note}</p>

      <Field label={t('complaint.resolution')} htmlFor="resolution" hint={t('app.optional')}>
        <Textarea
          id="resolution"
          rows={3}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
