'use client';

/**
 * One supply, and whether the book still agrees with the shelf.
 *
 * Most of what moves this count was never typed by a person. A delivery draws
 * packaging down from a recipe on the box — about one and a half sheets of কাগজ,
 * two সুই — and nobody stood at the table counting. Those movements are marked
 * `isEstimated` and the history says so on every row, because an estimate that
 * is presented as a measurement gets summed into a cost, then into a margin, and
 * then believed. See docs/adr/0026.
 *
 * A stock take is the answer to all of it, which is why it is the primary button
 * and the generic adjustment is the quiet one beside it: the shelf is the truth
 * and the book follows it.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  Layers,
  ShoppingCart,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, tMovementKind, tUnit } from '@/lib/i18n/bn';
import { businessDate, formatDate, formatMoney, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import type { StockMovement, SupplyDetail } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';

/** The kinds a person is allowed to write. `CONSUMED` and `REVERSAL` are the
 *  system's own, and `PURCHASE` belongs to a purchase. */
const ADJUST_KINDS = ['ADJUSTMENT', 'DAMAGED', 'LOST', 'RETURN_TO_PAYEE', 'OPENING'] as const;

type AdjustKind = (typeof ADJUST_KINDS)[number];

/** One page of the append-only log, for the "load more" under the history. */
type MovementPage = {
  movements: StockMovement[];
  page: number;
  limit: number;
  total: number;
};

const PAGE_SIZE = 20;

/**
 * A quantity as typed, checked the same way a taka amount is.
 *
 * `checkMoney` refuses a sign, which is right for money and wrong for an
 * `ADJUSTMENT`: a recount may go either way. The magnitude goes through the same
 * gate so the digit rules and the ceiling stay in one place.
 */
function quantityError(raw: string, signed: boolean): string | undefined {
  if (raw.trim() === '') return undefined;
  const magnitude = signed ? raw.trim().replace(/^-/, '') : raw;
  return moneyError(magnitude);
}

function quantityOk(raw: string, signed: boolean): boolean {
  if (raw.trim() === '') return false;
  const magnitude = signed ? raw.trim().replace(/^-/, '') : raw;
  return checkMoney(magnitude).ok;
}

export default function SupplyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [counting, setCounting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const query = useQuery({
    queryKey: ['owner', 'supply', id],
    queryFn: () => api.get<SupplyDetail>(`/owner/supplies/${id}`),
  });

  /*
   * The log is its own query rather than only what the detail carried, so that
   * "load more" does not refetch the purchases and the recipes with it.
   */
  const log = useQuery({
    queryKey: ['owner', 'supply', id, 'movements', limit],
    queryFn: () => api.get<MovementPage>(`/owner/supplies/${id}/movements?page=1&limit=${limit}`),
  });

  const back = (
    <Link
      href="/owner/supplies"
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('app.back')}
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

  const { supply, purchases, usedBy, health } = query.data!;
  const movements = log.data?.movements ?? query.data!.movements;
  const total = log.data?.total ?? movements.length;

  return (
    <>
      {back}

      <PageHeader
        title={supply.nameBn}
        subtitle={supply.note || tUnit(supply.unit)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/*
             * The count comes first. It is the only action here that makes the
             * book agree with the shelf again, and everything else on this page
             * is a reason to reach for it.
             */}
            <Button onClick={() => setCounting(true)}>
              <ClipboardCheck className="h-4 w-4" />
              {t('supply.stockTake')}
            </Button>
            <Button variant="outline" onClick={() => setAdjusting(true)}>
              {t('supply.adjust')}
            </Button>
          </div>
        }
      />

      {/*
       * Not a business event. The append-only log and the cached count are two
       * views of one number, and when they differ something in the code is
       * wrong — so it is said plainly rather than shown as a total.
       */}
      {!health.ok && (
        <Alert tone="danger" title={t('supply.healthBad')} icon={TriangleAlert}>
          <ul className="mt-1 list-inside list-disc">
            {health.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}

      {supply.isNegative && (
        <Alert tone="danger" title={t('supply.negative')} icon={TriangleAlert}>
          {t('supply.negativeHint')}
        </Alert>
      )}

      {supply.isLow && !supply.isNegative && (
        <Alert tone="warning" title={t('supply.low')}>
          {`${t('supply.reorderLevel')}: ${formatNumber(supply.reorderLevel)} ${tUnit(supply.unit)}`}
        </Alert>
      )}

      {supply.isArchived && <Alert tone="warning">{t('supply.archived')}</Alert>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Boxes}
          label={t('supply.onHand')}
          value={formatNumber(supply.onHand)}
          hint={tUnit(supply.unit)}
          tone={supply.isNegative ? 'danger' : supply.isLow ? 'warning' : 'primary'}
        />
        <Stat icon={Wallet} label={t('supply.avgCost')} value={formatMoney(supply.avgCost)} />
        <Stat label={t('supply.value')} value={formatMoney(supply.value)} />
        <Stat
          label={t('supply.reorderLevel')}
          value={supply.reorderLevel > 0 ? formatNumber(supply.reorderLevel) : '—'}
          hint={supply.reorderLevel > 0 ? tUnit(supply.unit) : t('supply.reorderHint')}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          {/*
           * The subtitle is the whole point of the card: every row says whether
           * anybody actually counted, and the reader needs to know that the
           * distinction exists before reading the first badge.
           */}
          <CardHeader title={t('supply.movements')} subtitle={t('supply.estimatedHint')} />

          {movements.length === 0 ? (
            <EmptyState icon={Boxes} title={t('supply.movementsEmpty')} />
          ) : (
            <>
              <ul className="-my-1 divide-y divide-border">
                {movements.map((movement) => (
                  <li key={movement.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {tMovementKind(movement.kind)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(movement.businessDate)}
                        </p>
                        {movement.note && (
                          <p className="mt-0.5 break-words text-xs text-muted-foreground">
                            {movement.note}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <p
                          className={
                            movement.quantity < 0
                              ? 'tabular text-sm font-bold text-danger-ink'
                              : 'tabular text-sm font-bold text-success-ink'
                          }
                        >
                          {`${movement.quantity < 0 ? '−' : '+'}${formatNumber(Math.abs(movement.quantity))}`}
                        </p>
                        <p className="tabular text-xs text-muted-foreground">
                          {`${t('supply.onHandAfter')} ${formatNumber(movement.onHandAfter)}`}
                        </p>
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={movement.isEstimated ? 'warning' : 'success'} dot>
                        {movement.isEstimated ? t('supply.estimated') : t('supply.counted2')}
                      </Badge>
                      {movement.unitCost > 0 && (
                        <span className="tabular text-xs text-muted-foreground">
                          {`${t('supply.unitCost')} ${formatMoney(movement.unitCost)}`}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {movements.length < total ? (
                <Button
                  variant="outline"
                  full
                  className="mt-4"
                  loading={log.isFetching}
                  onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
                >
                  {t('app.loadMore')}
                </Button>
              ) : (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  {t('app.allLoaded')}
                </p>
              )}
            </>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            {/*
             * Two figures per row on purpose. The rate is what was agreed; the
             * landed cost is what the crate actually cost once the van and the
             * labour were spread over it, and that second number is the one the
             * average on this page is built from. See docs/adr/0023.
             */}
            <CardHeader title={t('supply.purchaseHistory')} subtitle={t('purchase.landedHint')} />

            {purchases.length === 0 ? (
              <EmptyState icon={ShoppingCart} title={t('app.none')} />
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {purchases.map((purchase) => (
                  <li key={purchase.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="tabular truncate text-sm font-semibold">
                          {purchase.purchaseCode}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {purchase.payeeNameBn}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(purchase.businessDate)}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="tabular text-sm font-semibold">
                          {`${formatNumber(purchase.quantity)} ${tUnit(supply.unit)}`}
                        </p>
                        <p className="tabular text-xs text-muted-foreground">
                          {`${t('purchase.rate')} ${formatMoney(purchase.unitCost)}`}
                        </p>
                        <p className="tabular text-xs font-semibold">
                          {`${t('purchase.landedUnitCost')} ${formatMoney(purchase.landedUnitCost)}`}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            {/* Why the count moves on its own: these are the boxes whose recipe
              * draws this supply down at delivery. */}
            <CardHeader title={t('supply.usedBy')} subtitle={t('recipe.estimateNote')} />

            {usedBy.length === 0 ? (
              <EmptyState icon={Layers} title={t('app.none')} />
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {usedBy.map((row) => (
                  <li
                    key={`${row.variantId}`}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{row.productNameBn}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.variantLabel}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-semibold">
                        {`${formatNumber(row.perBox)} ${tUnit(supply.unit)}`}
                      </p>
                      <p className="text-xs text-muted-foreground">{t('supply.perBox')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {counting && (
        <StockTakeModal id={id} unit={supply.unit} onClose={() => setCounting(false)} />
      )}
      {adjusting && <AdjustModal id={id} unit={supply.unit} onClose={() => setAdjusting(false)} />}
    </>
  );
}

/* ----------------------------------------------------------- stock take -- */

type StockTakeResult = { movement: StockMovement | null; agreed: boolean };

/**
 * The count, which is the one thing on this screen that can make a wrong number
 * right. It takes the total on the shelf, not a difference: "there are ninety
 * four" is what a person holding a clipboard knows, and "six went missing" is
 * arithmetic they should not have to do.
 *
 * The box starts empty rather than seeded with the current figure. A pre-filled
 * count that somebody taps past is a stock take that confirms the book against
 * itself, which is worse than no stock take at all.
 */
function StockTakeModal({
  id,
  unit,
  onClose,
}: {
  id: string;
  unit: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(businessDate());
  /*
   * One key per open sheet, not per tap. A phone on one bar sends the same
   * request twice and the server has to be able to tell that it is the same
   * count, not two of them.
   */
  const [nonce] = useState(() => crypto.randomUUID());

  const save = useMutation({
    mutationFn: () =>
      api.post<StockTakeResult>(`/owner/supplies/${id}/stock-take`, {
        counted: Number(counted),
        nonce,
        ...(note.trim() ? { note } : {}),
        ...(date ? { date } : {}),
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner', 'supplies'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'supply', id] }),
      ]);
      /*
       * When the count already matched, nothing moved and closing would land on
       * a page that looks exactly as it did before — which reads as a failed
       * save. The sheet stays open to say the two agreed.
       */
      if (!result.agreed) onClose();
    },
  });

  const errors = fieldErrors(save.error);
  // Zero is a real count. An empty shelf is the answer the report needs most.
  const countError = errors.counted ?? moneyError(counted, { allowZero: true });
  const agreed = save.data?.agreed === true;

  return (
    <Modal
      open
      onClose={onClose}
      dirty={counted.trim() !== '' && !agreed}
      title={t('supply.stockTake')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {agreed ? t('app.close') : t('app.cancel')}
          </Button>
          {!agreed && (
            <Button
              loading={save.isPending}
              disabled={!checkMoney(counted, { allowZero: true }).ok}
              onClick={() => save.mutate()}
            >
              {t('app.save')}
            </Button>
          )}
        </>
      }
    >
      {agreed && <Alert tone="success">{t('supply.countedAgreed')}</Alert>}

      {save.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}

      <Field
        label={t('supply.counted')}
        htmlFor="counted"
        hint={t('supply.stockTakeHelp')}
        error={countError}
        required
      >
        <Input
          id="counted"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          className="tabular"
          trailing={<span className="text-sm text-muted-foreground">{tUnit(unit)}</span>}
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
          autoFocus
        />
      </Field>

      <Field label={t('app.date')} htmlFor="count-date" error={errors.date}>
        <Input
          id="count-date"
          type="date"
          className="tabular"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>

      <Field label={t('app.notes')} htmlFor="count-note" hint={t('app.optional')} error={errors.note}>
        <Textarea
          id="count-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </Modal>
  );
}

/* --------------------------------------------------------------- adjust -- */

/**
 * Everything else that moves a count and has a name: crates that broke, crates
 * that walked off, crates sent back to the supplier, and the plain correction.
 *
 * `RETURN_TO_PAYEE` is the one the server will refuse rather than let the count
 * go negative — sending crates back is a promise to somebody, so it cannot be
 * made out of stock that is not there.
 */
function AdjustModal({ id, unit, onClose }: { id: string; unit: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AdjustKind>('ADJUSTMENT');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(businessDate());
  const [nonce] = useState(() => crypto.randomUUID());

  // A recount may go either way; a loss only ever goes one way.
  const signed = kind === 'ADJUSTMENT';

  const save = useMutation({
    mutationFn: () =>
      api.post(`/owner/supplies/${id}/adjust`, {
        kind,
        quantity: Number(quantity),
        nonce,
        ...(note.trim() ? { note } : {}),
        ...(date ? { date } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner', 'supplies'] }),
        queryClient.invalidateQueries({ queryKey: ['owner', 'supply', id] }),
      ]);
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const qtyError = errors.quantity ?? quantityError(quantity, signed);

  return (
    <Modal
      open
      onClose={onClose}
      dirty={quantity.trim() !== ''}
      title={t('supply.adjust')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!quantityOk(quantity, signed)}
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

      <Field label={t('supply.adjustKind')} htmlFor="kind" error={errors.kind} required>
        <Select
          id="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as AdjustKind)}
        >
          {ADJUST_KINDS.map((option) => (
            <option key={option} value={option}>
              {tMovementKind(option)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t('supply.quantity')}
        htmlFor="quantity"
        // A minus sign is meaningful for a correction and meaningless for a
        // loss, so the hint changes with the kind rather than explaining both.
        hint={signed ? t('supply.stockTakeHelp') : undefined}
        error={qtyError}
        required
      >
        <Input
          id="quantity"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={signed ? undefined : '0'}
          className="tabular"
          trailing={<span className="text-sm text-muted-foreground">{tUnit(unit)}</span>}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          autoFocus
        />
      </Field>

      <Field label={t('app.date')} htmlFor="adjust-date" error={errors.date}>
        <Input
          id="adjust-date"
          type="date"
          className="tabular"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>

      <Field
        label={t('app.notes')}
        htmlFor="adjust-note"
        hint={t('app.optional')}
        error={errors.note}
      >
        <Textarea
          id="adjust-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </Modal>
  );
}
