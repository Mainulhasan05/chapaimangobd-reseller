'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import type { CatalogItem } from '@/lib/types';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, MoneyInput } from '@/components/ui/form';

export default function CatalogPage() {
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<{ products: CatalogItem[] }>('/reseller/catalog'),
  });

  return (
    <>
      <PageHeader title={t('nav.catalog')} subtitle={t('catalog.priceFloorHelp')} />

      {catalog.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {catalog.data?.products.length === 0 && <EmptyState title={t('app.none')} />}

      <div className="grid gap-3 sm:grid-cols-2">
        {catalog.data?.products.map((product) => (
          <CatalogRow key={product.id} product={product} />
        ))}
      </div>
    </>
  );
}

function CatalogRow({ product }: { product: CatalogItem }) {
  const queryClient = useQueryClient();

  // Latin digits, because this value is parsed back on save. Seeded once: the
  // parent keys this row by product id, so a different product mounts a fresh
  // form rather than having one pushed into it by an effect.
  const [price, setPrice] = useState(() =>
    formatMoneyPlain(product.sellPrice ?? product.costPrice)
  );
  const [hidePrice, setHidePrice] = useState(product.hidePrice);
  const [isListed, setIsListed] = useState(product.isListed);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/reseller/catalog/${product.id}`, {
        sellPrice: Number(price),
        hidePrice,
        isListed,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog'] }),
  });

  const errors = fieldErrors(save.error);
  const margin = Number(price) - product.costPrice;

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{product.name}</h3>
          <p className="text-xs text-muted-foreground">
            {t('catalog.costPrice')} {formatMoney(product.costPrice)} / {product.unit} ·{' '}
            {t('catalog.minOrderQty')} {formatNumber(product.minOrderQty)} {product.unit}
          </p>
          {product.maxSellPrice != null && (
            <p className="text-xs text-muted-foreground">
              {t('catalog.maxSellPrice')} {formatMoney(product.maxSellPrice)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {product.activated ? (
            <Badge tone={isListed ? 'success' : 'neutral'}>
              {isListed ? t('catalog.listed') : t('catalog.notActivated')}
            </Badge>
          ) : (
            <Badge tone="warning">{t('catalog.notActivated')}</Badge>
          )}
          <Badge tone={product.inStock ? 'neutral' : 'danger'}>
            {product.inStock ? t('catalog.inStock') : t('catalog.outOfStock')}
          </Badge>
        </div>
      </div>

      <Field
        label={t('catalog.sellPrice')}
        htmlFor={`price-${product.id}`}
        error={errors.sellPrice}
        hint={
          Number.isFinite(margin) && margin >= 0
            ? `${t('order.yourProfit')} ${formatMoney(margin)} / ${product.unit}`
            : undefined
        }
        className="mb-3"
      >
        <MoneyInput
          id={`price-${product.id}`}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </Field>

      <div className="mb-3 space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isListed}
            onChange={(e) => setIsListed(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{t('catalog.listed')}</span>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={hidePrice}
            onChange={(e) => setHidePrice(e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            {t('catalog.hidePrice')}
            <span className="block text-xs text-muted-foreground">
              {t('catalog.hidePriceHelp')}
            </span>
          </span>
        </label>
      </div>

      {save.error && !errors.sellPrice && (
        <p className="mb-2 text-xs text-danger">{errorMessage(save.error)}</p>
      )}

      <Button size="sm" full loading={save.isPending} onClick={() => save.mutate()}>
        {product.activated ? t('app.save') : t('catalog.activate')}
      </Button>
    </Card>
  );
}
