'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import type { OwnerProduct } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  ColumnToggle,
  EmptyState,
  ErrorState,
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
import { rangeOf } from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { SearchInput, SortSelect, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { ImagesField } from '@/components/ui/images-field';
import { ProductThumb } from '@/components/ui/product-image';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';

const UNITS = ['kg', 'gram', 'litre', 'pcs', 'dozen', 'box'] as const;

/**
 * One box being edited. Every number is a string because it is an input's value;
 * they are parsed once, on save. `id` is present for a box that already exists,
 * and carrying it is what keeps the orders and reseller prices pointing at it.
 * See docs/adr/0021.
 */
type BoxDraft = {
  id?: string;
  label: string;
  content: string;
  costPrice: string;
  maxSellPrice: string;
  stockQty: string;
  isAvailable: boolean;
};

type Draft = {
  name: string;
  description: string;
  unit: string;
  boxes: BoxDraft[];
  trackStock: boolean;
  isAvailable: boolean;
};

const blankBox = (): BoxDraft => ({
  label: '',
  content: '',
  costPrice: '',
  maxSellPrice: '',
  stockQty: '0',
  isAvailable: true,
});

const blank: Draft = {
  name: '',
  description: '',
  unit: 'kg',
  // The two sizes a mango actually leaves in, so a new product is one field of
  // typing rather than two rows of setup.
  boxes: [
    { ...blankBox(), content: '6' },
    { ...blankBox(), content: '11' },
  ],
  trackStock: false,
  isAvailable: true,
};

/** The cheapest box, which is the one figure a product-level column can carry. */
const fromPrice = (product: OwnerProduct) =>
  product.variants.length === 0 ? 0 : Math.min(...product.variants.map((v) => v.costPrice));

/** Every box's stock added up, as a count of boxes. */
const totalBoxes = (product: OwnerProduct) =>
  product.variants.reduce((sum, v) => sum + (v.stockQty ?? 0), 0);

type SortKey = 'name' | 'boxes' | 'cost' | 'stock' | 'status';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'name', label: t('nav.products'), locked: true },
  { key: 'boxes', label: t('catalog.boxes') },
  { key: 'cost', label: t('catalog.costPrice') },
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
    boxes: (product) => product.variants.length,
    // The cheapest box: there is no product-wide price any more. docs/adr/0021.
    cost: (product) => fromPrice(product),
    stock: (product) => (product.trackStock ? totalBoxes(product) : null),
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
          <div className="flex flex-wrap items-center gap-2">
            {/* Stock against what has been leaving it, over the last thirty days. */}
            <DownloadMenu range={rangeOf('last30')} only={['products', 'pick-list', 'sales']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('nav.products')}
            </Button>
          </div>
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

      {products.isError && (
        <ErrorState
          onRetry={() => products.refetch()}
          isRetrying={products.isFetching}
          error={products.error}
        />
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
              {columns.isVisible('boxes') && (
                <SortTh column="boxes" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('catalog.boxes')}
                </SortTh>
              )}
              {columns.isVisible('cost') && (
                <SortTh column="cost" sort={sorting.sort} onSort={sorting.toggle} align="right">
                  {t('catalog.costPrice')}
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
                    {/*
                     * The owner's own catalog was the one screen listing mangoes
                     * with no picture of them, which made the photographs feel
                     * like something you upload and never see again.
                     */}
                    <div className="flex items-center gap-3">
                      <ProductThumb images={product.images} alt={product.name} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{product.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {product.variants.map((v) => v.label).join(' · ')}
                        </div>
                      </div>
                    </div>
                  </Td>
                )}

                {columns.isVisible('boxes') && (
                  <Td className="text-right">
                    <span className="tabular">{formatNumber(product.variants.length)}</span>
                  </Td>
                )}

                {/*
                 * A price belongs to a box, so the one number a product row can
                 * honestly show is where its prices start. docs/adr/0021.
                 */}
                {columns.isVisible('cost') && (
                  <Td className="tabular text-right font-semibold">
                    {t('catalog.fromPrice').replace('{amount}', formatMoney(fromPrice(product)))}
                  </Td>
                )}

                {columns.isVisible('stock') && (
                  <Td className="tabular text-right">
                    {product.trackStock
                      ? t('catalog.boxCount').replace('{n}', formatNumber(totalBoxes(product)))
                      : '∞'}
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

  // Handles of stored images the owner has dropped, applied on save rather than
  // immediately, so closing the sheet without saving changes nothing.
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  const [draft, setDraft] = useState<Draft>(() =>
    product
      ? {
          name: product.name,
          description: product.description ?? '',
          unit: product.unit,
          boxes: product.variants.map((variant) => ({
            id: variant.id,
            label: variant.label,
            content: String(variant.content),
            // Latin digits: these values are parsed back on save.
            costPrice: formatMoneyPlain(variant.costPrice),
            maxSellPrice:
              variant.maxSellPrice == null ? '' : formatMoneyPlain(variant.maxSellPrice),
            stockQty: String(variant.stockQty ?? 0),
            isAvailable: variant.isAvailable,
          })),
          trackStock: product.trackStock,
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
      /*
       * The boxes as one JSON field. A multipart body repeats field names and
       * so cannot carry a list of objects: it would collapse every box's cost
       * price into a list of numbers with nothing saying which box each belongs
       * to. The whole list goes every time, so a removed box is simply a
       * shorter list. See docs/adr/0021.
       */
      data.set(
        'variants',
        JSON.stringify(
          draft.boxes.map((box, index) => ({
            ...(box.id ? { id: box.id } : {}),
            ...(box.label.trim() ? { label: box.label.trim() } : {}),
            content: Number(box.content),
            costPrice: Number(box.costPrice),
            maxSellPrice: box.maxSellPrice.trim() === '' ? null : Number(box.maxSellPrice),
            stockQty: draft.trackStock ? Number(box.stockQty) : 0,
            isAvailable: box.isAvailable,
            sortOrder: index,
          }))
        )
      );
      data.set('trackStock', String(draft.trackStock));
      data.set('isAvailable', String(draft.isAvailable));
      files.forEach((file) => data.append('images', file));
      removedIds.forEach((id) => data.append('removeImages', id));

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

  // Every box needs a size and a price; a ceiling is optional but must parse.
  const boxValid = (box: BoxDraft) =>
    Number(box.content) > 0 &&
    checkMoney(box.costPrice, { allowZero: true }).ok &&
    (box.maxSellPrice.trim() === '' || checkMoney(box.maxSellPrice).ok);
  const pricesValid = draft.boxes.length > 0 && draft.boxes.every(boxValid);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const setBox = (index: number, patch: Partial<BoxDraft>) =>
    setDraft((prev) => ({
      ...prev,
      boxes: prev.boxes.map((box, i) => (i === index ? { ...box, ...patch } : box)),
    }));

  const addBox = () => setDraft((prev) => ({ ...prev, boxes: [...prev.boxes, blankBox()] }));

  /*
   * A box is removed from the list, not deleted outright: the API keeps one that
   * has ever been ordered and switches it off instead, so the pick list and the
   * order history stay resolvable. docs/adr/0021.
   */
  const removeBox = (index: number) =>
    setDraft((prev) => ({ ...prev, boxes: prev.boxes.filter((_, i) => i !== index) }));

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
          <Button loading={save.isPending} disabled={!pricesValid} onClick={() => save.mutate()}>
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

      <Field label={t('catalog.unit')} htmlFor="unit" hint={t('catalog.unitHint')} error={errors.unit}>
        <Select id="unit" value={draft.unit} onChange={(e) => set('unit', e.target.value)}>
          {/* The value is the domain unit the server validates; only the
            * label a person reads is Bengali. */}
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {tUnit(u)}
            </option>
          ))}
        </Select>
      </Field>

      {/*
       * Switches, not sixteen pixel checkboxes. Both of these decide what a
       * customer sees, and a native checkbox on a phone is both hard to hit and
       * hard to read the state of at a glance.
       */}
      <div className="mb-4 divide-y divide-border">
        <Switch
          checked={draft.trackStock}
          onChange={(checked) => set('trackStock', checked)}
          label={t('catalog.trackStock')}
          hint={t('catalog.trackStockHint')}
        />
      </div>

      {/*
       * The boxes this product is sold in, which is where its price and its
       * stock live. A mango leaves in a six-kilo box or an eleven-kilo box, and
       * those are two things with two prices rather than one thing with a
       * minimum and a step. See docs/adr/0021.
       */}
      <section className="mb-4 border-t border-border pt-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{t('catalog.boxes')}</h3>
          <Button size="sm" variant="outline" onClick={addBox} disabled={draft.boxes.length >= 8}>
            <Plus className="h-4 w-4" />
            {t('catalog.addBox')}
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t('catalog.boxesHint')}</p>

        {typeof errors.variants === 'string' && (
          <Alert tone="danger">{errors.variants}</Alert>
        )}

        <ul className="space-y-3">
          {draft.boxes.map((box, index) => (
            <li key={box.id ?? `new-${index}`} className="rounded-xl border-2 border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {box.label.trim() ||
                    (box.content
                      ? `${formatNumber(Number(box.content))} ${tUnit(draft.unit)}`
                      : t('catalog.newBox'))}
                </span>
                {draft.boxes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBox(index)}
                    className="text-xs font-semibold text-danger"
                  >
                    {t('app.remove')}
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t('catalog.boxContent')}
                  htmlFor={`content-${index}`}
                  hint={tUnit(draft.unit)}
                  error={errors[`variants.${index}.content`]}
                  required
                >
                  <Input
                    id={`content-${index}`}
                    type="number"
                    min="0"
                    step="0.25"
                    inputMode="decimal"
                    className="tabular"
                    value={box.content}
                    onChange={(e) => setBox(index, { content: e.target.value })}
                  />
                </Field>

                <Field
                  label={t('catalog.costPrice')}
                  htmlFor={`cost-${index}`}
                  hint={t('catalog.perBox')}
                  error={
                    errors[`variants.${index}.costPrice`] ??
                    moneyError(box.costPrice, { allowZero: true })
                  }
                  required
                >
                  <MoneyInput
                    id={`cost-${index}`}
                    value={box.costPrice}
                    onChange={(e) => setBox(index, { costPrice: e.target.value })}
                  />
                </Field>

                <Field
                  label={t('catalog.maxSellPrice')}
                  htmlFor={`max-${index}`}
                  hint={t('app.optional')}
                  error={errors[`variants.${index}.maxSellPrice`] ?? moneyError(box.maxSellPrice)}
                >
                  <MoneyInput
                    id={`max-${index}`}
                    value={box.maxSellPrice}
                    onChange={(e) => setBox(index, { maxSellPrice: e.target.value })}
                  />
                </Field>

                {draft.trackStock && (
                  <Field
                    label={t('catalog.stockQty')}
                    htmlFor={`stock-${index}`}
                    hint={t('catalog.stockHint')}
                    error={errors[`variants.${index}.stockQty`]}
                  >
                    <Input
                      id={`stock-${index}`}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      className="tabular"
                      value={box.stockQty}
                      onChange={(e) => setBox(index, { stockQty: e.target.value })}
                    />
                  </Field>
                )}

                <Field label={t('catalog.boxLabel')} htmlFor={`label-${index}`} hint={t('app.optional')}>
                  <Input
                    id={`label-${index}`}
                    value={box.label}
                    onChange={(e) => setBox(index, { label: e.target.value })}
                  />
                </Field>
              </div>

              <div className="divide-y divide-border">
                <Switch
                  checked={box.isAvailable}
                  onChange={(checked) => setBox(index, { isAvailable: checked })}
                  label={t('catalog.available')}
                  hint={t('catalog.boxAvailableHint')}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

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
        existing={(product?.images ?? []).filter((image) => !removedIds.includes(image.id))}
        onRemoveExisting={(id) => setRemovedIds((prev) => [...prev, id])}
      />

      {save.error && errors.images && (
        <p className="mt-1 text-xs font-semibold text-danger">{errors.images}</p>
      )}
    </Modal>
  );
}
