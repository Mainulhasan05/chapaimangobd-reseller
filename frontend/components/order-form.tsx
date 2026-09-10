'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { DeliveryZone, PaymentMode, PublicShop } from '@/lib/types';
import { Alert, Badge, Card } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

type Line = { product: string; quantity: number };

export function OrderForm({
  slug,
  shop,
  zones,
}: {
  slug: string;
  shop: PublicShop;
  zones: DeliveryZone[];
}) {
  /**
   * Generated once when the form mounts and sent with the order. Disabling the
   * submit button is not a guard: mobile Chrome on a flaky connection retries the
   * POST itself, and the server uses this to return the first order instead of
   * creating a second one.
   */
  const [submissionId] = useState(() => crypto.randomUUID());

  const [lines, setLines] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState({
    name: '',
    phone: '',
    address: '',
    district: '',
    note: '',
  });
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cod');
  const [placed, setPlaced] = useState<string | null>(null);

  const districts = useMemo(
    () => zones.flatMap((zone) => zone.districts.map((d) => ({ district: d, charge: zone.charge }))),
    [zones]
  );

  const deliveryCharge = districts.find((d) => d.district === customer.district)?.charge ?? 0;

  const selected: Line[] = Object.entries(lines)
    .filter(([, quantity]) => quantity > 0)
    .map(([product, quantity]) => ({ product, quantity }));

  // Only priced products can be totalled. A hidden-price line shows no figure,
  // which is the point of hiding it.
  const anyHidden = selected.some(
    (line) => shop.products.find((p) => p.id === line.product)?.priceHidden
  );

  const itemsTotal = selected.reduce((sum, line) => {
    const product = shop.products.find((p) => p.id === line.product);
    return sum + (product?.price ?? 0) * line.quantity;
  }, 0);

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ orderCode: string; duplicate: boolean }>(`/public/shop/${slug}/orders`, {
        submissionId,
        paymentMode,
        customer: {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          district: customer.district,
          ...(customer.note ? { note: customer.note } : {}),
        },
        items: selected,
      }),
    onSuccess: (data) => setPlaced(data.orderCode),
  });

  if (placed) {
    return (
      <Card className="text-center">
        <h2 className="mb-2 text-lg font-semibold text-success">{t('shop.orderPlaced')}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('shop.orderPlacedHelp')}</p>
        <p className="mb-1 text-sm text-muted-foreground">{t('order.code')}</p>
        <p className="tabular mb-5 text-2xl font-semibold">{placed}</p>
        <Link href={`/track?code=${placed}`}>
          <Button variant="outline">{t('shop.trackOrder')}</Button>
        </Link>
      </Card>
    );
  }

  const errors = fieldErrors(submit.error);
  const generalError =
    submit.error instanceof ApiError && !submit.error.fields ? submit.error.message : null;

  const set =
    (key: keyof typeof customer) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setCustomer((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      {generalError && <Alert tone="danger">{generalError}</Alert>}

      <div className="mb-6 space-y-3">
        {shop.products.map((product) => {
          const quantity = lines[product.id] ?? 0;
          return (
            <Card key={product.id} className={quantity > 0 ? 'ring-1 ring-primary' : undefined}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium">{product.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {product.priceHidden
                      ? t('shop.priceOnCall')
                      : `${formatMoney(product.price ?? 0)} / ${product.unit}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('catalog.minOrderQty')} {formatNumber(product.minOrderQty)} {product.unit}
                  </p>
                </div>
                {!product.inStock && <Badge tone="danger">{t('catalog.outOfStock')}</Badge>}
              </div>

              {product.inStock && (
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    className="tabular w-32"
                    min={0}
                    step={product.step}
                    placeholder={`0 ${product.unit}`}
                    value={quantity || ''}
                    onChange={(e) =>
                      setLines((prev) => ({ ...prev, [product.id]: Number(e.target.value) || 0 }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">{product.unit}</span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="mb-6">
        <h2 className="mb-4 font-semibold">{t('shop.deliveryAddress')}</h2>

        <Field label={t('shop.yourName')} htmlFor="name" error={errors['customer.name']} required>
          <Input id="name" value={customer.name} onChange={set('name')} autoComplete="name" required />
        </Field>

        <Field
          label={t('shop.yourPhone')}
          htmlFor="phone"
          hint={t('auth.phoneHint')}
          error={errors['customer.phone'] ?? errors.phone}
          required
        >
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={customer.phone}
            onChange={set('phone')}
            required
          />
        </Field>

        <Field label={t('order.district')} htmlFor="district" error={errors.district} required>
          <Select id="district" value={customer.district} onChange={set('district')} required>
            <option value="">{t('app.search')}</option>
            {districts.map((d) => (
              <option key={d.district} value={d.district}>
                {d.district} · {formatMoney(d.charge)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('order.address')} htmlFor="address" error={errors['customer.address']} required>
          <Textarea id="address" rows={2} value={customer.address} onChange={set('address')} required />
        </Field>

        <Field label={t('order.paymentMode')} htmlFor="paymentMode">
          <Select
            id="paymentMode"
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
          >
            <option value="cod">{t('order.cod')}</option>
            <option value="prepaid">{t('order.prepaid')}</option>
          </Select>
        </Field>

        <Field label={t('app.notes')} htmlFor="note" hint={t('app.optional')}>
          <Textarea id="note" rows={2} value={customer.note} onChange={set('note')} />
        </Field>
      </Card>

      {selected.length > 0 && (
        <dl className="mb-4 space-y-1 rounded-lg bg-muted p-4 text-sm">
          {!anyHidden && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('order.items')}</dt>
              <dd className="tabular">{formatMoney(itemsTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('order.deliveryCharge')}</dt>
            <dd className="tabular">{formatMoney(deliveryCharge)}</dd>
          </div>
          {!anyHidden && (
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <dt>{t('app.total')}</dt>
              <dd className="tabular">{formatMoney(itemsTotal + deliveryCharge)}</dd>
            </div>
          )}
          {anyHidden && (
            <p className="pt-1 text-xs text-muted-foreground">{t('shop.priceOnCall')}</p>
          )}
        </dl>
      )}

      <Button
        type="submit"
        full
        size="lg"
        loading={submit.isPending}
        disabled={selected.length === 0}
      >
        {selected.length === 0 ? t('shop.emptyCart') : t('shop.placeOrder')}
      </Button>
    </form>
  );
}
