'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Hourglass, Lock, ShieldCheck } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { sessionKey, useReadOnlyAccount } from '@/lib/session';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { KycStatus } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  StickyBar,
  statusTone,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { CardGridSkeleton } from '@/components/ui/skeleton';
import { FileField } from '@/components/ui/file-field';
import { useToast } from '@/components/ui/toast';

type KycResponse = {
  /** The owner asked this reseller to verify. Nothing here is offered without it. */
  required: boolean;
  /** The module belongs on their screens: required, or already submitted. */
  visible: boolean;
  canSubmit: boolean;
  status: KycStatus;
  submission: {
    id: string;
    status: string;
    note?: string;
    documentTypes: string[];
    createdAt: string;
    reviewedAt?: string;
  } | null;
};

/** Field name must match the document type the API expects. */
const DOCUMENTS: { field: string; labelKey: DictKey; required: boolean; hintKey?: DictKey }[] = [
  { field: 'nid_front', labelKey: 'kyc.nidFront', required: true },
  { field: 'nid_back', labelKey: 'kyc.nidBack', required: true },
  { field: 'selfie', labelKey: 'kyc.selfie', required: false },
  { field: 'trade_license', labelKey: 'kyc.tradeLicense', required: false },
];

const STATUS_LABEL: Record<KycStatus, DictKey> = {
  not_submitted: 'kyc.notSubmitted',
  pending: 'kyc.pending',
  approved: 'kyc.approved',
  rejected: 'kyc.rejected',
};

const REQUIRED_COUNT = DOCUMENTS.filter((doc) => doc.required).length;

export default function KycPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const readOnly = useReadOnlyAccount();

  const kyc = useQuery({
    queryKey: ['kyc'],
    queryFn: () => api.get<KycResponse>('/reseller/kyc'),
  });

  const submit = useMutation({
    mutationFn: () => {
      const data = new FormData();
      Object.entries(files).forEach(([field, file]) => {
        if (file) data.set(field, file);
      });
      return api.upload('/reseller/kyc', data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kyc'] });
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      setFiles({});
      toast(t('kyc.pending'));
    },
    onError: async (error) => {
      // Another tab or device got a submission in first. Reloading shows it,
      // and the form gives way to the pending notice below.
      if (error instanceof ApiError && error.code === 'KYC_ALREADY_PENDING') {
        await queryClient.invalidateQueries({ queryKey: ['kyc'] });
      }
    },
  });

  if (kyc.isLoading) {
    return (
      <>
        <PageHeader title={t('kyc.title')} />
        <CardGridSkeleton count={4} />
      </>
    );
  }

  if (kyc.isError) {
    return (
      <>
        <PageHeader title={t('kyc.title')} />
        <ErrorState onRetry={() => kyc.refetch()} isRetrying={kyc.isFetching} error={kyc.error} />
      </>
    );
  }

  const status = kyc.data?.status ?? 'not_submitted';
  const required = Boolean(kyc.data?.required);
  const approved = status === 'approved';
  const pending = status === 'pending';

  /*
   * Nobody was asked, and nothing was ever submitted, so there is nothing on
   * this page to show. The tab is hidden too; this is for the reseller who
   * typed the address, followed an old link, or had the requirement lifted
   * between opening the page and it answering.
   */
  if (!kyc.data?.visible) {
    return (
      <>
        <PageHeader title={t('kyc.title')} />
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <Lock className="h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-bold">{t('kyc.notRequired')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t('kyc.notRequiredHelp')}</p>
        </Card>
      </>
    );
  }

  /*
   * One submission at a time: the API refuses a second while one waits for a
   * decision (409 KYC_ALREADY_PENDING), so the form is not offered then. A
   * deactivated account submits nothing at all, and neither does one the owner
   * has not asked: the module can be visible for documents already handed over
   * after the requirement was lifted.
   */
  const canSubmit =
    !readOnly && required && (status === 'not_submitted' || status === 'rejected');

  const requiredDone = DOCUMENTS.filter((doc) => doc.required && files[doc.field]).length;
  const totalChosen = DOCUMENTS.filter((doc) => files[doc.field]).length;
  const hasRequired = requiredDone === REQUIRED_COUNT;

  return (
    <>
      <PageHeader
        title={t('kyc.title')}
        // Only while the gate is real. With the requirement lifted this page is
        // a record of what was submitted, and promising a shop opening would lie.
        subtitle={required ? t('kyc.gateHelp') : undefined}
        action={
          <Badge tone={statusTone(status)} dot>
            {t(STATUS_LABEL[status])}
          </Badge>
        }
      />

      {/*
        * Before the upload buttons, not after them and not behind a link. Someone
        * about to photograph their national ID for a shop they joined last week
        * should not have to go looking for what happens to it.
        */}
      <Alert tone="primary" icon={ShieldCheck} title={t('kyc.privacyTitle')}>
        {t('kyc.privacyNote')}
      </Alert>

      {status === 'rejected' && kyc.data?.submission?.note && (
        <Alert tone="danger" title={t('kyc.rejected')}>
          {kyc.data.submission.note}
        </Alert>
      )}

      {approved && (
        <Card className="mb-4 flex flex-col items-center gap-2 py-8 text-center">
          <CircleCheck className="h-12 w-12 text-success" />
          <p className="text-lg font-bold">{t('kyc.approved')}</p>
          <p className="text-sm text-muted-foreground">{t('shop.shareHelp')}</p>
        </Card>
      )}

      {pending && (
        <Alert tone="warning" icon={Hourglass} title={t('kyc.pending')}>
          {t('kyc.pendingHelp')}
        </Alert>
      )}

      {submit.error && !canSubmit && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}

      {kyc.data?.submission && (
        <Card className="mb-4">
          <CardHeader
            title={t('kyc.viewDocuments')}
            subtitle={formatDateTime(kyc.data.submission.createdAt)}
            action={
              <Badge tone={statusTone(kyc.data.submission.status)} dot>
                {kyc.data.submission.status}
              </Badge>
            }
          />
          <ul className="flex flex-wrap gap-2">
            {kyc.data.submission.documentTypes.map((type) => (
              <li key={type}>
                <Badge tone="neutral">{type}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canSubmit && (
        <>
          <Card className="mb-4">
            <CardHeader
              title={t('kyc.submit')}
              subtitle={t('kyc.needRequired')}
              action={
                <span className="tabular shrink-0 text-sm font-semibold text-muted-foreground">
                  {t('kyc.progress')
                    .replace('{done}', formatNumber(totalChosen))
                    .replace('{total}', formatNumber(DOCUMENTS.length))}
                </span>
              }
            />

            {submit.error && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}

            {/*
             * A progress rail rather than a count alone. Four uploads on a phone
             * is long enough that "how much is left" is a real question.
             */}
            <div
              className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={totalChosen}
              aria-valuemin={0}
              aria-valuemax={DOCUMENTS.length}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  hasRequired ? 'bg-success' : 'bg-primary'
                }`}
                style={{ width: `${(totalChosen / DOCUMENTS.length) * 100}%` }}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {DOCUMENTS.map((doc) => (
                <FileField
                  key={doc.field}
                  id={doc.field}
                  label={t(doc.labelKey)}
                  required={doc.required}
                  value={files[doc.field] ?? null}
                  onChange={(file) => setFiles((prev) => ({ ...prev, [doc.field]: file }))}
                />
              ))}
            </div>
          </Card>

          <StickyBar>
            {hasRequired && (
              <p className="mb-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-success">
                <CircleCheck className="h-4 w-4" />
                {t('kyc.readyToSubmit')}
              </p>
            )}
            <Button
              full
              size="lg"
              loading={submit.isPending}
              disabled={!hasRequired}
              onClick={() => submit.mutate()}
            >
              {t('kyc.submit')}
            </Button>
          </StickyBar>
        </>
      )}
    </>
  );
}
