'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Boxes, Package, PackageOpen, Pencil, Plus } from 'lucide-react';
import { errorMessage, fieldErrors, ApiError } from '@/lib/api';
import { t, tf, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatMoneyPlain, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useUrlSearch, useUrlState } from '@/lib/use-url-state';
import type { OwnerProduct, ProductVariant } from '@/lib/types';
import {
  useArchiveProductMutation,
  useCreateProductMutation,
  useGetProductsQuery,
  useRestoreProductMutation,
  useSetVariantStockMutation,
  useUpdateProductMutation,
  useSetProductCoverMutation,
} from '@/lib/store/endpoints/catalog';
import {
  Alert,
  Badge,
  ColumnToggle,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  RowMenu,
  SortTh,
  TableWrap,
  Td,
  Th,
  Tr,
  useColumns,
  useSort,
  type ColumnDef,
  type SortState,
  type Tone,
} from '@/components/ui/layout';
import { rangeOf } from '@/components/ui/date-range';
import { PackagingRecipeModal } from '@/components/packaging-recipe-modal';
import { DownloadMenu } from '@/components/report/download-menu';
import { SearchInput, Segmented, SortSelect, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button } from '@/components/ui/button';
import {
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
  focusFirstInvalid,
} from '@/components/ui/form';
import { ImagesField } from '@/components/ui/images-field';
import { ProductThumb } from '@/components/ui/product-image';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { useToast } from '@/components/ui/toast';

const UNITS = ['kg', 'gram', 'litre', 'pcs', 'dozen', 'box'] as const;

/** At or below this many boxes a box reads "কম": two or three orders from empty. */
const LOW_STOCK = 3;

/* ------------------------------------------------------------ state words -- */

/**
 * What a product or a box is doing, as one word rather than one colour.
 *
 * The status column used to say "স্টকে আছে" for every product that was switched
 * on, including one whose every box had run out, and "স্টক শেষ" for one that
 * was merely switched off. These are four different situations with four
 * different fixes, so they get four words.
 */
type StockState = 'off' | 'out' | 'low' | 'ok';

const STATE_TONE: Record<StockState, Tone> = {
  off: 'neutral',
  out: 'danger',
  low: 'warning',
  ok: 'success',
};

function boxState(product: OwnerProduct, box: ProductVariant): StockState {
  if (!product.isAvailable || !box.isAvailable) return 'off';
  if (!product.trackStock || box.stockQty == null) return 'ok';
  if (box.stockQty <= 0) return 'out';
  if (box.stockQty <= LOW_STOCK) return 'low';
  return 'ok';
}

function productState(product: OwnerProduct): StockState {
  if (!product.isAvailable) return 'off';
  const live = product.variants.filter((box) => box.isAvailable);
  if (live.length === 0) return 'off';
  const states = live.map((box) => boxState(product, box));
  if (states.every((state) => state === 'out')) return 'out';
  if (states.some((state) => state === 'out' || state === 'low')) return 'low';
  return 'ok';
}

/** The cheapest box, which is the one figure a product-level column can carry. */
const fromPrice = (product: OwnerProduct) =>
  product.variants.length === 0 ? 0 : Math.min(...product.variants.map((v) => v.costPrice));

/** Every box's stock added up, as a count of boxes. */
const totalBoxes = (product: OwnerProduct) =>
  product.variants.reduce((sum, v) => sum + (v.stockQty ?? 0), 0);

/** A server refusal in words this screen owns, for the codes the shared table lacks. */
function catalogError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'STOCK_BELOW_ZERO') return t('products.stockBelowZero');
    if (error.code === 'STOCK_NOT_TRACKED') return t('products.stockNotTracked');
  }
  return errorMessage(error);
}

/* ------------------------------------------------------------------- page -- */

type SortKey = 'name' | 'boxes' | 'cost' | 'stock' | 'status';

const COLUMNS: ColumnDef<SortKey>[] = [
  { key: 'name', label: t('nav.products'), locked: true },
  { key: 'boxes', label: t('catalog.boxes') },
  { key: 'cost', label: t('catalog.costPrice') },
  { key: 'stock', label: t('catalog.stockQty') },
  { key: 'status', label: t('app.status') },
];

const SORT_KEYS = COLUMNS.map((column) => column.key);

/** `name:desc` in the URL, so Back returns the list in the order it was left. */
function parseSort(raw: string): SortState<SortKey> {
  const [key, direction] = raw.split(':');
  if (!SORT_KEYS.includes(key as SortKey)) return null;
  return { key: key as SortKey, direction: direction === 'desc' ? 'desc' : 'asc' };
}

type StockTarget = { product: OwnerProduct; variantId: string };

export default function OwnerProductsPage() {
  const toast = useToast();
  // `recipe` is in the URL so the supply page can link straight to a product's recipe.
  const [filters, setFilters] = useUrlState({ view: 'live', sort: '', recipe: '' });
  const search = useUrlSearch();
  const archivedView = filters.view === 'archived';

  const products = useGetProductsQuery(archivedView ? { archived: 'only' } : undefined);
  const [restoreProduct, restoring] = useRestoreProductMutation();
  const [archiveProduct] = useArchiveProductMutation();

  const [editing, setEditing] = useState<OwnerProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [stockFor, setStockFor] = useState<StockTarget | null>(null);
  const [archiving, setArchiving] = useState<OwnerProduct | null>(null);

  /*
   * `currentData`, not `data`: switching between the live and archived lists
   * must not show the previous list's rows under the new list's buttons (a live
   * product offering "আবার চালু করুন"). A refetch of the same list keeps its rows.
   */
  const view = products.currentData;
  const all = useMemo(() => view?.products ?? [], [view]);

  // The whole catalog arrives in one response, so the search is a local scan
  // over the product's name and its boxes' names.
  const needle = search.term.trim().toLowerCase();
  const matched = useMemo(
    () =>
      needle
        ? all.filter((product) =>
            [product.name, ...product.variants.map((v) => v.label)].some((field) =>
              field.toLowerCase().includes(needle)
            )
          )
        : all,
    [all, needle]
  );

  const sorting = useSort<OwnerProduct, SortKey>(
    matched,
    {
      name: (product) => product.name,
      boxes: (product) => product.variants.length,
      // The cheapest box: there is no product-wide price any more. docs/adr/0021.
      cost: (product) => fromPrice(product),
      stock: (product) => (product.trackStock ? totalBoxes(product) : null),
      // Off, out, low, fine: the order of what needs attention.
      status: (product) => ['off', 'out', 'low', 'ok'].indexOf(productState(product)),
    },
    parseSort(filters.sort)
  );

  const applySort = (next: SortState<SortKey>) => {
    sorting.setSort(next);
    setFilters({ sort: next ? `${next.key}:${next.direction}` : '' });
  };

  const toggleSort = (key: SortKey) => {
    const current = sorting.sort;
    applySort(
      !current || current.key !== key
        ? { key, direction: 'asc' }
        : current.direction === 'asc'
          ? { key, direction: 'desc' }
          : null
    );
  };

  const rows = sorting.rows;
  const columns = useColumns(COLUMNS, 'owner-products');
  const recipeProduct = filters.recipe ? all.find((p) => p.id === filters.recipe) : undefined;

  // A link to the recipe of a product that is archived or gone used to do
  // nothing at all and leave the parameter behind: say so, and drop it.
  useEffect(() => {
    if (!filters.recipe || !view || recipeProduct) return;
    toast(t('products.recipeMissing'), 'danger');
    setFilters({ recipe: '' });
  }, [filters.recipe, view, recipeProduct, toast, setFilters]);

  const restore = async (product: OwnerProduct) => {
    try {
      await restoreProduct({ id: product.id }).unwrap();
      toast(tf('products.restored', { name: product.name }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  const actions = {
    onEdit: setEditing,
    onRecipe: (product: OwnerProduct) => setFilters({ recipe: product.id }),
    onStock: (product: OwnerProduct, variantId?: string) =>
      setStockFor({ product, variantId: variantId ?? product.variants[0]?.id ?? '' }),
    onArchive: setArchiving,
    onRestore: restore,
    restoringId: restoring.isLoading ? restoring.originalArgs?.id : undefined,
  };

  return (
    <>
      <PageHeader
        title={t('nav.products')}
        subtitle={view ? tf('products.count', { count: formatNumber(all.length) }) : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Stock against what has been leaving it, over the last thirty days. */}
            <DownloadMenu range={rangeOf('last30')} only={['products', 'pick-list', 'sales']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('products.new')}
            </Button>
          </div>
        }
      />

      <Toolbar>
        <Segmented
          label={t('products.filterLabel')}
          value={archivedView ? 'archived' : 'live'}
          onChange={(next) => setFilters({ view: next })}
          options={[
            { value: 'live', label: t('products.viewLive') },
            { value: 'archived', label: t('products.viewArchived') },
          ]}
        />
        <ToolbarSpacer />
        <SearchInput
          value={search.input}
          onChange={search.setInput}
          placeholder={t('products.searchPlaceholder')}
          className="basis-full sm:basis-auto"
        />
        <SortSelect
          className="flex-1"
          value={sorting.sort ? `${sorting.sort.key}:${sorting.sort.direction}` : ''}
          onChange={(value) => applySort(value ? parseSort(value) : null)}
          options={COLUMNS.flatMap((column) => [
            { value: `${column.key}:asc`, label: column.label },
            { value: `${column.key}:desc`, label: tf('products.sortReverse', { label: column.label }) },
          ])}
        />
        <div className="hidden sm:block">
          <ColumnToggle columns={COLUMNS} isVisible={columns.isVisible} onToggle={columns.toggle} />
        </div>
      </Toolbar>

      {!view && !products.isError && <ListSkeleton rows={4} />}

      {products.isError && !view && (
        <ErrorState
          onRetry={() => products.refetch()}
          isRetrying={products.isFetching}
          error={products.error}
        />
      )}

      {/* An empty catalog teaches; an empty search says the search is why. */}
      {view && all.length === 0 && !archivedView && (
        <EmptyState
          icon={Package}
          title={t('products.emptyTitle')}
          description={t('products.emptyHelp')}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('products.new')}
            </Button>
          }
        />
      )}

      {view && all.length === 0 && archivedView && (
        <EmptyState
          icon={Archive}
          title={t('products.archivedEmpty')}
          description={t('products.archivedEmptyHelp')}
        />
      )}

      {all.length > 0 && rows.length === 0 && (
        <FilteredEmpty onClear={() => search.setInput('')} />
      )}

      {rows.length > 0 && (
        // Kept on screen and dimmed while it refreshes, and not tappable then,
        // so a tap cannot land on a row the answer is about to move or remove.
        <div
          aria-busy={products.isFetching}
          className={cn('transition-opacity', products.isFetching && 'pointer-events-none opacity-60')}
        >
          <ul className="space-y-3 sm:hidden">
            {rows.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} archived={archivedView} {...actions} />
              </li>
            ))}
          </ul>

          <TableWrap>
            <thead>
              <tr>
                {columns.isVisible('name') && (
                  <SortTh column="name" sort={sorting.sort} onSort={toggleSort}>
                    {t('nav.products')}
                  </SortTh>
                )}
                {columns.isVisible('boxes') && (
                  <SortTh column="boxes" sort={sorting.sort} onSort={toggleSort}>
                    {t('catalog.boxes')}
                  </SortTh>
                )}
                {columns.isVisible('cost') && (
                  <SortTh column="cost" sort={sorting.sort} onSort={toggleSort} align="right">
                    {t('catalog.costPrice')}
                  </SortTh>
                )}
                {columns.isVisible('stock') && (
                  <SortTh column="stock" sort={sorting.sort} onSort={toggleSort} align="right">
                    {t('catalog.stockQty')}
                  </SortTh>
                )}
                {columns.isVisible('status') && (
                  <SortTh column="status" sort={sorting.sort} onSort={toggleSort}>
                    {t('app.status')}
                  </SortTh>
                )}
                <Th className="text-right">{t('app.actions')}</Th>
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
                        <div className="min-w-0 truncate font-semibold">{product.name}</div>
                      </div>
                    </Td>
                  )}

                  {columns.isVisible('boxes') && (
                    <Td>
                      <BoxChips
                        product={product}
                        onStock={archivedView ? undefined : actions.onStock}
                      />
                    </Td>
                  )}

                  {/*
                   * A price belongs to a box, so the one number a product row can
                   * honestly show is where its prices start. docs/adr/0021.
                   */}
                  {columns.isVisible('cost') && (
                    <Td className="tabular text-right font-semibold">
                      {tf('catalog.fromPrice', { amount: formatMoney(fromPrice(product)) })}
                    </Td>
                  )}

                  {columns.isVisible('stock') && (
                    <Td className="tabular text-right">
                      {product.trackStock
                        ? tf('catalog.boxCount', { n: formatNumber(totalBoxes(product)) })
                        : '∞'}
                    </Td>
                  )}

                  {columns.isVisible('status') && (
                    <Td>
                      <StateBadge state={productState(product)} />
                    </Td>
                  )}

                  <Td className="text-right">
                    {archivedView ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={actions.restoringId === product.id}
                        onClick={() => void restore(product)}
                      >
                        <ArchiveRestore className="h-4 w-4" />
                        {t('app.restore')}
                      </Button>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        {/*
                         * The packaging recipe is its own button and its own
                         * endpoint, not part of the product form: that form is
                         * multipart because it carries photographs, and multipart
                         * cannot honestly encode a nested array. docs/adr/0026.
                         */}
                        {product.trackStock && (
                          <Button size="sm" variant="outline" onClick={() => actions.onStock(product)}>
                            {t('products.stock')}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEditing(product)}>
                          {t('app.edit')}
                        </Button>
                        <RowMenu
                          label={product.name}
                          items={[
                            {
                              label: t('products.recipe'),
                              icon: PackageOpen,
                              onSelect: () => actions.onRecipe(product),
                            },
                            {
                              label: t('app.archive'),
                              icon: Archive,
                              tone: 'danger',
                              onSelect: () => setArchiving(product),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      {recipeProduct && (
        <PackagingRecipeModal
          key={recipeProduct.id}
          product={recipeProduct}
          onClose={() => setFilters({ recipe: '' })}
        />
      )}

      {stockFor && (
        <StockSheet
          key={stockFor.product.id}
          product={stockFor.product}
          variantId={stockFor.variantId}
          onClose={() => setStockFor(null)}
        />
      )}

      {(creating || editing) && (
        <ProductSheet
          key={editing?.id ?? 'new'}
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onTrackingStarted={(product) =>
            setStockFor({ product, variantId: product.variants[0]?.id ?? '' })
          }
        />
      )}

      {archiving && (
        <ConfirmSheet
          title={tf('products.archiveTitle', { name: archiving.name })}
          tone="danger"
          confirmLabel={t('app.archive')}
          consequences={[t('products.archiveLine1'), t('products.archiveLine2'), t('products.archiveLine3')]}
          onClose={() => setArchiving(null)}
          onConfirm={async () => {
            const product = archiving;
            await archiveProduct({ id: product.id }).unwrap();
            toast(tf('products.archived', { name: product.name }), 'neutral', {
              action: { label: t('app.undo'), onClick: () => void restore(product) },
            });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ parts -- */

/** A failure pinned above a sheet's buttons, beside the one that caused it. */
function SheetError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
      {message}
    </p>
  );
}

function StateBadge({ state }: { state: StockState }) {
  return (
    <Badge tone={STATE_TONE[state]} dot>
      {t(`products.state.${state}`)}
    </Badge>
  );
}

/**
 * Each box with its price and its count. Where stock is counted, a box is the
 * way into its own stock sheet, because "the eleven-kilo box ran out" is the
 * thought the owner has, not "the product".
 */
function BoxChips({
  product,
  onStock,
}: {
  product: OwnerProduct;
  onStock?: (product: OwnerProduct, variantId: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {product.variants.map((box) => {
        const state = boxState(product, box);
        const tracked = product.trackStock && box.stockQty != null;
        const body = (
          <>
            <span className="block text-sm font-semibold">{box.label}</span>
            <span className="tabular block text-xs text-muted-foreground">
              {formatMoney(box.costPrice)}
              {tracked && ` · ${tf('products.boxStock', { n: formatNumber(box.stockQty ?? 0) })}`}
              {state !== 'ok' && (
                <span
                  className={cn(
                    'font-semibold',
                    state === 'out' && 'text-danger',
                    state === 'low' && 'text-warning-ink'
                  )}
                >
                  {` · ${t(`products.box.${state}`)}`}
                </span>
              )}
            </span>
          </>
        );
        const chip = cn(
          'flex min-h-11 flex-col justify-center rounded-lg border px-3 py-1 text-left sm:min-h-0',
          state === 'out' ? 'border-danger/40' : state === 'low' ? 'border-warning/60' : 'border-border',
          state === 'off' && 'opacity-60'
        );
        return (
          <li key={box.id}>
            {tracked && onStock ? (
              <button
                type="button"
                onClick={() => onStock(product, box.id)}
                aria-label={tf('products.stockOf', { box: box.label })}
                className={cn(chip, 'transition-colors hover:bg-muted')}
              >
                {body}
              </button>
            ) : (
              <span className={chip}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One product on a phone: what it looks like, its boxes, and what to do with it. */
function ProductCard({
  product,
  archived,
  onEdit,
  onRecipe,
  onStock,
  onArchive,
  onRestore,
  restoringId,
}: {
  product: OwnerProduct;
  archived: boolean;
  onEdit: (product: OwnerProduct) => void;
  onRecipe: (product: OwnerProduct) => void;
  onStock: (product: OwnerProduct, variantId?: string) => void;
  onArchive: (product: OwnerProduct) => void;
  onRestore: (product: OwnerProduct) => Promise<void>;
  restoringId?: string;
}) {
  return (
    <article className="card p-4">
      <div className="flex gap-3">
        <ProductThumb images={product.images} alt={product.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 break-words font-semibold">{product.name}</h3>
            <StateBadge state={productState(product)} />
          </div>
          <p className="tabular mt-0.5 text-xs text-muted-foreground">
            {tf('catalog.fromPrice', { amount: formatMoney(fromPrice(product)) })}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <BoxChips product={product} onStock={archived ? undefined : onStock} />
      </div>

      {archived ? (
        <Button
          full
          variant="outline"
          className="mt-3"
          loading={restoringId === product.id}
          onClick={() => void onRestore(product)}
        >
          <ArchiveRestore className="h-4 w-4" />
          {t('app.restore')}
        </Button>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => onEdit(product)}>
            <Pencil className="h-4 w-4" />
            {t('app.edit')}
          </Button>
          {product.trackStock ? (
            <Button variant="outline" onClick={() => onStock(product)}>
              <Boxes className="h-4 w-4" />
              {t('products.stock')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onRecipe(product)}>
              <PackageOpen className="h-4 w-4" />
              {t('products.recipe')}
            </Button>
          )}
          {product.trackStock && (
            <Button variant="quiet" onClick={() => onRecipe(product)}>
              <PackageOpen className="h-4 w-4" />
              {t('products.recipe')}
            </Button>
          )}
          <Button
            variant="quiet"
            className={cn('text-danger', !product.trackStock && 'col-span-2')}
            onClick={() => onArchive(product)}
          >
            <Archive className="h-4 w-4" />
            {t('app.archive')}
          </Button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------ stock sheet -- */

type StockMode = 'in' | 'out' | 'set';

/**
 * One box's count, on its own.
 *
 * Stock used to be a field in the product form, and the form sent whatever it
 * was opened with: a form opened at ten boxes and saved after two orders had
 * been confirmed put the two boxes back on the shelf. The count now moves only
 * here, through its own atomic endpoint, as either a delivery ("২০ বক্স এলো") or
 * a count ("গুনে ৩৮টা পেলাম"), and the sheet shows the number it is about to
 * leave behind before it is saved.
 *
 * Direction is a choice of button, not a minus sign: the numeric keypad on most
 * Android phones has no minus key.
 */
function StockSheet({
  product: opened,
  variantId,
  onClose,
}: {
  product: OwnerProduct;
  variantId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [boxId, setBoxId] = useState(variantId);
  const [mode, setMode] = useState<StockMode>('in');
  const [value, setValue] = useState('');
  const [tried, setTried] = useState(false);
  // One per opening: a retry after a lost answer is applied once, not twice.
  const [nonce] = useState(() => crypto.randomUUID());
  const [setStock, state] = useSetVariantStockMutation();

  /*
   * The product as the catalog has it now, not as it was when the sheet
   * opened: an order can take boxes meanwhile, and the "now" figure, the
   * before → after preview and the toast must all start from the real count.
   */
  const { live, refetch } = useGetProductsQuery(undefined, {
    selectFromResult: ({ data }) => ({ live: data?.products.find((p) => p.id === opened.id) }),
  });
  const product = live ?? opened;

  const box = product.variants.find((v) => v.id === boxId) ?? product.variants[0];
  const current = box?.stockQty ?? 0;

  const amount = value.trim() === '' ? null : Number(value);
  const whole = amount !== null && Number.isInteger(amount) && amount >= 0;
  const after =
    amount === null || !whole
      ? null
      : mode === 'in'
        ? current + amount
        : mode === 'out'
          ? current - amount
          : amount;

  const problem =
    amount === null
      ? t('app.required')
      : !whole
        ? t('products.stockWhole')
        : mode !== 'set' && amount === 0
          ? t('products.stockNotZero')
          : after !== null && after < 0
            ? t('products.stockBelowZero')
            : null;

  if (!box) return null;

  const save = async () => {
    setTried(true);
    if (problem || amount === null) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    try {
      const { product: fresh } = await setStock(
        mode === 'set'
          ? { productId: product.id, variantId: box.id, set: amount, nonce }
          : { productId: product.id, variantId: box.id, add: mode === 'in' ? amount : -amount, nonce }
      ).unwrap();
      const now = fresh.variants.find((v) => v.id === box.id)?.stockQty ?? after ?? 0;
      toast(
        tf('products.stockSaved', {
          box: box.label,
          from: formatNumber(current),
          to: formatNumber(now),
        })
      );
      onClose();
    } catch (error) {
      // Shown in the sheet, beside the button. A refusal over the count means
      // the count moved: fetch the real one so the message and preview use it.
      if (error instanceof ApiError && error.code === 'STOCK_BELOW_ZERO') void refetch();
    }
  };

  const stockError =
    state.error instanceof ApiError && state.error.code === 'STOCK_BELOW_ZERO'
      ? tf('products.stockNowIs', { n: formatNumber(current) })
      : state.isError
        ? catalogError(state.error)
        : null;

  const labels: Record<StockMode, string> = {
    in: t('products.stockInLabel'),
    out: t('products.stockOutLabel'),
    set: t('products.stockSetLabel'),
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={tf('products.stockTitle', { name: product.name })}
      dirty={value.trim() !== ''}
      footerLead={stockError ? <SheetError message={stockError} /> : undefined}
      footer={
        <>
          <ModalCancel />
          <Button loading={state.isLoading} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef}>
        {product.variants.length > 1 && (
          <div className="mb-4">
            <p className="mb-1.5 text-[0.8125rem] font-semibold">{t('products.stockBox')}</p>
            <Segmented
              label={t('products.stockBox')}
              value={box.id}
              onChange={(id) => {
                setBoxId(id);
                setValue('');
                setTried(false);
              }}
              options={product.variants.map((v) => ({ value: v.id, label: v.label }))}
            />
          </div>
        )}

        <div className="mb-4 flex items-baseline justify-between gap-3 rounded-xl bg-muted px-4 py-3">
          <span className="text-sm text-muted-foreground">{t('products.stockNow')}</span>
          <span className="tabular text-lg font-bold">
            {tf('products.boxStock', { n: formatNumber(current) })}
          </span>
        </div>

        <div className="mb-4">
          <p className="mb-1.5 text-[0.8125rem] font-semibold">{t('products.stockMode')}</p>
          <Segmented
            label={t('products.stockMode')}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setTried(false);
            }}
            options={[
              { value: 'in', label: t('products.stockModeIn') },
              { value: 'out', label: t('products.stockModeOut') },
              { value: 'set', label: t('products.stockModeSet') },
            ]}
          />
        </div>

        <Field
          label={labels[mode]}
          htmlFor="stock-amount"
          hint={
            mode === 'out'
              ? t('products.stockOutHint')
              : mode === 'set'
                ? t('products.stockSetHint')
                : undefined
          }
          error={tried && problem ? problem : undefined}
          required
        >
          <Input
            id="stock-amount"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            className="tabular"
            value={value}
            invalid={tried && Boolean(problem)}
            onChange={(e) => setValue(e.target.value)}
            trailing={<span className="text-sm text-muted-foreground">{t('catalog.boxes')}</span>}
          />
        </Field>

        {/* The number about to be left behind, before it is. */}
        {after !== null && after >= 0 && (
          <div className="flex items-baseline justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <span className="text-sm text-muted-foreground">{t('products.stockAfter')}</span>
            <span className="tabular font-semibold">
              {formatNumber(current)} → {tf('products.boxStock', { n: formatNumber(after) })}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- product sheet -- */

/**
 * One box being edited. Every number is a string because it is an input's value;
 * they are parsed once, on save. `id` is present for a box that already exists,
 * and carrying it is what keeps the orders and reseller prices pointing at it.
 * See docs/adr/0021.
 *
 * `label` is only what the owner typed (`customLabel`). The derived name is the
 * placeholder: filling the field with it would save "৬ কেজি" as a custom name
 * that then stops following the content and the unit, which is how boxes ended
 * up frozen with an English "6 kg" on them.
 */
type BoxDraft = {
  key: string;
  id?: string;
  label: string;
  content: string;
  costPrice: string;
  maxSellPrice: string;
  /** Only for a new box. An existing box's count moves through the stock sheet. */
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

let boxSeq = 0;
const nextKey = () => `new-${(boxSeq += 1)}`;

const blankBox = (content = ''): BoxDraft => ({
  key: nextKey(),
  label: '',
  content,
  costPrice: '',
  maxSellPrice: '',
  stockQty: '',
  isAvailable: true,
});

const draftOf = (product: OwnerProduct | null): Draft =>
  product
    ? {
        name: product.name,
        description: product.description ?? '',
        unit: product.unit,
        boxes: product.variants.map((variant) => ({
          key: variant.id,
          id: variant.id,
          label: variant.customLabel ?? '',
          content: String(variant.content),
          // Latin digits: these values are parsed back on save.
          costPrice: formatMoneyPlain(variant.costPrice),
          maxSellPrice: variant.maxSellPrice == null ? '' : formatMoneyPlain(variant.maxSellPrice),
          stockQty: '',
          isAvailable: variant.isAvailable,
        })),
        trackStock: product.trackStock,
        isAvailable: product.isAvailable,
      }
    : {
        name: '',
        description: '',
        unit: 'kg',
        // The two sizes a mango actually leaves in, so a new product is one field of
        // typing rather than two rows of setup.
        boxes: [blankBox('6'), blankBox('11')],
        trackStock: false,
        isAvailable: true,
      };

/** What a box is called when the owner leaves its name empty, as the server derives it. */
const derivedLabel = (box: BoxDraft, unit: string) =>
  Number(box.content) > 0
    ? `${formatNumber(Number(box.content))} ${tUnit(unit)}`
    : t('catalog.newBox');

const boxName = (box: BoxDraft, unit: string) => box.label.trim() || derivedLabel(box, unit);

/** What is missing, keyed by the field it belongs to. Empty means the form can go. */
function problemsOf(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {};
  if (draft.name.trim().length < 2) out.name = t('products.nameRequired');
  draft.boxes.forEach((box, index) => {
    if (!(Number(box.content) > 0)) out[`boxes.${index}.content`] = t('products.contentRequired');
    const cost = checkMoney(box.costPrice, { allowZero: true });
    if (!cost.ok) out[`boxes.${index}.costPrice`] = cost.error;
    if (box.maxSellPrice.trim() !== '') {
      const max = checkMoney(box.maxSellPrice);
      if (!max.ok) out[`boxes.${index}.maxSellPrice`] = max.error;
    }
    if (!box.id && draft.trackStock && box.stockQty.trim() !== '') {
      const stock = Number(box.stockQty);
      if (!Number.isInteger(stock) || stock < 0) out[`boxes.${index}.stockQty`] = t('products.stockWhole');
    }
  });
  return out;
}

/**
 * The changes a reseller will feel, in sentences, for the review step: prices,
 * boxes leaving or switching off, the unit, the whole product switching off,
 * and a box priced at nothing.
 */
function changesOf(product: OwnerProduct | null, draft: Draft) {
  const lines: string[] = [];
  const impacts = new Set<string>();
  const money = (value: string) => formatMoney(Number(value));

  draft.boxes.forEach((box) => {
    const name = boxName(box, draft.unit);
    const before = product?.variants.find((v) => v.id === box.id);
    if (Number(box.costPrice) === 0) {
      lines.push(tf('products.reviewZeroCost', { box: name }));
      impacts.add(t('products.impactZero'));
    }
    if (!before) return;
    if (Number(box.costPrice) !== before.costPrice) {
      lines.push(
        tf('products.reviewCost', { box: name, from: formatMoney(before.costPrice), to: money(box.costPrice) })
      );
      impacts.add(t('products.impactPrice'));
    }
    const nextMax = box.maxSellPrice.trim() === '' ? null : Number(box.maxSellPrice);
    if (nextMax !== before.maxSellPrice) {
      lines.push(
        tf('products.reviewMax', {
          box: name,
          from: before.maxSellPrice == null ? t('products.noLimit') : formatMoney(before.maxSellPrice),
          to: nextMax == null ? t('products.noLimit') : formatMoney(nextMax),
        })
      );
      impacts.add(t('products.impactPrice'));
    }
    if (before.isAvailable && !box.isAvailable) {
      lines.push(tf('products.reviewOff', { box: name }));
      impacts.add(t('products.impactOff'));
    }
  });

  if (product) {
    const kept = new Set(draft.boxes.map((box) => box.id).filter(Boolean));
    product.variants
      .filter((v) => !kept.has(v.id))
      .forEach((v) => {
        lines.push(tf('products.reviewRemoved', { box: v.label }));
        impacts.add(t('products.impactOff'));
      });
    if (product.unit !== draft.unit) {
      lines.push(tf('products.reviewUnit', { from: tUnit(product.unit), to: tUnit(draft.unit) }));
    }
    if (product.isAvailable && !draft.isAvailable) {
      lines.push(t('products.reviewProductOff'));
      impacts.add(t('products.impactOff'));
    }
  }

  return { lines, impacts: [...impacts] };
}

/**
 * Add or change a product and the boxes it is sold in.
 *
 * Save stays enabled; what is missing is marked and focused on submit. A change
 * resellers will feel (a price, a box going away, the unit) goes through a short
 * review step inside the same sheet before it is sent, because the sheet that
 * stacked on top of this one fought it for the Escape key.
 */
function ProductSheet({
  product,
  onClose,
  onTrackingStarted,
}: {
  product: OwnerProduct | null;
  onClose: () => void;
  /** Stock counting was just switched on: the counts need entering next. */
  onTrackingStarted: (product: OwnerProduct) => void;
}) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [initial] = useState(() => draftOf(product));
  const [draft, setDraft] = useState<Draft>(initial);
  // A new product's photographs go up with it; an existing one's go up on pick.
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const [createProduct, creating] = useCreateProductMutation();
  const [updateProduct, updating] = useUpdateProductMutation();
  const saving = creating.isLoading || updating.isLoading;
  const saveError = product ? updating.error : creating.error;
  const serverErrors = fieldErrors(saveError);

  const problems = problemsOf(draft);
  const problemCount = Object.keys(problems).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || files.length > 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const setBox = (index: number, patch: Partial<BoxDraft>) =>
    setDraft((prev) => ({
      ...prev,
      boxes: prev.boxes.map((box, i) => (i === index ? { ...box, ...patch } : box)),
    }));

  const addBox = () => setDraft((prev) => ({ ...prev, boxes: [...prev.boxes, blankBox()] }));

  // Only a box that has never been saved leaves the list; a saved one is
  // switched off instead, because orders may name it. docs/adr/0021.
  const removeBox = (index: number) =>
    setDraft((prev) => ({ ...prev, boxes: prev.boxes.filter((_, i) => i !== index) }));

  /** A field's message: the server's first, then what is missing once Save was tried. */
  const errorFor = (key: string, serverKey: string, live?: string) =>
    serverErrors[serverKey] ?? (tried ? problems[key] : undefined) ?? live;

  const send = async () => {
    // Multipart, because a new product's images upload with the same request.
    const data = new FormData();
    data.set('name', draft.name.trim());
    data.set('description', draft.description);
    data.set('unit', draft.unit);
    /*
     * The boxes as one JSON field. A multipart body repeats field names and so
     * cannot carry a list of objects. The whole list goes every time, so a
     * removed box is simply a shorter list. An existing box never carries a
     * stock count: the server keeps the one it has. See docs/adr/0021.
     */
    data.set(
      'variants',
      JSON.stringify(
        draft.boxes.map((box, index) => ({
          ...(box.id ? { id: box.id } : {}),
          // Empty clears a custom name, so the box goes back to its derived one.
          label: box.label.trim(),
          content: Number(box.content),
          costPrice: Number(box.costPrice),
          maxSellPrice: box.maxSellPrice.trim() === '' ? null : Number(box.maxSellPrice),
          ...(box.id ? {} : { stockQty: draft.trackStock ? Number(box.stockQty) || 0 : 0 }),
          isAvailable: box.isAvailable,
          sortOrder: index,
        }))
      )
    );
    data.set('trackStock', String(draft.trackStock));
    data.set('isAvailable', String(draft.isAvailable));
    files.forEach((file) => data.append('images', file));

    try {
      const result = product
        ? await updateProduct({ id: product.id, formData: data }).unwrap()
        : await createProduct({ formData: data }).unwrap();
      toast(tf(product ? 'products.saved' : 'products.created', { name: result.product.name }));
      onClose();
      // Counting just started on boxes that already exist: their counts are
      // whatever was stored long ago, so the stock sheet opens next.
      if (product && !product.trackStock && draft.trackStock) onTrackingStarted(result.product);
    } catch {
      // Back to the form, where the field errors are.
      setReviewing(false);
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
    }
  };

  const changes = changesOf(product, draft);

  const submit = () => {
    setTried(true);
    if (problemCount > 0) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    if (!reviewing && changes.lines.length > 0) {
      setReviewing(true);
      return;
    }
    void send();
  };

  const generalError =
    saveError && Object.keys(serverErrors).length === 0 ? errorMessage(saveError) : null;
  const summary =
    generalError ??
    (tried && problemCount > 0 && !reviewing
      ? tf('app.fieldsMissing', { count: formatNumber(problemCount) })
      : null);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      dirty={dirty}
      title={product ? product.name : t('products.new')}
      footerLead={summary ? <SheetError message={summary} /> : undefined}
      footer={
        reviewing ? (
          <>
            <Button variant="outline" onClick={() => setReviewing(false)} disabled={saving}>
              {t('app.back')}
            </Button>
            <Button loading={saving} onClick={submit}>
              {t('products.reviewConfirm')}
            </Button>
          </>
        ) : (
          <>
            <ModalCancel disabled={saving} />
            <Button loading={saving} onClick={submit}>
              {t('app.save')}
            </Button>
          </>
        )
      }
    >
      {reviewing ? (
        <div>
          <h3 className="mb-1 font-semibold">{t('products.reviewTitle')}</h3>
          <p className="mb-3 text-sm text-muted-foreground">{t('products.reviewHelp')}</p>
          <ul className="mb-4 divide-y divide-border rounded-xl border border-border">
            {changes.lines.map((line) => (
              <li key={line} className="tabular px-4 py-2.5 text-sm">
                {line}
              </li>
            ))}
          </ul>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {changes.impacts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div ref={bodyRef}>
          {/* The switch customers feel first, where it cannot be missed. */}
          <div className="mb-4 rounded-xl border border-border px-3">
            <Switch
              checked={draft.isAvailable}
              onChange={(checked) => set('isAvailable', checked)}
              label={t('products.sellSwitch')}
              hint={t('products.sellSwitchHint')}
            />
          </div>

          <Field label={t('products.name')} htmlFor="name" error={errorFor('name', 'name')} required>
            <Input
              id="name"
              value={draft.name}
              placeholder={t('products.namePlaceholder')}
              invalid={Boolean(errorFor('name', 'name'))}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field label={t('products.description')} htmlFor="description" error={serverErrors.description}>
            <Textarea
              id="description"
              rows={2}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>

          <Field
            label={t('catalog.unit')}
            htmlFor="unit"
            hint={
              product && draft.unit !== product.unit ? t('products.unitChangeWarn') : t('catalog.unitHint')
            }
            error={serverErrors.unit}
          >
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

          <div className="mb-4 rounded-xl border border-border px-3">
            <Switch
              checked={draft.trackStock}
              onChange={(checked) => set('trackStock', checked)}
              label={t('catalog.trackStock')}
              hint={t('catalog.trackStockHint')}
            />
          </div>
          {product && product.trackStock !== draft.trackStock && (
            <Alert tone="warning" className="-mt-2">
              {draft.trackStock ? t('products.trackOnWarn') : t('products.trackOffWarn')}
            </Alert>
          )}

          {/*
           * The boxes this product is sold in, which is where its price and its
           * stock live. A mango leaves in a six-kilo box or an eleven-kilo box, and
           * those are two things with two prices rather than one thing with a
           * minimum and a step. See docs/adr/0021.
           */}
          <section className="mb-4 border-t border-border pt-4">
            <h3 className="mb-1 text-sm font-bold">{t('catalog.boxes')}</h3>
            <p className="mb-3 text-xs text-muted-foreground">{t('catalog.boxesHint')}</p>

            {typeof serverErrors.variants === 'string' && (
              <Alert tone="danger">{serverErrors.variants}</Alert>
            )}

            <ul className="space-y-3">
              {draft.boxes.map((box, index) => {
                const saved = product?.variants.find((v) => v.id === box.id);
                const contentError = errorFor(`boxes.${index}.content`, `variants.${index}.content`);
                const costError = errorFor(
                  `boxes.${index}.costPrice`,
                  `variants.${index}.costPrice`,
                  moneyError(box.costPrice, { allowZero: true })
                );
                const maxError = errorFor(
                  `boxes.${index}.maxSellPrice`,
                  `variants.${index}.maxSellPrice`,
                  moneyError(box.maxSellPrice)
                );
                const stockError = errorFor(`boxes.${index}.stockQty`, `variants.${index}.stockQty`);
                return (
                  <li
                    key={box.key}
                    className={cn(
                      'rounded-xl border border-border p-3',
                      !box.isAvailable && 'bg-muted/60'
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold">{boxName(box, draft.unit)}</span>
                        {!box.isAvailable && <Badge>{t('products.box.off')}</Badge>}
                      </span>
                      {box.id ? (
                        <Button
                          size="sm"
                          variant="quiet"
                          className={box.isAvailable ? 'text-danger' : undefined}
                          onClick={() => setBox(index, { isAvailable: !box.isAvailable })}
                        >
                          {box.isAvailable ? t('products.boxOff') : t('products.boxOn')}
                        </Button>
                      ) : (
                        draft.boxes.length > 1 && (
                          <Button
                            size="sm"
                            variant="quiet"
                            className="text-danger"
                            onClick={() => removeBox(index)}
                          >
                            {t('app.remove')}
                          </Button>
                        )
                      )}
                    </div>
                    {!box.isAvailable && box.id && (
                      <p className="mb-3 text-xs text-muted-foreground">{t('products.boxOffNote')}</p>
                    )}

                    <div className="grid gap-x-3 sm:grid-cols-2">
                      <Field
                        label={t('catalog.boxContent')}
                        htmlFor={`content-${box.key}`}
                        error={contentError}
                        required
                      >
                        <Input
                          id={`content-${box.key}`}
                          type="number"
                          min="0"
                          step="0.25"
                          inputMode="decimal"
                          className="tabular"
                          value={box.content}
                          invalid={Boolean(contentError)}
                          trailing={<span className="text-sm text-muted-foreground">{tUnit(draft.unit)}</span>}
                          onChange={(e) => setBox(index, { content: e.target.value })}
                        />
                      </Field>

                      <Field
                        label={t('catalog.boxLabel')}
                        htmlFor={`label-${box.key}`}
                        hint={tf('products.boxNameHint', { label: derivedLabel(box, draft.unit) })}
                        error={serverErrors[`variants.${index}.label`]}
                      >
                        <Input
                          id={`label-${box.key}`}
                          maxLength={60}
                          value={box.label}
                          placeholder={derivedLabel(box, draft.unit)}
                          onChange={(e) => setBox(index, { label: e.target.value })}
                        />
                      </Field>

                      <Field
                        label={`${t('catalog.costPrice')} (${t('catalog.perBox')})`}
                        htmlFor={`cost-${box.key}`}
                        error={costError}
                        required
                      >
                        <MoneyInput
                          id={`cost-${box.key}`}
                          value={box.costPrice}
                          invalid={Boolean(costError)}
                          onChange={(e) => setBox(index, { costPrice: e.target.value })}
                        />
                      </Field>

                      <Field
                        label={t('catalog.maxSellPrice')}
                        htmlFor={`max-${box.key}`}
                        hint={t('app.optional')}
                        error={maxError}
                      >
                        <MoneyInput
                          id={`max-${box.key}`}
                          value={box.maxSellPrice}
                          invalid={Boolean(maxError)}
                          onChange={(e) => setBox(index, { maxSellPrice: e.target.value })}
                        />
                      </Field>

                      {draft.trackStock && !box.id && (
                        <Field
                          label={t('products.boxStockStart')}
                          htmlFor={`stock-${box.key}`}
                          hint={t('catalog.stockHint')}
                          error={stockError}
                        >
                          <Input
                            id={`stock-${box.key}`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            className="tabular"
                            value={box.stockQty}
                            placeholder="0"
                            invalid={Boolean(stockError)}
                            onChange={(e) => setBox(index, { stockQty: e.target.value })}
                          />
                        </Field>
                      )}
                    </div>

                    {/* The count is shown, never edited, here: see StockSheet. */}
                    {draft.trackStock && saved && saved.stockQty != null && (
                      <p className="tabular text-xs text-muted-foreground">
                        {tf('products.boxStockSaved', { n: formatNumber(saved.stockQty) })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Below the last box, where the thumb already is after filling it in. */}
            {draft.boxes.length < 8 && (
              <Button variant="outline" full className="mt-3" onClick={addBox}>
                <Plus className="h-4 w-4" />
                {t('catalog.addBox')}
              </Button>
            )}
          </section>

          {product ? (
            <ProductPhotos product={product} />
          ) : (
            <ImagesField
              id="images"
              label={t('catalog.images')}
              hint={t('catalog.imagesHint')}
              value={files}
              onChange={setFiles}
              error={serverErrors.images}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * An existing product's photographs, sent the moment they are picked.
 *
 * They used to wait for the product's Save, which made a twelve-photo product a
 * single multi-megabyte request on a 2G connection, all lost if it timed out.
 * One pick is one upload now, with a spinner on the tiles it is carrying, and a
 * removal asks on the tile first because there is no Save to back out of.
 */
function ProductPhotos({ product }: { product: OwnerProduct }) {
  const toast = useToast();
  const [images, setImages] = useState(product.images);
  const [pending, setPending] = useState<File[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Separate hooks for the upload and the removal, so one request's state is
  // never read as the other's: a removal during a slow upload used to make the
  // upload look finished and offer "retry", which uploaded the photos twice.
  const [update, uploadState] = useUpdateProductMutation();
  const [removeRequest] = useUpdateProductMutation();
  const [setCover] = useSetProductCoverMutation();
  const uploading = uploadState.isLoading;
  // One change to the set at a time: each answer replaces the whole list, so
  // two in flight would leave whichever answered last on screen.
  const busy = uploading || removing.length > 0;

  const makeCover = async (imageId: string) => {
    setRemoving((prev) => [...prev, imageId]);
    setError(null);
    try {
      const { product: fresh } = await setCover({ id: product.id, imageId }).unwrap();
      setImages(fresh.images);
      toast(t('photos.coverSet'));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRemoving((prev) => prev.filter((value) => value !== imageId));
    }
  };

  const upload = async (files: File[]) => {
    setPending(files);
    setError(null);
    const data = new FormData();
    files.forEach((file) => data.append('images', file));
    try {
      const { product: fresh } = await update({ id: product.id, formData: data }).unwrap();
      setImages(fresh.images);
      setPending([]);
      toast(t('file.uploaded'));
    } catch (failure) {
      // The files stay on their tiles, with a retry below them.
      setError(errorMessage(failure));
    }
  };

  const remove = async (id: string) => {
    setRemoving((prev) => [...prev, id]);
    setError(null);
    const data = new FormData();
    data.append('removeImages', id);
    try {
      const { product: fresh } = await removeRequest({ id: product.id, formData: data }).unwrap();
      setImages(fresh.images);
      toast(t('file.removed'));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRemoving((prev) => prev.filter((value) => value !== id));
    }
  };

  return (
    <div>
      <ImagesField
        id="images"
        label={t('catalog.images')}
        hint={t('catalog.imagesHint')}
        value={pending}
        existing={images}
        uploading={uploading}
        busyIds={removing}
        confirmRemove
        error={error ?? undefined}
        onChange={(files) => {
          if (busy) return;
          // A pick adds files; dropping a failed one from the tray does not upload.
          if (files.length > pending.length) void upload(files);
          else setPending(files);
        }}
        onRemoveExisting={busy ? undefined : (id) => void remove(id)}
        onMakeCover={busy ? undefined : (id) => void makeCover(id)}
      />
      <p className="mt-1 text-xs text-muted-foreground">{t('products.photosInstant')}</p>
      {pending.length > 0 && !busy && (
        <Button variant="outline" full className="mt-2" onClick={() => void upload(pending)}>
          {t('products.retryUpload')}
        </Button>
      )}
    </div>
  );
}
