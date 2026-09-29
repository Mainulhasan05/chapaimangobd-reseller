'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tUnit } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import type { OwnerProduct, ProductVariant, Supply } from '@/lib/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card } from '@/components/ui/layout';
import { Field, Input, Select, InlineIconButton } from '@/components/ui/form';
import { Spinner } from '@/components/ui/button';

/**
 * Setting a box's **packaging recipe**: what sending one of these takes.
 *
 * Its own modal, and its own endpoint, rather than part of the product form. The
 * product form is multipart because it carries photographs, and a multipart body
 * has no honest way to encode a nested array of objects — the same reason the
 * boxes themselves travel as a JSON string. See docs/adr/0026.
 *
 * Saved one box at a time, because that is what the endpoint takes and because a
 * recipe is a per-box decision the owner makes while looking at that box.
 */

type Row = { supplyId: string; quantity: string };

const toRows = (variant: ProductVariant): Row[] =>
  (variant.packaging || []).map((row) => ({
    supplyId: row.supplyId,
    quantity: String(row.quantity),
  }));

export function PackagingRecipeModal({
  product,
  onClose,
}: {
  product: OwnerProduct | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [openVariant, setOpenVariant] = useState<string | null>(
    product?.variants[0]?.id ?? null
  );

  // Every live supply, to choose from. Archived ones are excluded by default,
  // which is right: a recipe naming an archived item would consume nothing.
  const supplies = useQuery({
    queryKey: ['owner', 'supplies'],
    queryFn: () => api.get<{ supplies: Supply[] }>('/owner/supplies'),
    enabled: Boolean(product),
  });

  if (!product) return null;

  return (
    <Modal open onClose={onClose} title={t('recipe.title')} wide>
      <p className="mb-4 text-sm text-[var(--muted-fg)]">{t('recipe.help')}</p>

      {supplies.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {supplies.isSuccess && supplies.data.supplies.length === 0 && (
        <Alert tone="warning">{t('supply.help')}</Alert>
      )}

      {supplies.isSuccess && supplies.data.supplies.length > 0 && (
        <div className="space-y-3">
          {product.variants.map((variant) => (
            <VariantRecipe
              key={variant.id}
              productId={product.id}
              variant={variant}
              supplies={supplies.data.supplies}
              open={openVariant === variant.id}
              onToggle={() => setOpenVariant(openVariant === variant.id ? null : variant.id)}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ['owner', 'products'] })}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

function VariantRecipe({
  productId,
  variant,
  supplies,
  open,
  onToggle,
  onSaved,
}: {
  productId: string;
  variant: ProductVariant;
  supplies: Supply[];
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(variant));
  const byId = new Map(supplies.map((s) => [s.id, s]));

  const save = useMutation({
    mutationFn: () =>
      api.put(`/owner/products/${productId}/variants/${variant.id}/packaging`, {
        packaging: rows
          .filter((row) => row.supplyId && Number(row.quantity) > 0)
          .map((row) => ({ supplyId: row.supplyId, quantity: Number(row.quantity) })),
      }),
    onSuccess: onSaved,
  });

  const errors = fieldErrors(save.error);

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const addRow = () => setRows((prev) => [...prev, { supplyId: '', quantity: '1' }]);
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  /*
   * A supply already on the list is not offered again. The API refuses a
   * duplicate rather than summing it — a repeat is the owner having picked the
   * same thing twice, and summing would lose whichever quantity was typed second.
   */
  const available = (index: number) =>
    supplies.filter(
      (supply) => !rows.some((row, i) => i !== index && row.supplyId === supply.id)
    );

  return (
    <Card className="p-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-medium">{variant.label}</span>
        <span className="text-xs text-[var(--muted-fg)]">
          {variant.packaging.length === 0
            ? t('recipe.empty')
            : variant.packaging
                .map((row) => {
                  const supply = byId.get(row.supplyId);
                  return supply
                    ? `${supply.nameBn} ${formatNumber(row.quantity)} ${tUnit(supply.unit)}`
                    : '—';
                })
                .join(' · ')}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {rows.length === 0 && (
            <p className="text-xs text-[var(--muted-fg)]">{t('recipe.empty')}</p>
          )}

          {rows.map((row, index) => (
            <div key={index} className="flex items-end gap-2">
              <Field label={t('recipe.perBox')} className="flex-1" error={errors[`packaging.${index}.supplyId`]}>
                <Select
                  value={row.supplyId}
                  onChange={(e) => setRow(index, { supplyId: e.target.value })}
                >
                  <option value="">—</option>
                  {available(index).map((supply) => (
                    <option key={supply.id} value={supply.id}>
                      {supply.nameBn} ({tUnit(supply.unit)})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('supply.quantity')} className="w-24" error={errors[`packaging.${index}.qty`]}>
                {/*
                  * Fractional on purpose: an eleven-kilo box takes about one and a
                  * half sheets of কাগজ, and rounding that to one or two is a real
                  * error over four hundred parcels.
                  */}
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0"
                  value={row.quantity}
                  onChange={(e) => setRow(index, { quantity: e.target.value })}
                  className="tabular"
                />
              </Field>
              <InlineIconButton
                aria-label={t('app.remove')}
                onClick={() => removeRow(index)}
                className="mb-1"
              >
                <Trash2 className="h-4 w-4" />
              </InlineIconButton>
            </div>
          ))}

          {save.error && !Object.keys(errors).length && (
            <Alert tone="danger">{errorMessage(save.error)}</Alert>
          )}

          <p className="text-xs text-[var(--muted-fg)]">{t('recipe.estimateNote')}</p>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={addRow} disabled={rows.length >= 6}>
              <Plus className="h-4 w-4" />
              {t('recipe.add')}
            </Button>
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              {t('app.save')}
            </Button>
          </div>
          {save.isSuccess && !save.isPending && (
            <Badge tone="success">{t('app.saved')}</Badge>
          )}
        </div>
      )}
    </Card>
  );
}
