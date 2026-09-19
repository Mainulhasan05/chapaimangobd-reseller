'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { api, ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { useReadOnlyAccount } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain } from '@/lib/format';
import type { CatalogItem, DeliveryZone, PaymentMode } from '@/lib/types';
import { Alert, Card, CardHeader, EmptyState, ErrorState, PageHeader, StickyBar } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { CardGridSkeleton } from '@/components/ui/skeleton';
import { QuantityStepper } from '@/components/ui/stepper';
import { useToast } from '@/components/ui/toast';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { DistrictSelect } from '@/components/ui/district-field';
import { PhoneField } from '@/components/ui/phone-field';

type Line = { quantity: string; sellPrice: string };

/**
 * Half of a reseller customers phone or message instead of using the form, so
 * this exists to stop them filling in their own public form as a data entry
 * screen. It skips pending: the reseller already has the customer on the line,
 * so the wallet is debited immediately.
 */
export default function ManualOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const readOnly = useReadOnlyAccount();

  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<{ products: CatalogItem[] }>('/reseller/catalog'),
  });

  const zones = useQuery({
    queryKey: ['zones'],
    queryFn: () => api.get<{ zones: DeliveryZone[] }>('/public/delivery-zones'),
  });

  const [lines, setLines] = useState<Record<string, Line>>({});
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cod');
  const [customer, setCustomer] = useState({
    name: '',
    phone: '',
    address: '',
    district: '',
    note: '',
  });

  /*
   * Every box this shop actually sells, flattened: a line is a box, not a
   * product, so two elevens and three sixes is two lines. See docs/adr/0021.
   */
  const boxes = (catalog.data?.products ?? [])
    .filter((product) => product.isListed)
    .flatMap((product) =>
      product.variants
        .filter((variant) => variant.activated && variant.isListed && variant.isAvailable)
        .map((variant) => ({ product, variant }))
    );
  const boxById = new Map(boxes.map((box) => [box.variant.id, box]));

  const districts = (zones.data?.zones ?? []).flatMap((zone) =>
    zone.districts.map((district) => ({ district, charge: zone.charge }))
  );
  const deliveryCharge = districts.find((d) => d.district === customer.district)?.charge ?? 0;

  const selected = Object.entries(lines).filter(([, line]) => Number(line.quantity) > 0);

  const costSubtotal = selected.reduce((sum, [id, line]) => {
    const box = boxById.get(id);
    return sum + (box?.variant.costPrice ?? 0) * Number(line.quantity);
  }, 0);

  const sellSubtotal = selected.reduce(
    (sum, [, line]) => sum + Number(line.sellPrice || 0) * Number(line.quantity),
    0
  );

  const create = useMutation({
    mutationFn: () =>
      api.post<{ order: { id: string; orderCode: string } }>('/reseller/orders', {
        paymentMode,
        customer: {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          district: customer.district,
          ...(customer.note ? { note: customer.note } : {}),
        },
        items: selected.map(([variant, line]) => ({
          product: boxById.get(variant)?.product.id ?? '',
          variant,
          // Whole boxes.
          quantity: Number(line.quantity),
          sellPrice: Number(line.sellPrice),
        })),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      router.push('/reseller/orders');
      // This route skips pending and debits the wallet immediately, so it says so.
      toast(t('order.createdToast'));
    },
  });

  // A deactivated account takes no new orders. See docs/adr/0011.
  if (readOnly) {
    return (
      <>
        <PageHeader title={t('order.manualOrder')} />
        <EmptyState
          icon={Lock}
          title={t('inactive.bannerTitle')}
          description={t('inactive.noNewOrders')}
          action={
            <Link href="/reseller/orders">
              <Button variant="outline">{t('nav.orders')}</Button>
            </Link>
          }
        />
      </>
    );
  }

  if (catalog.isLoading) {
    return (
      <>
        <PageHeader title={t('order.manualOrder')} />
        <CardGridSkeleton count={3} />
      </>
    );
  }

  if (catalog.isError) {
    return (
      <>
        <PageHeader title={t('order.manualOrder')} />
        <ErrorState
          onRetry={() => catalog.refetch()}
          isRetrying={catalog.isFetching}
          error={catalog.error}
        />
      </>
    );
  }

  const errors = fieldErrors(create.error);
  const generalError =
    create.error instanceof ApiError && !create.error.fields ? errorMessage(create.error) : null;

  const setLine = (id: string, key: keyof Line, value: string) =>
    setLines((prev) => {
      const current = prev[id] ?? { quantity: '', sellPrice: '' };
      return { ...prev, [id]: { ...current, [key]: value } };
    });

  const setCustomerField =
    (key: keyof typeof customer) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setCustomer((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <PageHeader title={t('order.manualOrder')} subtitle={t('order.confirmHelp')} />

      {generalError && <Alert tone="danger">{generalError}</Alert>}

      <Card className="mb-4">
        <CardHeader title={t('order.items')} />

        {boxes.length === 0 && (
          <Alert tone="warning">{t('catalog.notActivated')}</Alert>
        )}

        <div className="space-y-3">
          {boxes.map(({ product, variant }) => {
            const line = lines[variant.id];
            const active = Number(line?.quantity) > 0;

            return (
              <div
                key={variant.id}
                className={`rounded-lg border p-3 ${active ? 'border-primary' : 'border-border'}`}
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {product.name} <span className="text-muted-foreground">· {variant.label}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('catalog.costPrice')} {formatMoney(variant.costPrice)} /{' '}
                    {t('catalog.perBox')}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('order.boxes')} className="mb-0">
                    <QuantityStepper
                      value={Number(line?.quantity) || 0}
                      suffix={t('order.boxes')}
                      onChange={(value) =>
                        setLine(variant.id, 'quantity', value ? String(value) : '')
                      }
                    />
                  </Field>

                  <Field label={t('catalog.sellPrice')} hint={t('catalog.perBox')} className="mb-0">
                    <MoneyInput
                      value={line?.sellPrice ?? formatMoneyPlain(variant.sellPrice ?? 0)}
                      onChange={(e) => setLine(variant.id, 'sellPrice', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('order.customer')} />

        <Field label={t('shop.yourName')} htmlFor="name" error={errors['customer.name']} required>
          <Input id="name" value={customer.name} onChange={setCustomerField('name')} required />
        </Field>

        <PhoneField
          id="phone"
          label={t('shop.yourPhone')}
          value={customer.phone}
          onChange={(phone) => setCustomer((prev) => ({ ...prev, phone }))}
          error={errors['customer.phone'] ?? errors.phone}
          required
        />

        {/* All sixty-four, searchable, deliverable ones first. lib/districts.ts. */}
        <Field
          label={t('order.district')}
          htmlFor="district"
          error={errors.district}
          hint={
            deliveryCharge > 0
              ? `${t('order.deliveryCharge')} ${formatMoney(deliveryCharge)}`
              : undefined
          }
          required
        >
          <DistrictSelect
            id="district"
            value={customer.district}
            onChange={(district) => setCustomer((prev) => ({ ...prev, district }))}
            deliverable={districts.map((d) => d.district)}
            invalid={Boolean(errors.district)}
          />
        </Field>

        <Field label={t('order.address')} htmlFor="address" error={errors['customer.address']} required>
          <Textarea
            id="address"
            rows={2}
            value={customer.address}
            onChange={setCustomerField('address')}
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

        <Field label={t('app.notes')} htmlFor="note" hint={t('app.optional')}>
          <Textarea id="note" rows={2} value={customer.note} onChange={setCustomerField('note')} />
        </Field>
      </Card>

      {selected.length > 0 && (
        <dl className="mb-4 space-y-1 rounded-lg bg-muted p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('order.deliveryCharge')}</dt>
            <dd className="tabular">{formatMoney(deliveryCharge)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('order.customerTotal')}</dt>
            <dd className="tabular font-semibold">{formatMoney(sellSubtotal + deliveryCharge)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('order.walletDebit')}</dt>
            <dd className="tabular text-danger">{formatMoney(costSubtotal + deliveryCharge)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('order.yourProfit')}</dt>
            <dd className="tabular font-semibold text-success">
              {formatMoney(sellSubtotal - costSubtotal)}
            </dd>
          </div>
        </dl>
      )}

      <StickyBar>
        {selected.length > 0 && (
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">{t('order.walletDebit')}</span>
            <span className="tabular text-lg font-semibold text-danger">
              {formatMoney(costSubtotal + deliveryCharge)}
            </span>
          </div>
        )}
        <Button type="submit" size="lg" full loading={create.isPending} disabled={selected.length === 0}>
          {selected.length === 0 ? t('shop.emptyCart') : t('order.manualOrder')}
        </Button>
      </StickyBar>
    </form>
  );
}
