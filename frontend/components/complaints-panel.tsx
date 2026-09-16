'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, MessageSquareWarning } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t, tComplaintKind } from '@/lib/i18n/bn';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Complaint } from '@/lib/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Alert, Badge, EmptyState } from '@/components/ui/layout';
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
}: {
  complaints: Complaint[];
  /** On the orchard screen and the complaints page, where the order is not implied. */
  showOrder?: boolean;
  showSource?: boolean;
}) {
  const [resolving, setResolving] = useState<Complaint | null>(null);

  if (complaints.length === 0) {
    return <EmptyState icon={MessageSquareWarning} title={t('complaint.none')} />;
  }

  return (
    <>
      <ul className="space-y-2">
        {complaints.map((complaint) => (
          <li
            key={complaint.id}
            className="rounded-lg border border-border p-3 text-sm"
          >
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
                      className="tabular rounded-md bg-subtle px-1.5 py-0.5 text-xs font-semibold text-primary-ink hover:bg-primary-softer"
                    >
                      {complaint.orderCode}
                    </Link>
                  )}
                </div>
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
                        className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-1 text-xs font-medium text-primary-ink transition-colors hover:bg-primary-softer"
                      >
                        <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                        {item.sourceName}
                        <span className="text-muted-foreground">· {item.productName}</span>
                      </Link>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                        title={t('complaint.noSourceHint')}
                      >
                        {item.productName} · {t('complaint.noSource')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {complaint.resolved && complaint.resolution && (
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                <span className="font-medium">{t('complaint.resolvedOn')}:</span>{' '}
                {complaint.resolution}
                {complaint.resolvedAt && ` · ${formatDateTime(complaint.resolvedAt)}`}
              </p>
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

      <ResolveModal complaint={resolving} onClose={() => setResolving(null)} />
    </>
  );
}

/**
 * Closing one out. The note is optional but offered, because "what did we do
 * about it" is the part that is forgotten first and asked about later.
 */
function ResolveModal({
  complaint,
  onClose,
}: {
  complaint: Complaint | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [resolution, setResolution] = useState('');

  const resolve = useMutation({
    mutationFn: () =>
      api.post(`/owner/complaints/${complaint!.id}/resolve`, { resolution }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['complaints'] });
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      setResolution('');
      onClose();
      toast(t('complaint.resolved'));
    },
  });

  if (!complaint) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('complaint.resolve')}
      dirty={resolution.trim().length > 0}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.close')}
          </Button>
          <Button loading={resolve.isPending} onClick={() => resolve.mutate()}>
            {t('complaint.resolve')}
          </Button>
        </>
      }
    >
      {resolve.error && <Alert tone="danger">{errorMessage(resolve.error)}</Alert>}

      <p className="mb-3 rounded-lg bg-muted p-3 text-sm">{complaint.note}</p>

      <Field label={t('complaint.resolution')} htmlFor="resolution">
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
