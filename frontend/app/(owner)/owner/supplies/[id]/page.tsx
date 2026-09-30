'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  ShoppingCart,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tMovementKind, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatDate } from '@/lib/format';
import type { SupplyDetail } from '@/lib/types';
import { Alert, Badge, Card, CardHeader, ErrorState, PageHeader, Stat } from '@/components/ui/layout';
import { Td, Th, Tr, TableWrap } from '@/components/ui/table';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  AvgCostWhyModal,
  ExplainedStat,
  OnHandWhyModal,
  useWhy,
  type AvgCostWhy,
  type OnHandWhy,
} from '@/components/why';

/**
 * One item of মালামাল: what is on the shelf, what it cost, and where both of
 * those figures came from.
 *
 * This screen is the pattern for the rest of the cost side, and it is built
 * against four complaints about the first version of it:
 *
 * 1. **The words were office Bengali.** Every label here is what the owner says
 *    out loud — "প্রতিটা পড়েছে", not "গড় খরচ"; "পার্সেলে গেছে", not "ব্যবহৃত".
 * 2. **Nothing said what to do next.** A supply with no purchase and no recipe is
 *    inert, and the screen now says so and links to the two places that fix it.
 * 3. **Worked-out numbers had no provenance.** The two figures the system computes
 *    carry a "কীভাবে?" that opens the arithmetic. See components/why.tsx.
 * 4. **The screens were islands.** Every purchase row, every box that consumes
 *    this, and the reason behind every movement now links somewhere.
 */

type Provenance = {
  onHand: OnHandWhy;
  avgCost: AvgCostWhy;
};

export default function SupplyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const why = useWhy();
  const [counting, setCounting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const query = useQuery({
    queryKey: ['owner', 'supply', id],
    queryFn: () => api.get<SupplyDetail & { provenance: Provenance }>(`/owner/supplies/${id}`),
  });

  const back = (
    <Link
      href="/owner/supplies"
      className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--muted-fg)] hover:underline"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('supply.title')}
    </Link>
  );

  if (query.isLoading) {
    return (
      <>
        {back}
        <StatSkeleton count={4} />
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        {back}
        <ErrorState
          onRetry={() => query.refetch()}
          isRetrying={query.isFetching}
          error={query.error}
        />
      </>
    );
  }

  const { supply, movements, purchases, usedBy, health, provenance } = query.data!;

  // What is missing before this item actually does anything. Both are common on a
  // fresh install and neither is an error, so they read as instructions.
  const neverBought = purchases.length === 0;
  const noRecipe = usedBy.length === 0;

  return (
    <>
      {back}

      <PageHeader
        title={supply.nameBn}
        subtitle={`${t('supply.unit')}: ${tUnit(supply.unit)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              * Counting is the primary action, not the generic adjust. It is the
              * only thing that corrects a drifting recipe, and it is what somebody
              * standing in the godown with a phone actually wants.
              */}
            <Button onClick={() => setCounting(true)}>
              <ClipboardCheck className="h-4 w-4" />
              {t('supply.stockTake')}
            </Button>
            <Button variant="quiet" onClick={() => setAdjusting(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              {t('supply.adjust')}
            </Button>
          </div>
        }
      />

      {/* --- what is wrong, loudest first --- */}

      {supply.isNegative && (
        <Alert tone="danger" icon={TriangleAlert} title={t('supply.negative')}>
          {t('supply.negativeHint')}
        </Alert>
      )}

      {!supply.isNegative && supply.isLow && (
        <Alert tone="warning" title={t('supply.low')}>
          {t('supply.reorderHint')}
        </Alert>
      )}

      {!health.ok && (
        <Alert tone="danger" icon={TriangleAlert} title={t('supply.healthBad')}>
          <ul className="mt-1 space-y-0.5 text-xs">
            {health.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}

      {supply.isArchived && <Alert tone="neutral">{t('supply.archived')}</Alert>}

      {/* --- what to do next, when this item is not doing anything yet --- */}

      {(neverBought || noRecipe) && (
        <Alert tone="primary" title={t('costSetup.next')}>
          <ul className="mt-1 space-y-2 text-sm">
            {neverBought && (
              <li className="flex flex-wrap items-center gap-2">
                <span>{t('costSetup.noPurchaseYet')}</span>
                <Link href="/owner/purchases" className="font-semibold underline">
                  {t('costSetup.recordPurchase')}
                </Link>
              </li>
            )}
            {noRecipe && (
              <li className="flex flex-wrap items-center gap-2">
                <span>{t('costSetup.noRecipeYet')}</span>
                <Link href="/owner/products" className="font-semibold underline">
                  {t('costSetup.setRecipe')}
                </Link>
              </li>
            )}
          </ul>
        </Alert>
      )}

      {/* --- the numbers. The two the system worked out explain themselves. --- */}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ExplainedStat
          label={t('supply.onHand')}
          value={`${formatNumber(supply.onHand)} ${tUnit(supply.unit)}`}
          onWhy={why.openOnHand}
        />
        <ExplainedStat
          label={t('supply.avgCost')}
          value={formatMoney(supply.avgCost)}
          onWhy={why.openAvgCost}
        />
        {/* Typed or trivially derived, so no working to show. */}
        <Stat label={t('supply.value')} value={formatMoney(supply.value)} icon={Boxes} />
        <Stat
          label={t('supply.reorderLevel')}
          value={
            supply.reorderLevel > 0
              ? `${formatNumber(supply.reorderLevel)} ${tUnit(supply.unit)}`
              : '—'
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* --- which boxes drain this, which is the answer to "why is it going down" --- */}
        <Card>
          <CardHeader title={t('supply.usedBy')} subtitle={t('recipe.estimateNote')} />
          {noRecipe ? (
            <div className="text-sm">
              <p className="mb-2 text-[var(--muted-fg)]">{t('costSetup.noRecipeYet')}</p>
              <Link href="/owner/products" className="font-semibold text-[var(--primary)] underline">
                {t('costSetup.goToProducts')}
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {usedBy.map((row) => (
                <li
                  key={`${row.productId}-${row.variantId}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span>
                    {row.productNameBn}
                    <span className="text-[var(--muted-fg)]"> · {row.variantLabel}</span>
                  </span>
                  <span className="tabular whitespace-nowrap">
                    {t('supply.perBox')} {formatNumber(row.perBox)} {tUnit(supply.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- where it came from, with the rate and the real cost side by side --- */}
        <Card>
          <CardHeader
            title={t('supply.purchaseHistory')}
            subtitle={t('purchase.landedHint')}
            action={
              <Link
                href="/owner/purchases"
                className="inline-flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
              >
                <ShoppingCart className="h-4 w-4" />
                {t('costSetup.recordPurchase')}
              </Link>
            }
          />
          {neverBought ? (
            <p className="text-sm text-[var(--muted-fg)]">{t('costSetup.noPurchaseYet')}</p>
          ) : (
            <ul className="space-y-2">
              {purchases.map((row) => (
                <li key={row.id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{row.payeeNameBn}</span>
                    <span className="tabular whitespace-nowrap">
                      {formatNumber(row.quantity)} {tUnit(supply.unit)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-xs text-[var(--muted-fg)]">
                    <span>{formatDate(row.businessDate)}</span>
                    <span className="tabular">
                      {/*
                        * The rate and what it actually cost, together. The gap
                        * between them is the whole reason this feature exists.
                        */}
                      {t('why.rate')} {formatMoney(row.unitCost)} →{' '}
                      <span className="font-semibold text-[var(--fg)]">
                        {formatMoney(row.landedUnitCost)}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --- everything that ever moved, and whether anybody counted it --- */}
      <Card className="mt-5">
        <CardHeader title={t('supply.movements')} />
        {movements.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">{t('supply.movementsEmpty')}</p>
        ) : (
          <>
            {/* Phone: a card each, because six columns in a sideways scroller
                hides the one that matters. */}
            <ul className="space-y-2 lg:hidden">
              {movements.map((m) => (
                <li key={m.id} className="rounded-md border border-[var(--border)] p-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{tMovementKind(m.kind)}</span>
                    <span className={`tabular ${m.quantity < 0 ? 'text-[var(--danger)]' : ''}`}>
                      {m.quantity > 0 ? '+' : ''}
                      {formatNumber(m.quantity)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-fg)]">
                    <span>{formatDate(m.businessDate)}</span>
                    <Badge tone={m.isEstimated ? 'warning' : 'success'}>
                      {m.isEstimated ? t('supply.estimated') : t('supply.counted2')}
                    </Badge>
                    <span>
                      {t('supply.onHandAfter')} {formatNumber(m.onHandAfter)}
                    </span>
                  </div>
                  {m.note && <p className="mt-1 text-xs">{m.note}</p>}
                </li>
              ))}
            </ul>

            <TableWrap from="lg" minWidth="44rem">
              <thead>
                <tr>
                  <Th>{t('supply.adjustKind')}</Th>
                  <Th>{t('app.date')}</Th>
                  <Th align="right">{t('supply.quantity')}</Th>
                  <Th align="right">{t('supply.onHandAfter')}</Th>
                  <Th>{t('supply.estimatedHint')}</Th>
                  <Th>{t('expense.note')}</Th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <Tr key={m.id}>
                    <Td>{tMovementKind(m.kind)}</Td>
                    <Td>{formatDate(m.businessDate)}</Td>
                    <Td
                      align="right"
                      className={`tabular ${m.quantity < 0 ? 'text-[var(--danger)]' : ''}`}
                    >
                      {m.quantity > 0 ? '+' : ''}
                      {formatNumber(m.quantity)}
                    </Td>
                    <Td align="right" className="tabular">
                      {formatNumber(m.onHandAfter)}
                    </Td>
                    <Td>
                      <Badge tone={m.isEstimated ? 'warning' : 'success'}>
                        {m.isEstimated ? t('supply.estimated') : t('supply.counted2')}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-[var(--muted-fg)]">{m.note ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </Card>

      <OnHandWhyModal
        open={why.which === 'onHand'}
        onClose={why.close}
        rows={provenance.onHand}
        onHand={supply.onHand}
      />
      <AvgCostWhyModal
        open={why.which === 'avgCost'}
        onClose={why.close}
        from={provenance.avgCost}
      />
      <CountModal id={id} supply={supply} open={counting} onClose={() => setCounting(false)} />
      <AdjustModal id={id} supply={supply} open={adjusting} onClose={() => setAdjusting(false)} />
    </>
  );
}

/**
 * গুনে দেখুন — a stock take.
 *
 * Takes the counted total, never a difference: "there are ninety-four" is what
 * somebody with a clipboard knows, and making them work out "six went missing" is
 * asking them to do arithmetic the computer is for.
 */
function CountModal({
  id,
  supply,
  open,
  onClose,
}: {
  id: string;
  supply: SupplyDetail['supply'];
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  // Held per open sheet, so a double tap or a retry on a bad connection cannot
  // post the same count twice.
  const [nonce] = useState(() => crypto.randomUUID());

  const save = useMutation({
    mutationFn: () =>
      api.post<{ agreed: boolean }>(`/owner/supplies/${id}/stock-take`, {
        counted: Number(counted),
        nonce,
        ...(note ? { note } : {}),
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      toast(data.agreed ? t('supply.countedAgreed') : t('app.saved'));
      onClose();
      setCounted('');
      setNote('');
    },
  });

  const errors = fieldErrors(save.error);
  const valid = counted !== '' && Number(counted) >= 0;
  const difference = valid ? Number(counted) - supply.onHand : null;

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('supply.stockTake')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">{t('supply.stockTakeHelp')}</p>

      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <div className="mb-3 rounded-md bg-[var(--muted)] p-2 text-sm">
        {t('supply.onHand')}:{' '}
        <span className="tabular font-semibold">
          {formatNumber(supply.onHand)} {tUnit(supply.unit)}
        </span>
      </div>

      <Field label={t('supply.counted')} error={errors.counted} required>
        <Input
          type="number"
          inputMode="decimal"
          step="0.001"
          min="0"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          className="tabular"
          autoFocus
        />
      </Field>

      {/*
        * The subtraction, shown as it is typed, so the owner sees what they are
        * about to record before they record it rather than after.
        */}
      {difference !== null && difference !== 0 && (
        <p className="mb-3 text-sm">
          <span className={difference < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}>
            {difference > 0 ? '+' : ''}
            {formatNumber(difference)} {tUnit(supply.unit)}
          </span>{' '}
          <span className="text-[var(--muted-fg)]">{t('movement.ADJUSTMENT')}</span>
        </p>
      )}
      {difference === 0 && (
        <p className="mb-3 text-sm text-[var(--muted-fg)]">{t('supply.countedAgreed')}</p>
      )}

      <Field label={t('expense.note')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
    </Modal>
  );
}

/** হাতে হিসাব ঠিক করুন — breakage, a loss, an opening balance, a return. */
function AdjustModal({
  id,
  supply,
  open,
  onClose,
}: {
  id: string;
  supply: SupplyDetail['supply'];
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState('DAMAGED');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [nonce] = useState(() => crypto.randomUUID());

  const save = useMutation({
    mutationFn: () =>
      api.post(`/owner/supplies/${id}/adjust`, {
        kind,
        quantity: Number(quantity),
        nonce,
        ...(note ? { note } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      toast(t('app.saved'));
      onClose();
      setQuantity('');
      setNote('');
    },
  });

  const errors = fieldErrors(save.error);

  if (!open) return null;

  /*
   * `ADJUSTMENT` is the only kind whose direction the owner chooses; the rest have
   * one obvious direction and the server normalises the sign, so a typed minus on
   * "নষ্ট হয়েছে" cannot accidentally add stock.
   */
  const KINDS = ['DAMAGED', 'LOST', 'OPENING', 'RETURN_TO_PAYEE', 'ADJUSTMENT'];
  const signed = kind === 'ADJUSTMENT';

  return (
    <Modal
      open
      onClose={onClose}
      title={t('supply.adjust')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!quantity || Number(quantity) === 0}
            onClick={() => save.mutate()}
          >
            {t('app.save')}
          </Button>
        </>
      }
    >
      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field label={t('supply.adjustKind')} error={errors.kind} required>
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {tMovementKind(k)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t('supply.quantity')}
        error={errors.quantity}
        hint={signed ? t('movement.ADJUSTMENT') : undefined}
        required
      >
        <Input
          type="number"
          inputMode="decimal"
          step="0.001"
          {...(signed ? {} : { min: '0' })}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="tabular"
        />
      </Field>

      {kind === 'RETURN_TO_PAYEE' && (
        <p className="mb-3 text-xs text-[var(--muted-fg)]">
          {t('supply.onHand')}: {formatNumber(supply.onHand)} {tUnit(supply.unit)}
        </p>
      )}

      <Field label={t('expense.note')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
    </Modal>
  );
}
