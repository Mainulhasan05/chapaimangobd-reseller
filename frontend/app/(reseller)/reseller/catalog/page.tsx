'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useReadOnlyAccount } from '@/lib/session';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import type { CatalogItem } from '@/lib/types';
import { Badge, Card, EmptyState, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { CardGridSkeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { Field, MoneyInput } from '@/components/ui/form';
import { ProductThumb } from '@/components/ui/product-image';

export default function CatalogPage() {
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<{ products: CatalogItem[] }>('/reseller/catalog'),
  });

  return (
    <>
      <PageHeader title={t('nav.catalog')} subtitle={t('catalog.priceFloorHelp')} />

      {catalog.isLoading && <CardGridSkeleton />}

      {catalog.isError && (
        <ErrorState
          onRetry={() => catalog.refetch()}
          isRetrying={catalog.isFetching}
          error={catalog.error}
        />
      )}

      {catalog.isSuccess && catalog.data.products.length === 0 && (
        <EmptyState icon={Package} title={t('app.none')} />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.data?.products.map((product) => (
          <CatalogRow key={product.id} product={product} />
        ))}
      </div>
    </>
  );
}

function CatalogRow({ product }: { product: CatalogItem }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Prices and listings are writes a deactivated account no longer makes.
  const readOnly = useReadOnlyAccount();

  // Latin digits, because this value is parsed back on save. Seeded once: the
  // parent keys this row by product id, so a different product mounts a fresh
  // form rather than having one pushed into it by an effect.
  const [price, setPrice] = useState(() =>
    formatMoneyPlain(product.sellPrice ?? product.costPrice)
  );
  // Blank means no struck-through price on the landing page.
  const [regularPrice, setRegularPrice] = useState(() =>
    product.regularPrice != null ? formatMoneyPlain(product.regularPrice) : ''
  );
  const [hidePrice, setHidePrice] = useState(product.hidePrice);
  const [isListed, setIsListed] = useState(product.isListed);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/reseller/catalog/${product.id}`, {
        sellPrice: Number(price),
        regularPrice: regularPrice.trim() ? Number(regularPrice) : null,
        hidePrice,
        isListed,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      /*
       * This save previously produced no visible change at all. Nothing moved,
       * nothing was said, and a button that appears to do nothing gets pressed
       * again, which is how a price ends up saved twice.
       */
      toast(product.activated ? t('catalog.savedToast') : t('catalog.activatedToast'));
    },
  });

  const errors = fieldErrors(save.error);
  const margin = Number(price) - product.costPrice;
  return (
    <Card>
      <div className="mb-3 flex items-start gap-3">
        <ProductThumb images={product.images} alt={product.name} size="md" />

        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{product.name}</h3>
          <p className="text-xs text-muted-foreground">
            {t('catalog.costPrice')} {formatMoney(product.costPrice)} / {tUnit(product.unit)} ·{' '}
            {t('catalog.minOrderQty')} {formatNumber(product.minOrderQty)} {tUnit(product.unit)}
          </p>
          {product.maxSellPrice != null && (
            <p className="text-xs text-muted-foreground">
              {t('catalog.maxSellPrice')} {formatMoney(product.maxSellPrice)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {product.activated ? (
            <Badge tone={isListed ? 'success' : 'neutral'} dot>
              {isListed ? t('catalog.listed') : t('catalog.notActivated')}
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              {t('catalog.notActivated')}
            </Badge>
          )}
          <Badge tone={product.inStock ? 'neutral' : 'danger'} dot>
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
            ? `${t('order.yourProfit')} ${formatMoney(margin)} / ${tUnit(product.unit)}`
            : undefined
        }
        className="mb-3"
      >
        <MoneyInput
          id={`price-${product.id}`}
          disabled={readOnly}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </Field>

      <Field
        label={t('catalog.regularPrice')}
        htmlFor={`regular-${product.id}`}
        error={errors.regularPrice}
        hint={
          Number(regularPrice) > Number(price)
            ? `${t('landing.save')} ${formatMoney(Number(regularPrice) - Number(price))} / ${tUnit(product.unit)}`
            : t('catalog.regularPriceHint')
        }
        className="mb-3"
      >
        <MoneyInput
          id={`regular-${product.id}`}
          disabled={readOnly}
          value={regularPrice}
          onChange={(e) => setRegularPrice(e.target.value)}
        />
      </Field>

      {/*
       * Switches, not sixteen pixel checkboxes. Both of these are visible to
       * customers the moment they change, so the whole row is the target.
       */}
      <div className="mb-3 divide-y divide-border">
        <Switch
          checked={isListed}
          disabled={readOnly}
          onChange={setIsListed}
          label={t('catalog.listed')}
        />
        <Switch
          checked={hidePrice}
          disabled={readOnly}
          onChange={setHidePrice}
          label={t('catalog.hidePrice')}
          hint={t('catalog.hidePriceHelp')}
        />
      </div>

      {save.error && !errors.sellPrice && !errors.regularPrice && (
        <p className="mb-2 text-xs text-danger">{errorMessage(save.error)}</p>
      )}

      {!readOnly && (
        <Button full loading={save.isPending} onClick={() => save.mutate()}>
          {product.activated ? t('app.save') : t('catalog.activate')}
        </Button>
      )}
    </Card>
  );
}
