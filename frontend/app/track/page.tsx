'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatQuantity, formatDateTime } from '@/lib/format';
import type { PublicOrder } from '@/lib/types';
import { Alert, Badge, Card, statusTone } from '@/components/ui/layout';
import { Logo } from '@/components/ui/logo';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { PhoneField } from '@/components/ui/phone-field';

export default function TrackPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Suspense fallback={<Spinner />}>
        <TrackView />
      </Suspense>
    </main>
  );
}

function TrackView() {
  const params = useSearchParams();

  // The code can be prefilled from the confirmation screen, but the phone number
  // never is: it is the second factor that stops the code being an enumeration
  // oracle over other people names and addresses.
  const [code, setCode] = useState(() => params.get('code') ?? '');
  const [phone, setPhone] = useState('');

  const lookup = useMutation({
    mutationFn: () =>
      api.get<{ order: PublicOrder }>(
        `/public/track/${encodeURIComponent(code)}?phone=${encodeURIComponent(phone)}`
      ),
  });

  const order = lookup.data?.order;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Logo size="md" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{t('shop.trackOrder')}</h1>
          <p className="text-sm text-muted-foreground">{t('shop.trackHelp')}</p>
        </div>
      </div>

      <Card className="mb-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            lookup.mutate();
          }}
        >
          <Field label={t('order.code')} htmlFor="code" required>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="tabular uppercase"
              required
            />
          </Field>

          <PhoneField
            id="phone"
            label={t('shop.yourPhone')}
            value={phone}
            onChange={setPhone}
            required
          />

          <Button type="submit" full loading={lookup.isPending}>
            {t('app.search')}
          </Button>
        </form>
      </Card>

      {lookup.error && <Alert tone="danger">{errorMessage(lookup.error)}</Alert>}

      {order && (
        <Card>
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="tabular font-semibold">{order.orderCode}</span>
            <Badge tone={statusTone(order.status)} dot>
              {tStatus(order.status)}
            </Badge>
          </div>

          <ul className="mb-4 space-y-2 text-sm">
            {order.items.map((item, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span>
                  {item.productName}
                  <span className="block text-xs text-muted-foreground">
                    {formatQuantity(item.quantity, item.unit)} × {formatMoney(item.unitPrice)}
                  </span>
                </span>
                <span className="tabular">{formatMoney(item.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <dl className="space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('order.deliveryCharge')}</dt>
              <dd className="tabular">{formatMoney(order.deliveryCharge)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t('app.total')}</dt>
              <dd className="tabular">{formatMoney(order.total)}</dd>
            </div>
          </dl>

          {order.courier?.name && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t('order.courier')}: {order.courier.name}
              {order.courier.trackingNumber && ` · ${order.courier.trackingNumber}`}
            </p>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            {t('order.placedAt')}: {formatDateTime(order.placedAt)}
          </p>
        </Card>
      )}
    </>
  );
}
