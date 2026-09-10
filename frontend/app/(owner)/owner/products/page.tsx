'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import type { OwnerProduct, Source } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

const UNITS = ['kg', 'gram', 'litre', 'pcs', 'dozen', 'box'] as const;

type Draft = {
  name: string;
  description: string;
  unit: string;
  step: string;
  minOrderQty: string;
  costPrice: string;
  maxSellPrice: string;
  trackStock: boolean;
  stockQty: string;
  isAvailable: boolean;
  source: string;
};

const blank: Draft = {
  name: '',
  description: '',
  unit: 'kg',
  step: '0.5',
  minOrderQty: '5',
  costPrice: '',
  maxSellPrice: '',
  trackStock: false,
  stockQty: '0',
  isAvailable: true,
  source: '',
};

export default function OwnerProductsPage() {
  const [editing, setEditing] = useState<OwnerProduct | null>(null);
  const [creating, setCreating] = useState(false);

  const products = useQuery({
    queryKey: ['owner', 'products'],
    queryFn: () => api.get<{ products: OwnerProduct[] }>('/owner/products'),
  });

  return (
    <>
      <PageHeader
        title={t('nav.products')}
        action={<Button onClick={() => setCreating(true)}>{t('nav.products')} +</Button>}
      />

      {products.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {products.data?.products.length === 0 && <EmptyState title={t('app.none')} />}

      {products.data && products.data.products.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('nav.products')}</Th>
              <Th className="text-right">{t('catalog.costPrice')}</Th>
              <Th className="text-right">{t('catalog.maxSellPrice')}</Th>
              <Th className="text-right">{t('catalog.minOrderQty')}</Th>
              <Th className="text-right">{t('catalog.stockQty')}</Th>
              <Th>{t('app.status')}</Th>
              <Th className="text-right">{t('app.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {products.data.products.map((product) => (
              <tr key={product.id}>
                <Td>
                  <div className="font-medium">{product.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {typeof product.source === 'object' && product.source
                      ? product.source.name
                      : '—'}
                  </div>
                </Td>
                <Td className="tabular text-right">
                  {formatMoney(product.costPrice)} / {product.unit}
                </Td>
                <Td className="tabular text-right">
                  {product.maxSellPrice == null ? '—' : formatMoney(product.maxSellPrice)}
                </Td>
                <Td className="tabular text-right">
                  {formatNumber(product.minOrderQty)} {product.unit}
                </Td>
                <Td className="tabular text-right">
                  {product.trackStock ? formatNumber(product.stockQty ?? 0) : '∞'}
                </Td>
                <Td>
                  <Badge tone={product.isAvailable ? 'success' : 'neutral'}>
                    {product.isAvailable ? t('catalog.inStock') : t('catalog.outOfStock')}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditing(product)}>
                    {t('app.save')}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {(creating || editing) && (
        <ProductModal
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ProductModal({ product, onClose }: { product: OwnerProduct | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<FileList | null>(null);

  const sources = useQuery({
    queryKey: ['owner', 'sources'],
    queryFn: () => api.get<{ sources: Source[] }>('/owner/sources'),
  });

  const [draft, setDraft] = useState<Draft>(() =>
    product
      ? {
          name: product.name,
          description: product.description ?? '',
          unit: product.unit,
          step: String(product.step),
          minOrderQty: String(product.minOrderQty),
          // Latin digits: these values are parsed back on save.
          costPrice: formatMoneyPlain(product.costPrice),
          maxSellPrice: product.maxSellPrice == null ? '' : formatMoneyPlain(product.maxSellPrice),
          trackStock: product.trackStock,
          stockQty: String(product.stockQty ?? 0),
          isAvailable: product.isAvailable,
          source:
            typeof product.source === 'object' && product.source
              ? product.source._id
              : (product.source as string) ?? '',
        }
      : blank
  );

  const save = useMutation({
    mutationFn: () => {
      // Multipart, because product images upload with the same request.
      const data = new FormData();
      data.set('name', draft.name);
      if (draft.description) data.set('description', draft.description);
      data.set('unit', draft.unit);
      data.set('step', draft.step);
      data.set('minOrderQty', draft.minOrderQty);
      data.set('costPrice', draft.costPrice);
      if (draft.maxSellPrice) data.set('maxSellPrice', draft.maxSellPrice);
      data.set('trackStock', String(draft.trackStock));
      if (draft.trackStock) data.set('stockQty', draft.stockQty);
      data.set('isAvailable', String(draft.isAvailable));
      if (draft.source) data.set('source', draft.source);
      if (files) Array.from(files).forEach((file) => data.append('images', file));

      return product
        ? api.upload(`/owner/products/${product.id}`, data, 'PATCH')
        : api.upload('/owner/products', data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'products'] });
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={product ? product.name : t('nav.products')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field label={t('nav.products')} htmlFor="name" error={errors.name} required>
        <Input id="name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </Field>

      <Field label={t('app.notes')} htmlFor="description">
        <Textarea
          id="description"
          rows={2}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('catalog.unit')} htmlFor="unit" error={errors.unit}>
          <Select id="unit" value={draft.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="ধাপ"
          htmlFor="step"
          hint="যত পরিমাণের গুণিতকে অর্ডার নেওয়া হবে"
          error={errors.step}
        >
          <Input
            id="step"
            type="number"
            step="0.25"
            min="0"
            className="tabular"
            value={draft.step}
            onChange={(e) => set('step', e.target.value)}
          />
        </Field>

        <Field label={t('catalog.minOrderQty')} htmlFor="minOrderQty" error={errors.minOrderQty}>
          <Input
            id="minOrderQty"
            type="number"
            step="0.25"
            min="0"
            className="tabular"
            value={draft.minOrderQty}
            onChange={(e) => set('minOrderQty', e.target.value)}
          />
        </Field>

        <Field label={t('catalog.costPrice')} htmlFor="costPrice" error={errors.costPrice} required>
          <MoneyInput
            id="costPrice"
            value={draft.costPrice}
            onChange={(e) => set('costPrice', e.target.value)}
          />
        </Field>

        <Field
          label={t('catalog.maxSellPrice')}
          htmlFor="maxSellPrice"
          hint={t('app.optional')}
          error={errors.maxSellPrice}
        >
          <MoneyInput
            id="maxSellPrice"
            value={draft.maxSellPrice}
            onChange={(e) => set('maxSellPrice', e.target.value)}
          />
        </Field>

        <Field label={t('nav.sources')} htmlFor="source">
          <Select id="source" value={draft.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">—</option>
            {sources.data?.sources.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={draft.trackStock}
          onChange={(e) => set('trackStock', e.target.checked)}
        />
        <span>
          {t('catalog.trackStock')}
          <span className="block text-xs text-muted-foreground">
            বন্ধ রাখলে স্টক সীমাহীন ধরা হবে
          </span>
        </span>
      </label>

      {draft.trackStock && (
        <Field label={t('catalog.stockQty')} htmlFor="stockQty" error={errors.stockQty}>
          <Input
            id="stockQty"
            type="number"
            min="0"
            step="0.25"
            className="tabular"
            value={draft.stockQty}
            onChange={(e) => set('stockQty', e.target.value)}
          />
        </Field>
      )}

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={draft.isAvailable}
          onChange={(e) => set('isAvailable', e.target.checked)}
        />
        <span>{t('catalog.inStock')}</span>
      </label>

      <Field label="ছবি" htmlFor="images" hint={t('app.optional')}>
        <input
          id="images"
          type="file"
          accept="image/*"
          multiple
          className="w-full text-sm"
          onChange={(e) => setFiles(e.target.files)}
        />
      </Field>
    </Modal>
  );
}
