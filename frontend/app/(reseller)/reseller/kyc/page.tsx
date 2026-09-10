'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { sessionKey } from '@/lib/session';
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
  const approved = status === 'approved';

  const requiredDone = DOCUMENTS.filter((doc) => doc.required && files[doc.field]).length;
  const totalChosen = DOCUMENTS.filter((doc) => files[doc.field]).length;
  const hasRequired = requiredDone === REQUIRED_COUNT;

  return (
    <>
      <PageHeader
        title={t('kyc.title')}
        subtitle={t('kyc.gateHelp')}
        action={<Badge tone={statusTone(status)}>{t(STATUS_LABEL[status])}</Badge>}
      />

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

      {kyc.data?.submission && (
        <Card className="mb-4">
          <CardHeader
            title={t('kyc.viewDocuments')}
            subtitle={formatDateTime(kyc.data.submission.createdAt)}
            action={
              <Badge tone={statusTone(kyc.data.submission.status)}>
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

      {!approved && (
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
