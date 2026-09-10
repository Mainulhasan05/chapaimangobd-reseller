'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { sessionKey } from '@/lib/session';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime } from '@/lib/format';
import type { KycStatus } from '@/lib/types';
import { Alert, Badge, Card, CardHeader, PageHeader, statusTone } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';

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
const DOCUMENTS: { field: string; labelKey: DictKey; required: boolean }[] = [
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

export default function KycPage() {
  const queryClient = useQueryClient();
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
    },
  });

  const status = kyc.data?.status ?? 'not_submitted';
  const approved = status === 'approved';
  const hasRequired = DOCUMENTS.filter((d) => d.required).every((d) => files[d.field]);

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
        <Alert tone="success" title={t('kyc.approved')}>
          {t('shop.shareHelp')}
        </Alert>
      )}

      {kyc.data?.submission && (
        <Card className="mb-4">
          <CardHeader
            title={t('kyc.title')}
            subtitle={formatDateTime(kyc.data.submission.createdAt)}
            action={
              <Badge tone={statusTone(kyc.data.submission.status)}>
                {kyc.data.submission.status}
              </Badge>
            }
          />
          <p className="text-sm text-muted-foreground">
            {kyc.data.submission.documentTypes.join(', ')}
          </p>
        </Card>
      )}

      {!approved && (
        <Card>
          <CardHeader title={t('kyc.submit')} />

          {submit.error && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}

          {DOCUMENTS.map((doc) => (
            <Field key={doc.field} label={t(doc.labelKey)} htmlFor={doc.field} required={doc.required}>
              <input
                id={doc.field}
                type="file"
                accept="image/*"
                className="w-full text-sm"
                onChange={(e) =>
                  setFiles((prev) => ({ ...prev, [doc.field]: e.target.files?.[0] ?? null }))
                }
              />
            </Field>
          ))}

          <Button
            loading={submit.isPending}
            disabled={!hasRequired}
            onClick={() => submit.mutate()}
          >
            {t('kyc.submit')}
          </Button>
        </Card>
      )}
    </>
  );
}
