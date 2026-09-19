'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useReadOnlyAccount } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
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

/** One box's row in the form: its price, its "was" price, and whether it sells. */
type BoxDraft = { price: string; regularPrice: string; isListed: boolean };

function CatalogRow({ product }: { product: CatalogItem }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Prices and listings are writes a deactivated account no longer makes.
  const readOnly = useReadOnlyAccount();

  /*
   * A price per box, because a six-kilo box and an eleven-kilo box are two
   * things with two prices. Latin digits, because these values are parsed back
   * on save. Seeded once: the parent keys this row by product id, so a
   * different product mounts a fresh form rather than having one pushed into it
   * by an effect. See docs/adr/0021.
   */
  const [boxes, setBoxes] = useState<Record<string, BoxDraft>>(() =>
    Object.fromEntries(
      product.variants.map((variant) => [
        variant.id,
        {
          // An unpriced box opens at what the owner charges, which is the floor.
          price: formatMoneyPlain(variant.sellPrice ?? variant.costPrice),
          // Blank means no struck-through price on the landing page.
          regularPrice:
            variant.regularPrice != null ? formatMoneyPlain(variant.regularPrice) : '',
          // A box this shop has never priced starts off its own form, so
          // activating a product does not silently list every size.
          isListed: variant.activated ? variant.isListed : false,
        },
      ])
    )
  );
  const [hidePrice, setHidePrice] = useState(product.hidePrice);
  const [isListed, setIsListed] = useState(product.isListed);

  const setBox = (id: string, patch: Partial<BoxDraft>) =>
    setBoxes((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  /*
   * Only the boxes this shop actually sells are sent. A box left out loses its
   * price row, which is exactly how a reseller says "I carry the six and not
   * the eleven". At least one has to stay, or there is nothing to sell.
   */
  const carried = product.variants.filter((variant) => boxes[variant.id]?.isListed);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/reseller/catalog/${product.id}`, {
        variants: carried.map((variant) => ({
          variant: variant.id,
          sellPrice: Number(boxes[variant.id].price),
          regularPrice: boxes[variant.id].regularPrice.trim()
            ? Number(boxes[variant.id].regularPrice)
            : null,
          isListed: true,
        })),
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
  /** The field key the API reports an error under, for this box's position. */
  const errorAt = (variantId: string, field: string) => {
    const index = carried.findIndex((v) => v.id === variantId);
    return index < 0 ? undefined : errors[`variants.${index}.${field}`];
  };

  const pricedCount = product.variants.filter((v) => v.activated).length;

  return (
    <Card>
      <div className="mb-3 flex items-start gap-3">
        <ProductThumb images={product.images} alt={product.name} size="md" />

        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{product.name}</h3>
          <p className="text-xs text-muted-foreground">
            {t('catalog.pricedBoxes')
              .replace('{done}', formatNumber(pricedCount))
              .replace('{total}', formatNumber(product.variants.length))}
          </p>
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
          <Badge tone={product.variants.some((v) => v.inStock) ? 'neutral' : 'danger'} dot>
            {product.variants.some((v) => v.inStock)
              ? t('catalog.inStock')
              : t('catalog.outOfStock')}
          </Badge>
        </div>
      </div>

      {/*
       * One block per box. The switch at its head is what puts that size on this
       * shop's form at all, so a reseller who only carries the small box turns
       * the big one off and never thinks about its price. docs/adr/0021.
       */}
      <ul className="mb-3 space-y-3">
        {product.variants.map((variant) => {
          const box = boxes[variant.id];
          const margin = Number(box.price) - variant.costPrice;
          const saving = Number(box.regularPrice) - Number(box.price);

          return (
            <li key={variant.id} className="rounded-xl border-2 border-border p-3">
              <div className="divide-y divide-border">
                <Switch
                  checked={box.isListed}
                  disabled={readOnly || !variant.isAvailable}
                  onChange={(checked) => setBox(variant.id, { isListed: checked })}
                  label={variant.label}
                  hint={
                    variant.isAvailable
                      ? `${t('catalog.costPrice')} ${formatMoney(variant.costPrice)}${
                          variant.maxSellPrice == null
                            ? ''
                            : ` · ${t('catalog.maxSellPrice')} ${formatMoney(variant.maxSellPrice)}`
                        }`
                      : t('catalog.outOfStockBox')
                  }
                />
              </div>

              {box.isListed && (
                <div className="mt-3">
                  <Field
                    label={t('catalog.sellPrice')}
                    htmlFor={`price-${variant.id}`}
                    error={errorAt(variant.id, 'sellPrice')}
                    hint={
                      Number.isFinite(margin) && margin >= 0
                        ? `${t('order.yourProfit')} ${formatMoney(margin)} / ${t('catalog.perBox')}`
                        : undefined
                    }
                    className="mb-3"
                  >
                    <MoneyInput
                      id={`price-${variant.id}`}
                      disabled={readOnly}
                      value={box.price}
                      onChange={(e) => setBox(variant.id, { price: e.target.value })}
                    />
                  </Field>

                  <Field
                    label={t('catalog.regularPrice')}
                    htmlFor={`regular-${variant.id}`}
                    error={errorAt(variant.id, 'regularPrice')}
                    hint={
                      saving > 0
                        ? `${t('landing.save')} ${formatMoney(saving)}`
                        : t('catalog.regularPriceHint')
                    }
                    className="mb-0"
                  >
                    <MoneyInput
                      id={`regular-${variant.id}`}
                      disabled={readOnly}
                      value={box.regularPrice}
                      onChange={(e) => setBox(variant.id, { regularPrice: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </li>
          );
        })}
      </ul>

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

      {save.error && Object.keys(errors).length === 0 && (
        <p className="mb-2 text-xs text-danger">{errorMessage(save.error)}</p>
      )}

      {!readOnly && (
        <Button
          full
          loading={save.isPending}
          // Nothing to save when no box is carried: the API refuses an empty
          // list, and the button would be a dead end rather than a choice.
          disabled={carried.length === 0}
          onClick={() => save.mutate()}
        >
          {product.activated ? t('app.save') : t('catalog.activate')}
        </Button>
      )}
    </Card>
  );
}
