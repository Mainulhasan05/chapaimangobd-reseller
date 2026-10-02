'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf, tUnit } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { OwnerProduct, ProductVariant, Supply } from '@/lib/types';
import { useGetSuppliesQuery, useSaveVariantPackagingMutation } from '@/lib/store/endpoints/catalog';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Badge } from '@/components/ui/layout';
import { Field, Input, Select, InlineIconButton } from '@/components/ui/form';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * Setting a box's **packaging recipe**: what sending one of these takes.
 *
 * Its own modal, and its own endpoint, rather than part of the product form. The
 * product form is multipart because it carries photographs, and a multipart body
 * has no honest way to encode a nested array of objects — the same reason the
 * boxes themselves travel as a JSON string. See docs/adr/0026.
 *
 * The endpoint takes one box at a time, but the sheet has one Save for all of
 * them: a Save inside each box meant editing two boxes and closing the sheet
 * threw away whichever one was not saved, with nothing to say so. Each box that
 * changed is sent in turn; one that fails stays open with its error, and the
 * ones that went through are marked.
 *
 * Mount it only while open (or key it by product), so one product's typing never
 * carries into the next.
 */

type Row = { supplyId: string; quantity: string };

const toRows = (variant: ProductVariant): Row[] =>
  (variant.packaging || []).map((row) => ({
    supplyId: row.supplyId,
    quantity: String(row.quantity),
  }));

const sameRows = (a: Row[], b: Row[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three decimals, because an eleven-kilo box takes about 1.375 sheets of কাগজ and
 * the app-wide formatter would show that as 1.38.
 */
const QTY = new Intl.NumberFormat('bn-BD', { maximumFractionDigits: 3 });

/** A row naming a supply that is archived, or no longer in the list at all. */
const isStale = (row: Row, byId: Map<string, Supply>) =>
  Boolean(row.supplyId) && byId.size > 0 && (!byId.has(row.supplyId) || Boolean(byId.get(row.supplyId)?.isArchived));

/**
 * What is wrong with each row, by index. A row needs a live supply and a
 * positive amount: the API refuses a recipe naming an archived one.
 */
function rowProblems(
  rows: Row[],
  byId: Map<string, Supply>
): Record<number, { supply?: string; qty?: string }> {
  const out: Record<number, { supply?: string; qty?: string }> = {};
  rows.forEach((row, index) => {
    const problem: { supply?: string; qty?: string } = {};
    if (!row.supplyId) problem.supply = t('recipes.supplyMissing');
    else if (isStale(row, byId)) problem.supply = t('recipes.archivedHint');
    if (!(Number(row.quantity) > 0)) problem.qty = t('recipes.qtyMissing');
    if (problem.supply || problem.qty) out[index] = problem;
  });
  return out;
}

export function PackagingRecipeModal({
  product,
  onClose,
}: {
  product: OwnerProduct;
  onClose: () => void;
}) {
  const toast = useToast();

  /*
   * Archived supplies too, but only so a recipe that still names one can say
   * which ("সরিয়ে রাখা: ক্যারেট") instead of showing an empty choice. Only live
   * ones are offered: a recipe naming an archived item would consume nothing.
   */
  const supplies = useGetSuppliesQuery({ includeArchived: true });
  const [save] = useSaveVariantPackagingMutation();

  const [baseline, setBaseline] = useState<Record<string, Row[]>>(() =>
    Object.fromEntries(product.variants.map((v) => [v.id, toRows(v)]))
  );
  const [drafts, setDrafts] = useState<Record<string, Row[]>>(baseline);
  const [open, setOpen] = useState<string | null>(product.variants[0]?.id ?? null);
  const [savedNow, setSavedNow] = useState<string[]>([]);
  const [failures, setFailures] = useState<Record<string, unknown>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const everything = useMemo(() => supplies.data?.supplies ?? [], [supplies.data]);
  const list = useMemo(() => everything.filter((s) => !s.isArchived), [everything]);
  const byId = useMemo(() => new Map(everything.map((s) => [s.id, s])), [everything]);

  const dirtyIds = product.variants
    .filter((v) => !sameRows(drafts[v.id] ?? [], baseline[v.id] ?? []))
    .map((v) => v.id);

  const setRows = (variantId: string, rows: Row[]) => {
    setDrafts((prev) => ({ ...prev, [variantId]: rows }));
    // An edit after a save makes the "saved" mark a lie, so it goes.
    setSavedNow((prev) => prev.filter((id) => id !== variantId));
  };

  const saveAll = async () => {
    setTried(true);
    if (dirtyIds.length === 0) {
      onClose();
      return;
    }
    const invalid = dirtyIds.find((id) => Object.keys(rowProblems(drafts[id] ?? [], byId)).length > 0);
    if (invalid) {
      setOpen(invalid);
      return;
    }

    setBusy(true);
    const failed: Record<string, unknown> = {};
    const done: string[] = [];
    // One at a time, as the endpoint takes them, so a failure is pinned to its box.
    for (const variantId of dirtyIds) {
      const rows = drafts[variantId] ?? [];
      try {
        await save({
          productId: product.id,
          variantId,
          packaging: rows.map((row) => ({ supplyId: row.supplyId, quantity: Number(row.quantity) })),
        }).unwrap();
        done.push(variantId);
      } catch (error) {
        failed[variantId] = error;
      }
    }
    setBusy(false);
    setBaseline((prev) => ({
      ...prev,
      ...Object.fromEntries(done.map((id) => [id, drafts[id] ?? []])),
    }));
    setFailures(failed);
    setSavedNow((prev) => [...prev, ...done]);

    const failedIds = Object.keys(failed);
    if (failedIds.length === 0) {
      toast(tf('recipes.saved', { name: product.name }));
      onClose();
    } else {
      setOpen(failedIds[0]);
      toast(tf('recipes.partFailed', { count: formatNumber(failedIds.length) }), 'danger');
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      dirty={dirtyIds.length > 0}
      title={`${t('recipe.title')} · ${product.name}`}
      footer={
        list.length > 0 ? (
          <>
            <ModalCancel disabled={busy} />
            <Button loading={busy} onClick={saveAll}>
              {t('recipes.saveAll')}
            </Button>
          </>
        ) : undefined
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">{t('recipe.help')}</p>

      {supplies.isLoading && <ListSkeleton rows={2} />}

      {supplies.isError && !supplies.data && (
        <Alert tone="danger">
          {errorMessage(supplies.error)}{' '}
          <button type="button" className="tap font-semibold underline" onClick={() => supplies.refetch()}>
            {t('app.retry')}
          </button>
        </Alert>
      )}

      {/* Nothing to choose from yet: say where the supplies are made. */}
      {supplies.data && list.length === 0 && (
        <Alert tone="warning">
          <p>{t('recipes.noSupplies')}</p>
          <ButtonLink href="/owner/supplies" variant="outline" size="sm" className="mt-3">
            {t('recipes.goToSupplies')}
          </ButtonLink>
        </Alert>
      )}

      {list.length > 0 && (
        <div className="space-y-3">
          {product.variants.map((variant) => (
            <VariantRecipe
              key={variant.id}
              variant={variant}
              rows={drafts[variant.id] ?? []}
              onRows={(rows) => setRows(variant.id, rows)}
              supplies={list}
              byId={byId}
              open={open === variant.id}
              onToggle={() => setOpen(open === variant.id ? null : variant.id)}
              dirty={dirtyIds.includes(variant.id)}
              saved={savedNow.includes(variant.id)}
              failure={failures[variant.id]}
              showProblems={tried}
            />
          ))}
        </div>
      )}

      {list.length > 0 && <p className="mt-4 text-xs text-muted-foreground">{t('recipe.estimateNote')}</p>}
    </Modal>
  );
}

function VariantRecipe({
  variant,
  rows,
  onRows,
  supplies,
  byId,
  open,
  onToggle,
  dirty,
  saved,
  failure,
  showProblems,
}: {
  variant: ProductVariant;
  rows: Row[];
  onRows: (rows: Row[]) => void;
  supplies: Supply[];
  byId: Map<string, Supply>;
  open: boolean;
  onToggle: () => void;
  dirty: boolean;
  saved: boolean;
  failure: unknown;
  showProblems: boolean;
}) {
  const panelId = `recipe-${variant.id}`;
  // An archived supply is flagged straight away, not only after a Save attempt.
  const problems: Record<number, { supply?: string; qty?: string }> = showProblems
    ? rowProblems(rows, byId)
    : Object.fromEntries(
        Object.entries(rowProblems(rows, byId))
          .filter(([index]) => isStale(rows[Number(index)], byId))
          .map(([index, problem]) => [index, { supply: problem.supply }])
      );
  const errors = fieldErrors(failure);

  const setRow = (index: number, patch: Partial<Row>) =>
    onRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const addRow = () => onRows([...rows, { supplyId: '', quantity: '1' }]);
  const removeRow = (index: number) => onRows(rows.filter((_, i) => i !== index));

  /*
   * A supply already on the list is not offered again. The API refuses a
   * duplicate rather than summing it — a repeat is the owner having picked the
   * same thing twice, and summing would lose whichever quantity was typed second.
   */
  const available = (index: number) =>
    supplies.filter((supply) => !rows.some((row, i) => i !== index && row.supplyId === supply.id));

  // The header is read from what is typed now, not from what was loaded.
  const summary =
    rows.filter((row) => row.supplyId).length === 0
      ? t('recipes.emptyShort')
      : rows
          .filter((row) => row.supplyId)
          .map((row) => {
            const supply = byId.get(row.supplyId);
            const qty = Number(row.quantity) > 0 ? QTY.format(Number(row.quantity)) : '—';
            if (!supply) return `${t('recipes.unknownSupply')} ${qty}`;
            const name = supply.isArchived
              ? tf('recipes.archivedSupply', { name: supply.nameBn })
              : supply.nameBn;
            return `${name} ${qty} ${tUnit(supply.unit)}`;
          })
          .join(' · ');

  return (
    <div
      className={cn(
        'rounded-xl border',
        failure ? 'border-danger' : 'border-border'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{variant.label}</span>
            {failure ? (
              <Badge tone="danger">{t('recipes.failed')}</Badge>
            ) : dirty ? (
              <Badge tone="warning">{t('recipes.unsaved')}</Badge>
            ) : saved ? (
              <Badge tone="success">{t('app.saved')}</Badge>
            ) : null}
          </span>
          <span className="tabular mt-0.5 block text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div id={panelId} className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          {rows.length === 0 && <p className="text-xs text-muted-foreground">{t('recipe.empty')}</p>}

          {rows.map((row, index) => {
            const supply = byId.get(row.supplyId);
            const supplyError = errors[`packaging.${index}.supplyId`] ?? problems[index]?.supply;
            const qtyError =
              errors[`packaging.${index}.qty`] ??
              errors[`packaging.${index}.quantity`] ??
              problems[index]?.qty;
            return (
              // Rows have no identity until saved; the index is the identity here.
              <div
                key={index}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
              >
                <Field
                  label={t('recipe.perBox')}
                  htmlFor={`${panelId}-supply-${index}`}
                  className="col-span-2 mb-2 sm:col-span-1 sm:mb-0"
                  error={supplyError}
                >
                  <Select
                    id={`${panelId}-supply-${index}`}
                    value={row.supplyId}
                    aria-invalid={supplyError ? true : undefined}
                    onChange={(e) => setRow(index, { supplyId: e.target.value })}
                  >
                    <option value="">{t('recipes.chooseSupply')}</option>
                    {/* The archived (or vanished) supply this row still names, so
                      * the select shows what is there rather than "বেছে নিন". */}
                    {row.supplyId && (!supply || supply.isArchived) && (
                      <option value={row.supplyId} disabled>
                        {supply
                          ? tf('recipes.archivedSupply', { name: supply.nameBn })
                          : t('recipes.unknownSupply')}
                      </option>
                    )}
                    {available(index).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.nameBn} ({tUnit(option.unit)})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('supply.quantity')}
                  htmlFor={`${panelId}-qty-${index}`}
                  className="mb-0"
                  error={qtyError}
                >
                  {/*
                   * Fractional on purpose: an eleven-kilo box takes about one and a
                   * half sheets of কাগজ, and rounding that to one or two is a real
                   * error over four hundred parcels.
                   */}
                  <Input
                    id={`${panelId}-qty-${index}`}
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    value={row.quantity}
                    invalid={Boolean(qtyError)}
                    onChange={(e) => setRow(index, { quantity: e.target.value })}
                    className="tabular"
                    trailing={
                      supply ? (
                        <span className="text-sm text-muted-foreground">{tUnit(supply.unit)}</span>
                      ) : undefined
                    }
                  />
                </Field>
                <div className="pt-[1.625rem]">
                  <InlineIconButton aria-label={t('app.remove')} onClick={() => removeRow(index)}>
                    <Trash2 className="h-4 w-4" />
                  </InlineIconButton>
                </div>
              </div>
            );
          })}

          {Boolean(failure) && Object.keys(errors).length === 0 && (
            <Alert tone="danger">{errorMessage(failure)}</Alert>
          )}

          {rows.length < 6 && (
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus className="h-4 w-4" />
              {t('recipe.add')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
