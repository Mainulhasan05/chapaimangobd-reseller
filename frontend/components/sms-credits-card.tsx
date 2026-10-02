'use client';

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { toLatinDigits } from '@/lib/phone';
import { useBuySmsCreditsMutation, useGetSmsCreditsQuery } from '@/lib/store/endpoints/reseller';
import { Alert, Card, CardHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * SMS credits: how many the reseller holds, what one costs, and a way to buy.
 *
 * Rendered only while the owner's master switch is on (PLAN-2, "hidden behind
 * features.sms"). Credits are paid from the wallet, so buying them moves the
 * balance and the ledger; the endpoint refreshes both.
 */
export function SmsCreditsCard({ readOnly = false }: { readOnly?: boolean }) {
  const toast = useToast();
  const [quantity, setQuantity] = useState('');
  const [tried, setTried] = useState(false);

  const info = useGetSmsCreditsQuery();
  const [buyCredits, buying] = useBuySmsCreditsMutation();

  const credits = Number(toLatinDigits(quantity));
  const validQuantity = Number.isInteger(credits) && credits >= 1 && credits <= 10_000;

  // The same shape as the card, so the wallet page does not jump when it lands.
  if (info.isLoading) {
    return (
      <Card className="mb-6" aria-busy="true">
        <Skeleton className="mb-2 h-5 w-32" />
        <Skeleton className="mb-4 h-4 w-56" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </Card>
    );
  }

  if (!info.data?.featureEnabled) return null;
  const { smsCredits, pricePerCredit, available } = info.data;

  const buy = async () => {
    setTried(true);
    if (!validQuantity) return;
    try {
      const result = await buyCredits({ credits }).unwrap();
      setQuantity('');
      setTried(false);
      toast(tf('creditsCard.bought', { n: formatNumber(credits), amount: formatMoney(result.charged) }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader title={t('smsCredits.title')} subtitle={t('smsCredits.subtitle')} />

      {!available && <Alert tone="neutral">{t('smsCredits.notEnabled')}</Alert>}
      {buying.error && <Alert tone="danger">{errorMessage(buying.error)}</Alert>}

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
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            buy();
          }}
        >
          <Field
            className="mb-0 flex-1"
            label={t('smsCredits.quantity')}
            htmlFor="sms-credits"
            error={(quantity || tried) && !validQuantity ? t('smsCredits.invalidQuantity') : undefined}
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
              invalid={(Boolean(quantity) || tried) && !validQuantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          <Button type="submit" className="sm:mt-6" loading={buying.isLoading}>
            {t('smsCredits.buy')}
          </Button>
        </form>
      )}
    </Card>
  );
}
