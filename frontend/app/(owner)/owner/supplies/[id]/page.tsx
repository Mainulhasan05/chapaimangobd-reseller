'use client';

import { use, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArchiveRestore,
  Boxes,
  ClipboardCheck,
  PackageOpen,
  Pencil,
  ShoppingCart,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tf, tMovementKind, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useAdjustSupplyMutation,
  useGetSupplyQuery,
  useSetSupplyArchivedMutation,
  useStockTakeSupplyMutation,
  type SupplyMovement,
  type SupplyView,
} from '@/lib/store/endpoints/catalog';
import { Alert, Badge, Card, CardHeader, ErrorState, PageHeader, Stat } from '@/components/ui/layout';
import { Td, Th, Tr, TableWrap } from '@/components/ui/table';
import { Field, Input, Select, Textarea, focusFirstInvalid } from '@/components/ui/form';
import { Button, ButtonLink } from '@/components/ui/button';
import { BackLink } from '@/components/ui/back-link';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { Segmented } from '@/components/ui/toolbar';
import { useToast } from '@/components/ui/toast';
import { AvgCostWhyModal, ExplainedStat, OnHandWhyModal, useWhy } from '@/components/why';
import { SupplySheet } from '../supply-sheet';

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

type SupplyRecord = SupplyView['supply'];

/** Three decimals, because a recipe of 1.375 sheets is a real number here. */
const QTY = new Intl.NumberFormat('bn-BD', { maximumFractionDigits: 3 });
const qty = (value: number, unit: string) => `${QTY.format(value)} ${tUnit(unit)}`;
const signedQty = (value: number, unit: string) => `${value > 0 ? '+' : ''}${qty(value, unit)}`;

/** The purchases list, opened on that one purchase. */
const purchaseHref = (id: string) => `/owner/purchases?purchase=${id}` as Route;

export default function SupplyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const why = useWhy();
  const [counting, setCounting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [editing, setEditing] = useState(false);

  const query = useGetSupplyQuery({ id });
  const [setArchived, restoring] = useSetSupplyArchivedMutation();

  const back = <BackLink fallback="/owner/supplies" label={t('supply.title')} />;

  if (query.isLoading) {
    return (
      <>
        {back}
        <StatSkeleton count={4} />
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (!query.data) {
    return (
      <>
        {back}
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
      </>
    );
  }

  const { supply, movements, purchases, usedBy, health, provenance } = query.data;

  // What is missing before this item actually does anything. Both are common on a
  // fresh install and neither is an error, so they read as instructions.
  const neverBought = purchases.length === 0;
  const noRecipe = usedBy.length === 0;

  const restore = async () => {
    try {
      await setArchived({ id, isArchived: false }).unwrap();
      toast(tf('supplies.restored', { name: supply.nameBn }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  return (
    <>
      {back}

      <PageHeader
        title={supply.nameBn}
        subtitle={`${t('supply.unit')}: ${tUnit(supply.unit)}`}
        action={
          supply.isArchived ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" loading={restoring.isLoading} onClick={restore}>
                <ArchiveRestore className="h-4 w-4" />
                {t('app.restore')}
              </Button>
              <Button variant="quiet" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                {t('app.edit')}
              </Button>
            </div>
          ) : (
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
              <Button variant="outline" onClick={() => setAdjusting(true)}>
                <SlidersHorizontal className="h-4 w-4" />
                {t('supply.adjust')}
              </Button>
              <Button variant="quiet" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                {t('app.edit')}
              </Button>
            </div>
          )
        }
      />

      {/* --- what is wrong, loudest first --- */}

      {supply.isArchived && <Alert tone="neutral">{t('supplies.archivedBanner')}</Alert>}

      {supply.isNegative && (
        <Alert tone="danger" icon={TriangleAlert} title={t('supply.negative')}>
          {t('supply.negativeHint')}
        </Alert>
      )}

      {!supply.isNegative && supply.isLow && (
        <Alert tone="warning" title={t('supply.low')}>
          {t('supplies.reorderHint')}
        </Alert>
      )}

      {/*
        * The server's problem lines are developer English ("Movement … has seq
        * 3"), so they stay out of the screen. What the owner can do about a drift
        * is count the shelf, which resets the figure.
        */}
      {!health.ok && (
        <Alert tone="danger" icon={TriangleAlert} title={t('supplies.healthTitle')}>
          <p>{t('supplies.healthHelp')}</p>
          {!supply.isArchived && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setCounting(true)}>
              <ClipboardCheck className="h-4 w-4" />
              {t('supply.stockTake')}
            </Button>
          )}
        </Alert>
      )}

      {/* --- what to do next, when this item is not doing anything yet --- */}

      {!supply.isArchived && (neverBought || noRecipe) && (
        <Alert tone="primary" title={t('costSetup.next')}>
          <ul className="mt-1 space-y-2 text-sm">
            {neverBought && (
              <li className="flex flex-wrap items-center gap-x-2">
                <span>{t('costSetup.noPurchaseYet')}</span>
                <Link href="/owner/purchases" className="tap inline-flex items-center font-semibold underline">
                  {t('costSetup.recordPurchase')}
                </Link>
              </li>
            )}
            {noRecipe && (
              <li className="flex flex-wrap items-center gap-x-2">
                <span>{t('costSetup.noRecipeYet')}</span>
                <Link href="/owner/products" className="tap inline-flex items-center font-semibold underline">
                  {t('costSetup.setRecipe')}
                </Link>
              </li>
            )}
          </ul>
        </Alert>
      )}

      {/* --- the numbers. The two the system worked out explain themselves. --- */}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <ExplainedStat
          label={t('supply.onHand')}
          value={qty(supply.onHand, supply.unit)}
          onWhy={why.openOnHand}
        />
        <ExplainedStat label={t('supply.avgCost')} value={formatMoney(supply.avgCost)} onWhy={why.openAvgCost} />
        {/* Typed or trivially derived, so no working to show. */}
        <Stat label={t('supply.value')} value={formatMoney(supply.value)} icon={Boxes} />
        <Stat
          label={t('supply.reorderLevel')}
          value={supply.reorderLevel > 0 ? qty(supply.reorderLevel, supply.unit) : '—'}
        />
      </div>

      {/* Children may shrink: a grid item defaults to its content's width, which pushed
        * these cards 3px past a 360px screen. */}
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        {/* --- which boxes drain this, which is the answer to "why is it going down" --- */}
        <Card>
          <CardHeader title={t('supply.usedBy')} subtitle={t('recipe.estimateNote')} />
          {noRecipe ? (
            <div className="text-sm">
              <p className="mb-2 text-muted-foreground">{t('costSetup.noRecipeYet')}</p>
              <ButtonLink href="/owner/products" variant="outline" size="sm">
                {t('costSetup.goToProducts')}
              </ButtonLink>
            </div>
          ) : (
            <ul className="-my-1 divide-y divide-border">
              {usedBy.map((row) => (
                <li key={`${row.productId}-${row.variantId}`}>
                  {/* Straight to that product's recipe sheet, open. */}
                  <Link
                    href={`/owner/products?recipe=${row.productId}` as Route}
                    aria-label={`${row.productNameBn} · ${row.variantLabel} — ${t('supplies.editRecipe')}`}
                    className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0">
                      {row.productNameBn}
                      <span className="text-muted-foreground"> · {row.variantLabel}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular whitespace-nowrap">
                        {t('supply.perBox')} {qty(row.perBox, supply.unit)}
                      </span>
                      <PackageOpen aria-hidden className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </Link>
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
              <ButtonLink href="/owner/purchases" variant="quiet" size="sm">
                <ShoppingCart className="h-4 w-4" />
                {t('costSetup.recordPurchase')}
              </ButtonLink>
            }
          />
          {neverBought ? (
            <p className="text-sm text-muted-foreground">{t('costSetup.noPurchaseYet')}</p>
          ) : (
            <ul className="-my-1 divide-y divide-border">
              {purchases.map((row) => (
                <li key={row.id}>
                  <Link
                    href={purchaseHref(row.id)}
                    className="-mx-2 block rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        {row.payeeNameBn}
                        {row.status === 'cancelled' && (
                          <Badge tone="danger" className="ml-2">
                            {t('supplies.purchaseCancelled')}
                          </Badge>
                        )}
                      </span>
                      <span className={cn('tabular whitespace-nowrap', row.status === 'cancelled' && 'line-through')}>
                        {qty(row.quantity, supply.unit)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                      <span className="tabular">
                        {formatDate(row.businessDate)} · {row.purchaseCode}
                      </span>
                      <span className="tabular">
                        {/*
                          * The rate and what it actually cost, together. The gap
                          * between them is the whole reason this feature exists.
                          */}
                        {t('why.rate')} {formatMoney(row.unitCost)} →{' '}
                        <span className="font-semibold text-foreground">{formatMoney(row.landedUnitCost)}</span>
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --- everything that ever moved, who wrote it, and whether anybody counted it --- */}
      <Card className="mt-5">
        <CardHeader title={t('supply.movements')} />
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('supply.movementsEmpty')}</p>
        ) : (
          <>
            {/* Phone: a card each, because six columns in a sideways scroller
                hides the one that matters. */}
            <ul className="space-y-2 lg:hidden">
              {movements.map((m) => (
                <li key={m.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{tMovementKind(m.kind)}</span>
                    <span className={cn('tabular font-semibold', m.quantity < 0 && 'text-danger')}>
                      {signedQty(m.quantity, supply.unit)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDate(m.businessDate)}</span>
                    <Badge tone={m.isEstimated ? 'warning' : 'success'}>
                      {m.isEstimated ? t('supply.estimated') : t('supply.counted2')}
                    </Badge>
                    <span className="tabular">
                      {t('supply.onHandAfter')} {qty(m.onHandAfter, supply.unit)}
                    </span>
                  </div>
                  <MovementSource movement={m} className="mt-1" />
                  {m.note && <p className="mt-1 text-xs">{m.note}</p>}
                </li>
              ))}
            </ul>

            <TableWrap from="lg" minWidth="48rem">
              <thead>
                <tr>
                  <Th>{t('supply.adjustKind')}</Th>
                  <Th>{t('app.date')}</Th>
                  <Th className="text-right">{t('supply.quantity')}</Th>
                  <Th className="text-right">{t('supply.onHandAfter')}</Th>
                  <Th>{t('supply.estimatedHint')}</Th>
                  <Th>{t('expense.note')}</Th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <Tr key={m.id}>
                    <Td>
                      {tMovementKind(m.kind)}
                      <MovementSource movement={m} />
                    </Td>
                    <Td>{formatDate(m.businessDate)}</Td>
                    <Td className={cn('tabular text-right', m.quantity < 0 && 'text-danger')}>
                      {signedQty(m.quantity, supply.unit)}
                    </Td>
                    <Td className="tabular text-right">{qty(m.onHandAfter, supply.unit)}</Td>
                    <Td>
                      <Badge tone={m.isEstimated ? 'warning' : 'success'}>
                        {m.isEstimated ? t('supply.estimated') : t('supply.counted2')}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-muted-foreground">{m.note ?? '—'}</Td>
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
      <AvgCostWhyModal open={why.which === 'avgCost'} onClose={why.close} from={provenance.avgCost} />

      {/* Mounted only while open, so each opening holds its own nonce and its own typing. */}
      {counting && <CountSheet id={id} supply={supply} onClose={() => setCounting(false)} />}
      {adjusting && <AdjustSheet id={id} supply={supply} onClose={() => setAdjusting(false)} />}
      {editing && <SupplySheet supply={supply} onClose={() => setEditing(false)} />}
    </>
  );
}

/**
 * What a movement points back at, and who wrote it: the order a consumption
 * came from, the purchase a receipt came from (and whether that purchase was
 * since cancelled), the person who typed a manual row.
 */
function MovementSource({ movement, className }: { movement: SupplyMovement; className?: string }) {
  const code = movement.refCode ?? null;
  const parts: React.ReactNode[] = [];

  if (movement.refType === 'order' && movement.refId) {
    parts.push(
      <Link
        key="ref"
        href={`/owner/orders/${movement.refId}` as Route}
        className="font-semibold text-primary-ink underline-offset-2 hover:underline"
      >
        {tf('supplies.orderRef', { code: code ?? '' })}
      </Link>
    );
  } else if (movement.refType === 'purchase' && movement.refId) {
    parts.push(
      <Link
        key="ref"
        href={purchaseHref(movement.refId)}
        className="font-semibold text-primary-ink underline-offset-2 hover:underline"
      >
        {tf('supplies.purchaseRef', { code: code ?? '' })}
      </Link>
    );
    if (movement.purchaseCancelled) {
      parts.push(
        <Badge key="cancelled" tone="danger">
          {t('supplies.purchaseCancelled')}
        </Badge>
      );
    }
  }

  if (movement.createdBy?.name) {
    parts.push(<span key="by">{tf('supplies.recordedBy', { name: movement.createdBy.name })}</span>);
  } else if (movement.isEstimated) {
    parts.push(<span key="by">{t('supplies.byRecipe')}</span>);
  }

  if (parts.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground', className)}>
      {parts}
    </div>
  );
}

/** An error pinned above a sheet's buttons. */
function SheetError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
      {message}
    </p>
  );
}

/**
 * গুনে দেখুন — a stock take.
 *
 * Takes the counted total, never a difference: "there are ninety-four" is what
 * somebody with a clipboard knows, and making them work out "six went missing" is
 * asking them to do arithmetic the computer is for.
 *
 * Mounted per opening: the nonce used to be held by a sheet that stayed mounted,
 * so the second count of the day reused the first one's nonce and the server
 * quietly treated it as a retry of the first.
 */
function CountSheet({ id, supply, onClose }: { id: string; supply: SupplyRecord; onClose: () => void }) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  // One per opening, so a double tap or a retry on a bad connection cannot post
  // the same count twice, and the next opening is a new count.
  const [nonce] = useState(() => crypto.randomUUID());
  const [stockTake, state] = useStockTakeSupplyMutation();

  const errors = fieldErrors(state.error);
  const value = counted.trim() === '' ? null : Number(counted);
  const problem = value === null ? t('supplies.quantityRequired') : value < 0 ? t('supplies.notZero') : null;
  const difference = value !== null && value >= 0 ? value - supply.onHand : null;

  const save = async () => {
    setTried(true);
    if (problem || value === null) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    try {
      const result = await stockTake({ id, counted: value, nonce, ...(note.trim() ? { note: note.trim() } : {}) }).unwrap();
      toast(
        result.agreed
          ? t('supply.countedAgreed')
          : tf('supplies.countSaved', { n: qty(value, supply.unit) })
      );
      onClose();
    } catch {
      // Shown above the buttons.
    }
  };

  const countedError = errors.counted ?? (tried ? (problem ?? undefined) : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      dirty={counted.trim() !== '' || note.trim() !== ''}
      title={t('supply.stockTake')}
      footerLead={
        state.isError && !Object.keys(errors).length ? <SheetError message={errorMessage(state.error)} /> : undefined
      }
      footer={
        <>
          <ModalCancel disabled={state.isLoading} />
          <Button loading={state.isLoading} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef}>
        <p className="mb-3 text-sm text-muted-foreground">{t('supply.stockTakeHelp')}</p>

        <div className="mb-4 flex items-baseline justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t('supply.onHand')}</span>
          <span className="tabular font-semibold">{qty(supply.onHand, supply.unit)}</span>
        </div>

        <Field label={t('supply.counted')} htmlFor="count-value" error={countedError} required>
          <Input
            id="count-value"
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            value={counted}
            invalid={Boolean(countedError)}
            onChange={(e) => setCounted(e.target.value)}
            className="tabular"
            trailing={<span className="text-sm text-muted-foreground">{tUnit(supply.unit)}</span>}
          />
        </Field>

        {/*
          * The subtraction, shown as it is typed, so the owner sees what they are
          * about to record before they record it rather than after.
          */}
        {difference !== null && difference !== 0 && (
          <p className="mb-4 text-sm">
            <span className={cn('tabular font-semibold', difference < 0 ? 'text-danger' : 'text-success')}>
              {signedQty(difference, supply.unit)}
            </span>{' '}
            <span className="text-muted-foreground">{t('movement.ADJUSTMENT')}</span>
          </p>
        )}
        {difference === 0 && <p className="mb-4 text-sm text-muted-foreground">{t('supply.countedAgreed')}</p>}

        <Field label={t('expense.note')} htmlFor="count-note" hint={t('app.optional')}>
          <Textarea id="count-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

/*
 * `ADJUSTMENT` is the only kind whose direction the owner chooses; the rest have
 * one obvious direction and the server normalises the sign, so a typed minus on
 * "নষ্ট হয়েছে" cannot accidentally add stock.
 */
const KINDS = ['DAMAGED', 'LOST', 'OPENING', 'RETURN_TO_PAYEE', 'ADJUSTMENT'] as const;
const DOWN_KINDS = new Set(['DAMAGED', 'LOST', 'RETURN_TO_PAYEE']);

/** The manual correction reads "হাতে ঠিক করা" here; a stock take's correction keeps its own name. */
const kindLabel = (kind: string) => (kind === 'ADJUSTMENT' ? t('supplies.adjustManual') : tMovementKind(kind));

/** হাতে হিসাব ঠিক করুন — breakage, a loss, an opening balance, a return. */
function AdjustSheet({ id, supply, onClose }: { id: string; supply: SupplyRecord; onClose: () => void }) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<string>('DAMAGED');
  // Direction is a choice, not a minus sign: most Android number pads have no minus key.
  const [direction, setDirection] = useState<'up' | 'down'>('down');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [nonce] = useState(() => crypto.randomUUID());
  const [adjust, state] = useAdjustSupplyMutation();

  const errors = fieldErrors(state.error);
  const manual = kind === 'ADJUSTMENT';
  const amount = quantity.trim() === '' ? null : Math.abs(Number(quantity));
  const goesDown = manual ? direction === 'down' : DOWN_KINDS.has(kind);
  const signed = amount === null ? null : goesDown ? -amount : amount;
  const after = signed === null ? null : supply.onHand + signed;
  const problem =
    amount === null || Number.isNaN(amount)
      ? t('supplies.quantityRequired')
      : amount === 0
        ? t('supplies.notZero')
        : null;

  const save = async () => {
    setTried(true);
    if (problem || signed === null) {
      requestAnimationFrame(() => focusFirstInvalid(bodyRef.current));
      return;
    }
    try {
      await adjust({ id, kind, quantity: signed, nonce, ...(note.trim() ? { note: note.trim() } : {}) }).unwrap();
      toast(tf('supplies.adjustSaved', { kind: kindLabel(kind), n: qty(after ?? 0, supply.unit) }));
      onClose();
    } catch {
      // Shown above the buttons.
    }
  };

  const quantityError = errors.quantity ?? (tried ? (problem ?? undefined) : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      dirty={quantity.trim() !== '' || note.trim() !== ''}
      title={t('supply.adjust')}
      footerLead={
        state.isError && !Object.keys(errors).length ? <SheetError message={errorMessage(state.error)} /> : undefined
      }
      footer={
        <>
          <ModalCancel disabled={state.isLoading} />
          <Button loading={state.isLoading} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef}>
        <Field label={t('supply.adjustKind')} htmlFor="adjust-kind" error={errors.kind} required>
          <Select id="adjust-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>

        {manual && (
          <div className="mb-4">
            <p className="mb-1.5 text-[0.8125rem] font-semibold">{t('supplies.direction')}</p>
            <Segmented
              label={t('supplies.direction')}
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'up', label: t('supplies.up') },
                { value: 'down', label: t('supplies.down') },
              ]}
            />
          </div>
        )}

        <Field
          label={t('supply.quantity')}
          htmlFor="adjust-quantity"
          error={quantityError}
          hint={manual ? undefined : t('supplies.adjustOneWay')}
          required
        >
          <Input
            id="adjust-quantity"
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            value={quantity}
            invalid={Boolean(quantityError)}
            onChange={(e) => setQuantity(e.target.value)}
            className="tabular"
            trailing={<span className="text-sm text-muted-foreground">{tUnit(supply.unit)}</span>}
          />
        </Field>

        {/* What the shelf will say afterwards, before it is saved. */}
        <div className="mb-4 flex items-baseline justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t('supplies.after')}</span>
          <span className={cn('tabular font-semibold', after !== null && after < 0 && 'text-danger')}>
            {qty(supply.onHand, supply.unit)}
            {after !== null && !problem && ` → ${qty(after, supply.unit)}`}
          </span>
        </div>

        <Field label={t('expense.note')} htmlFor="adjust-note" hint={t('app.optional')}>
          <Textarea id="adjust-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
