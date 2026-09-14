'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { api, ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import type { DeliveryZone, PaymentMode, PublicShop } from '@/lib/types';
import { Alert, Badge, Card, StickyBar } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { QuantityStepper } from '@/components/ui/stepper';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { PhoneField } from '@/components/ui/phone-field';
import { ProductThumb } from '@/components/ui/product-image';

type Line = { product: string; quantity: number };

/** The submit button lives outside the form, in the bar pinned to the viewport. */
const FORM_ID = 'shop-order-form';

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
        <CircleCheck className="mx-auto mb-3 h-12 w-12 text-success" />
        <h2 className="mb-2 text-lg font-semibold">{t('shop.orderPlaced')}</h2>
        <p className="mb-5 text-sm text-muted-foreground">{t('shop.orderPlacedHelp')}</p>

        <p className="mb-1 text-sm text-muted-foreground">{t('order.code')}</p>
        <p className="tabular mb-6 text-3xl font-semibold">{placed}</p>

        <Link href={`/track?code=${placed}`} className="block">
          <Button variant="outline" full size="lg">
            {t('shop.trackOrder')}
          </Button>
        </Link>
      </Card>
    );
  }

  const errors = fieldErrors(submit.error);
  // In Bengali from the error code, never the server's English sentence. A shop
  // closed between loading the page and pressing the button answers
  // 409 SHOP_NOT_ACCEPTING, which reads as exactly that.
  const generalError =
    submit.error instanceof ApiError && !submit.error.fields ? errorMessage(submit.error) : null;

  const set =
    (key: keyof typeof customer) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setCustomer((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <>
      <form
        id={FORM_ID}
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
              <Card
                key={product.id}
                className={quantity > 0 ? 'ring-2 ring-primary' : undefined}
              >
                <div className="flex items-start gap-3">
                  {/*
                   * A mango shop with no photographs of mangoes was asking people
                   * to buy fruit from a spreadsheet. The largest thumb on offer,
                   * because this is the only screen where the photograph is the
                   * thing being sold rather than a row marker.
                   */}
                  <ProductThumb images={product.images} alt={product.name} size="lg" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium">{product.name}</h3>
                      {!product.inStock && <Badge tone="danger">{t('catalog.outOfStock')}</Badge>}
                    </div>

                    <p className="mt-0.5 font-semibold text-[oklch(0.45_0.14_70)]">
                      {product.priceHidden
                        ? t('shop.priceOnCall')
                        : `${formatMoney(product.price ?? 0)} / ${tUnit(product.unit)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('catalog.minOrderQty')} {formatNumber(product.minOrderQty)} {tUnit(product.unit)}
                    </p>
                  </div>
                </div>

                {product.inStock && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <QuantityStepper
                      id={`qty-${product.id}`}
                      value={quantity}
                      step={product.step}
                      min={product.minOrderQty}
                      unit={product.unit}
                      onChange={(value) =>
                        setLines((prev) => ({ ...prev, [product.id]: value }))
                      }
                    />

                    {quantity > 0 && !product.priceHidden && (
                      <span className="tabular text-sm font-medium">
                        {formatMoney((product.price ?? 0) * quantity)}
                      </span>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">{t('shop.deliveryAddress')}</h2>

          <Field label={t('shop.yourName')} htmlFor="name" error={errors['customer.name']} required>
            <Input
              id="name"
              value={customer.name}
              onChange={set('name')}
              autoComplete="name"
              required
            />
          </Field>

          <PhoneField
            id="phone"
            label={t('shop.yourPhone')}
            value={customer.phone}
            onChange={(phone) => setCustomer((prev) => ({ ...prev, phone }))}
            error={errors['customer.phone'] ?? errors.phone}
            required
          />

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

          <Field
            label={t('order.address')}
            htmlFor="address"
            error={errors['customer.address']}
            required
          >
            <Textarea
              id="address"
              rows={2}
              value={customer.address}
              onChange={set('address')}
              autoComplete="street-address"
              required
            />
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

          <Field label={t('app.notes')} htmlFor="note" hint={t('app.optional')} className="mb-0">
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
      </form>

      {/*
       * The total and the button follow the viewport rather than sitting at the
       * end of a long scroll. On a phone with eight products the decision and the
       * number behind it were previously never on screen at the same time.
       */}
      <StickyBar>
        {selected.length > 0 && (
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {formatNumber(selected.length)} {t('shop.itemsSelected')}
            </span>
            {!anyHidden && (
              <span className="tabular text-lg font-semibold">
                {formatMoney(itemsTotal + deliveryCharge)}
              </span>
            )}
          </div>
        )}

        <Button
          type="submit"
          form={FORM_ID}
          full
          size="lg"
          loading={submit.isPending}
          disabled={selected.length === 0}
        >
          {selected.length === 0 ? t('shop.emptyCart') : t('shop.placeOrder')}
        </Button>
      </StickyBar>
    </>
  );
}
