'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { toLatinDigits } from '@/lib/phone';
import type { SmsCreditsInfo } from '@/lib/types';
import { Alert, Card, CardHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';

/**
 * SMS credits: how many the reseller holds, what one costs, and a way to buy.
 *
 * Rendered only while the owner's master switch is on (PLAN-2, "hidden behind
 * features.sms"). Credits are paid from the wallet, so buying them moves the
 * balance and the ledger, which are refreshed with it.
 */
export function SmsCreditsCard({ readOnly = false }: { readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [quantity, setQuantity] = useState('');

  const info = useQuery({
    queryKey: ['sms-credits'],
    queryFn: () => api.get<SmsCreditsInfo>('/reseller/sms'),
  });

  const credits = Number(toLatinDigits(quantity));
  const validQuantity = Number.isInteger(credits) && credits >= 1 && credits <= 10_000;

  const buy = useMutation({
    mutationFn: () =>
      api.post<{ smsCredits: number; charged: number }>('/reseller/sms/purchase', { credits }),
    onSuccess: async () => {
      setQuantity('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sms-credits'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
        queryClient.invalidateQueries({ queryKey: ['ledger'] }),
      ]);
      toast(t('smsCredits.bought'));
    },
  });

  if (!info.data?.featureEnabled) return null;
  const { smsCredits, pricePerCredit, available } = info.data;

  return (
    <Card className="mb-6">
      <CardHeader title={t('smsCredits.title')} subtitle={t('smsCredits.subtitle')} />

      {!available && <Alert tone="neutral">{t('smsCredits.notEnabled')}</Alert>}
      {buy.error && <Alert tone="danger">{errorMessage(buy.error)}</Alert>}

      <dl className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-muted/60 p-3.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquare aria-hidden className="h-3.5 w-3.5" />
            {t('smsCredits.balance')}
          </dt>
          <dd className="tabular mt-1 text-lg font-semibold">{formatNumber(smsCredits)}</dd>
        </div>
        <div className="rounded-xl bg-muted/60 p-3.5">
          <dt className="text-xs text-muted-foreground">{t('smsCredits.price')}</dt>
          <dd className="tabular mt-1 text-lg font-semibold">{formatMoney(pricePerCredit)}</dd>
        </div>
      </dl>

      {!readOnly && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field
            className="mb-0 flex-1"
            label={t('smsCredits.quantity')}
            htmlFor="sms-credits"
            error={quantity && !validQuantity ? t('smsCredits.invalidQuantity') : undefined}
            hint={
              validQuantity
                ? `${t('smsCredits.cost')}: ${formatMoney(Math.round(credits * pricePerCredit * 100) / 100)}`
                : undefined
            }
          >
            <Input
              id="sms-credits"
              inputMode="numeric"
              className="tabular"
              value={quantity}
              invalid={Boolean(quantity) && !validQuantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          <Button
            className="sm:mt-6"
            loading={buy.isPending}
            disabled={!validQuantity}
            onClick={() => buy.mutate()}
          >
            {t('smsCredits.buy')}
          </Button>
        </div>
      )}
    </Card>
  );
}
