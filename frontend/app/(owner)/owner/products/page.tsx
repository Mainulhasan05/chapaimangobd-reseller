'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import type { OwnerProduct } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  ColumnToggle,
  EmptyState,
  PageHeader,
  SortTh,
  TableWrap,
  Td,
  Th,
  Tr,
  useColumns,
  useSort,
  type ColumnDef,
} from '@/components/ui/layout';
import { SearchInput, SortSelect, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { ImagesField } from '@/components/ui/images-field';
import { Switch } from '@/components/ui/switch';
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
};

type SortKey = 'name' | 'cost' | 'maxSell' | 'minQty' | 'stock' | 'status';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'name', label: t('nav.products'), locked: true },
  { key: 'cost', label: t('catalog.costPrice') },
  { key: 'maxSell', label: t('catalog.maxSellPrice') },
  { key: 'minQty', label: t('catalog.minOrderQty') },
  { key: 'stock', label: t('catalog.stockQty') },
  { key: 'status', label: t('app.status') },
];

export default function OwnerProductsPage() {
  const [editing, setEditing] = useState<OwnerProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [term, setTerm] = useState('');
  const search = useDebounced(term);

  const products = useQuery({
    queryKey: ['owner', 'products'],
    queryFn: () => api.get<{ products: OwnerProduct[] }>('/owner/products'),
  });

  const all = products.data?.products ?? [];

  // The whole catalog arrives in one response, so the filter is a local scan.
  const needle = search.trim().toLowerCase();
  const matched = needle
    ? all.filter((product) =>
        [product.name].some((field) => field.toLowerCase().includes(needle))
      )
    : all;

  const sorting = useSort<OwnerProduct, SortKey>(matched, {
    name: (product) => product.name,
    cost: (product) => product.costPrice,
    maxSell: (product) => product.maxSellPrice ?? null,
    minQty: (product) => product.minOrderQty,
    stock: (product) => (product.trackStock ? (product.stockQty ?? 0) : null),
    status: (product) => (product.isAvailable ? 1 : 0),
  });

  const rows = sorting.rows;
  const columns = useColumns(COLUMNS, 'owner-products');

  return (
    <>
      <PageHeader
        title={t('nav.products')}
        subtitle={`${all.length} ${t('nav.products')}`}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('nav.products')}
          </Button>
        }
      />

      <Toolbar>
        <ToolbarSpacer />
        <SearchInput value={term} onChange={setTerm} placeholder={t('nav.products')} />
        <SortSelect
          value={sorting.sort?.key ?? ''}
          onChange={(key) => sorting.setSort(key ? { key, direction: 'asc' } : null)}
          options={COLUMNS.map((column) => ({ value: column.key, label: column.label }))}
        />
        <div className="hidden sm:block">
          <ColumnToggle columns={COLUMNS} isVisible={columns.isVisible} onToggle={columns.toggle} />
        </div>
      </Toolbar>

      {products.isLoading && (
        <Card className="flex justify-center py-10">
          <Spinner />
        </Card>
      )}

      {products.isSuccess && rows.length === 0 && (
        <EmptyState icon={Package} title={search ? t('app.noResults') : t('app.none')} />
      )}

      {rows.length > 0 && (
        <TableWrap alwaysVisible>
          <thead>
            <tr>
              {columns.isVisible('name') && (
                <SortTh column="name" sort={sorting.sort} onSort={sorting.toggle}>
                  {t('nav.products')}
                </SortTh>
              )}
              {columns.isVisible('cost') && (
                <SortTh column="cost" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('catalog.costPrice')}
                </SortTh>
              )}
              {columns.isVisible('maxSell') && (
                <SortTh column="maxSell" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('catalog.maxSellPrice')}
                </SortTh>
              )}
              {columns.isVisible('minQty') && (
                <SortTh column="minQty" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('catalog.minOrderQty')}
                </SortTh>
              )}
              {columns.isVisible('stock') && (
                <SortTh column="stock" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('catalog.stockQty')}
                </SortTh>
              )}
              {columns.isVisible('status') && (
                <SortTh column="status" sort={sorting.sort} onSort={sorting.toggle}>
                  {t('app.status')}
                </SortTh>
              )}
              <Th className="w-24 text-right">{t('app.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <Tr key={product.id}>
                {columns.isVisible('name') && (
                  <Td>
                    <div className="font-semibold">{product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatNumber(product.minOrderQty)} {product.unit} {t('catalog.minOrderQty')}
                    </div>
                  </Td>
                )}

                {columns.isVisible('cost') && (
                  <Td className="tabular text-right font-semibold">
                    {formatMoney(product.costPrice)}
                    <span className="font-normal text-muted-foreground"> / {product.unit}</span>
                  </Td>
                )}

                {columns.isVisible('maxSell') && (
                  <Td className="tabular text-right">
                    {product.maxSellPrice == null ? '—' : formatMoney(product.maxSellPrice)}
                  </Td>
                )}

                {columns.isVisible('minQty') && (
                  <Td className="tabular text-right">
                    {formatNumber(product.minOrderQty)} {product.unit}
                  </Td>
                )}

                {columns.isVisible('stock') && (
                  <Td className="tabular text-right">
                    {product.trackStock ? formatNumber(product.stockQty ?? 0) : '∞'}
                  </Td>
                )}

                {columns.isVisible('status') && (
                  <Td>
                    <Badge tone={product.isAvailable ? 'success' : 'neutral'} dot>
                      {product.isAvailable ? t('catalog.inStock') : t('catalog.outOfStock')}
                    </Badge>
                  </Td>
                )}

                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditing(product)}>
                    {t('app.edit')}
                  </Button>
                </Td>
              </Tr>
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

  // Held as an array rather than the input's own FileList, because a FileList is
  // read-only: dropping one photo out of a chosen five means rebuilding the set.
  const [files, setFiles] = useState<File[]>([]);

  // Keys of stored images the owner has removed, applied on save rather than
  // immediately, so closing the sheet without saving changes nothing.
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);

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
      files.forEach((file) => data.append('images', file));
      removedKeys.forEach((key) => data.append('removeImages', key));

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

      </div>

      {/*
       * Switches, not sixteen pixel checkboxes. Both of these decide what a
       * customer sees, and a native checkbox on a phone is both hard to hit and
       * hard to read the state of at a glance.
       */}
      <div className="mb-3 divide-y divide-border">
        <Switch
          checked={draft.trackStock}
          onChange={(checked) => set('trackStock', checked)}
          label={t('catalog.trackStock')}
          hint={t('catalog.trackStockHint')}
        />
      </div>

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

      <div className="mb-4 divide-y divide-border">
        <Switch
          checked={draft.isAvailable}
          onChange={(checked) => set('isAvailable', checked)}
          label={t('catalog.available')}
          hint={t('catalog.availableHint')}
        />
      </div>

      <ImagesField
        id="images"
        label={t('catalog.images')}
        hint={t('catalog.imagesHint')}
        value={files}
        onChange={setFiles}
        existing={(product?.images ?? []).filter((image) => !removedKeys.includes(image.key))}
        onRemoveExisting={(key) => setRemovedKeys((prev) => [...prev, key])}
      />

      {save.error && errors.images && (
        <p className="mt-1 text-xs font-semibold text-danger">{errors.images}</p>
      )}
    </Modal>
  );
}
