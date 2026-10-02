'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { errorMessage, fieldErrors } from '@/lib/api';
import { t, tChargeKind, tf, tUnit } from '@/lib/i18n/bn';
import { businessDate, formatMoney, formatNumber } from '@/lib/format';
import { checkMoney, moneyError } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Payee, Purchase } from '@/lib/types';
import {
  useCreatePayeeMutation,
  useCreatePurchaseMutation,
  useGetPayeesQuery,
} from '@/lib/store/endpoints/cost';
import { useGetSuppliesQuery } from '@/lib/store/endpoints/catalog';
import { Alert } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import {
  Field,
  FormErrorSummary,
  Input,
  MoneyInput,
  Select,
  Textarea,
  focusFirstInvalid,
} from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Modal, ModalCancel } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

const CHARGE_KINDS = ['transport', 'labour', 'loading', 'commission', 'other'] as const;

const LAST_SELLER = 'cm.purchase.lastPayee';
const HINT_SEEN = 'cm.purchase.hintSeen';

/** Device storage can be missing or refuse (a private window); the form works without it. */
function readStore(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A convenience only.
  }
}

/*
 * A stable key per row, so removing the second of three lines does not hand the
 * third one's focus and open note to the row that slid into its place.
 */
let rowSeq = 0;
const rowKey = () => `row-${(rowSeq += 1)}`;

/** One line being typed. Every number is a string: it is an input's value. */
type LineDraft = { key: string; supplyId: string; quantity: string; unitCost: string };

type ChargeDraft = {
  key: string;
  kind: (typeof CHARGE_KINDS)[number];
  amount: string;
  paidTo: 'payee' | 'other';
  payeeName: string;
  allocate: boolean;
  note: string;
};

const blankLine = (): LineDraft => ({ key: rowKey(), supplyId: '', quantity: '', unitCost: '' });

/*
 * A new charge allocates by default and is assumed billed by the seller, which
 * is the common case: the memo from the crate seller already has the van on it.
 */
const blankCharge = (): ChargeDraft => ({
  key: rowKey(),
  kind: 'transport',
  amount: '',
  paidTo: 'payee',
  payeeName: '',
  allocate: true,
  note: '',
});

const num = (raw: string) => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/** A blank charge row is one nobody typed an amount into; it is dropped, not refused. */
const isBlankCharge = (charge: ChargeDraft) => charge.amount.trim() === '';

type Draft = {
  payeeId: string;
  date: string;
  invoiceNo: string;
  note: string;
  basis: 'value' | 'quantity';
  lines: LineDraft[];
  charges: ChargeDraft[];
};

/** What the sheet opens with: a cancelled purchase being written again, or a fresh one. */
function initialDraft(from: Purchase | undefined, lastSeller: string): Draft {
  if (from) {
    return {
      payeeId: from.payee,
      date: from.businessDate,
      invoiceNo: from.invoiceNo ?? '',
      note: from.note ?? '',
      basis: from.allocationBasis,
      lines: from.lines.map((line) => ({
        key: rowKey(),
        supplyId: line.supply,
        quantity: String(line.quantity),
        unitCost: String(line.unitCost),
      })),
      charges: from.charges.map((charge) => ({
        key: rowKey(),
        kind: charge.kind,
        amount: String(charge.amount),
        paidTo: charge.paidTo,
        payeeName: charge.payeeName ?? '',
        allocate: charge.allocate,
        note: charge.note ?? '',
      })),
    };
  }
  return {
    payeeId: lastSeller,
    date: businessDate(),
    invoiceNo: '',
    note: '',
    basis: 'value',
    lines: [blankLine()],
    charges: [],
  };
}

/**
 * Writing down a purchase, usually standing at the orchard gate with a paper
 * memo in one hand.
 *
 * Built for that: the seller used last time is already picked (sellers listed
 * first), a new seller is added right here without leaving the sheet, the add
 * buttons sit under the last line where the thumb already is, and the fields
 * that are rarely filled (the memo number, a note) wait behind "আরও".
 *
 * Save is never greyed out. A charge row left blank is dropped; anything else
 * missing is marked, scrolled to and counted in one line above the buttons.
 *
 * `from` is a cancelled purchase being written again: there is no edit
 * (docs/adr/0024), so a mistake is fixed by cancelling and re-entering, and the
 * re-entry starts from everything that was typed the first time.
 */
export function PurchaseModal({
  from,
  onClose,
}: {
  from?: Purchase;
  onClose: () => void;
}) {
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);

  const supplies = useGetSuppliesQuery();
  const payees = useGetPayeesQuery();
  const [create, createState] = useCreatePurchaseMutation();
  const [createPayee, createPayeeState] = useCreatePayeeMutation();

  const [initial] = useState(() => initialDraft(from, readStore(LAST_SELLER)));
  const [draft, setDraft] = useState<Draft>(initial);
  const [tried, setTried] = useState(false);
  const [moreOpen, setMoreOpen] = useState(Boolean(initial.invoiceNo || initial.note));
  const [noteOpen, setNoteOpen] = useState<string[]>([]);
  const [newSeller, setNewSeller] = useState<string | null>(null);
  // The "no edits, cancel instead" warning is read once, not on every purchase.
  const [showHint] = useState(() => !readStore(HINT_SEEN));

  useEffect(() => {
    if (showHint) writeStore(HINT_SEEN, '1');
  }, [showHint]);

  /*
   * The server numbers charges as they were sent, which is after blank rows
   * were dropped, so `charges.1` may be the third row on screen. The rows sent
   * are remembered by key at submit, so an error still finds its row after
   * the owner adds or removes one; an error for a row since removed is dropped.
   */
  const [sentCharges, setSentCharges] = useState<string[]>([]);
  const errors: Record<string, string> = {};
  Object.entries(fieldErrors(createState.error)).forEach(([key, text]) => {
    const match = /^charges\.(\d+)(\..+)?$/.exec(key);
    if (!match) {
      errors[key] = text;
      return;
    }
    const row = draft.charges.findIndex((charge) => charge.key === sentCharges[Number(match[1])]);
    if (row >= 0) errors[`charges.${row}${match[2] ?? ''}`] = text;
  });
  const serverFieldErrors = Object.keys(errors).length > 0;
  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  const setCharge = (index: number, patch: Partial<ChargeDraft>) =>
    setDraft((prev) => ({
      ...prev,
      charges: prev.charges.map((charge, i) => (i === index ? { ...charge, ...patch } : charge)),
    }));

  const payeeList = payees.data?.payees ?? [];
  // A remembered seller who has since been taken off the list is not picked.
  const payeeKnown = !draft.payeeId || payeeList.some((payee) => payee.id === draft.payeeId) || !payees.isSuccess;
  const payeeId = payeeKnown ? draft.payeeId : '';
  const sellers = payeeList.filter((payee) => payee.kind === 'supplier');
  const others = payeeList.filter((payee) => payee.kind !== 'supplier');
  const supplyList = supplies.data?.supplies ?? [];
  const supplyOf = (id: string) => supplyList.find((supply) => supply.id === id);

  const charges = draft.charges.filter((charge) => !isBlankCharge(charge));

  /*
   * The live arithmetic. Taka floats here, deliberately: this is a preview of a
   * figure the server recomputes in poisha with largest-remainder allocation
   * (docs/adr/0023), and the saved purchase is what gets read back.
   */
  const goodsCost = draft.lines.reduce((sum, line) => sum + num(line.quantity) * num(line.unitCost), 0);
  const totalQuantity = draft.lines.reduce((sum, line) => sum + num(line.quantity), 0);
  const chargeTotal = charges.reduce((sum, charge) => sum + num(charge.amount), 0);
  const payeeCharge = charges
    .filter((charge) => charge.paidTo === 'payee')
    .reduce((sum, charge) => sum + num(charge.amount), 0);
  const allocatable = charges
    .filter((charge) => charge.allocate)
    .reduce((sum, charge) => sum + num(charge.amount), 0);

  /** This line's share of the allocatable charges, per one unit. */
  const landedUnitCost = (line: LineDraft) => {
    const quantity = num(line.quantity);
    if (quantity <= 0) return null;
    const lineCost = quantity * num(line.unitCost);
    const share =
      draft.basis === 'value'
        ? goodsCost > 0
          ? lineCost / goodsCost
          : 0
        : totalQuantity > 0
          ? quantity / totalQuantity
          : 0;
    return num(line.unitCost) + (allocatable * share) / quantity;
  };

  // The split only means something with two lines to split between and a charge to split.
  const showBasis = draft.lines.length >= 2 && allocatable > 0;

  /* --------------------------------------------------------- validation -- */

  const lineProblems = draft.lines.map((line) => ({
    supply: !line.supplyId,
    quantity: !(num(line.quantity) > 0),
    rate: !checkMoney(line.unitCost, { allowZero: true }).ok,
  }));
  const chargeProblems = draft.charges.map(
    (charge) => !isBlankCharge(charge) && !checkMoney(charge.amount, { allowZero: true }).ok
  );
  const missingCount =
    (payeeId ? 0 : 1) +
    lineProblems.reduce((sum, p) => sum + Number(p.supply) + Number(p.quantity) + Number(p.rate), 0) +
    chargeProblems.filter(Boolean).length;

  const save = async () => {
    setTried(true);
    if (missingCount > 0) {
      requestAnimationFrame(() => focusFirstInvalid(root.current));
      return;
    }
    setSentCharges(charges.map((charge) => charge.key));
    try {
      const { purchase } = await create({
        payeeId,
        lines: draft.lines.map((line) => ({
          supplyId: line.supplyId,
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost),
        })),
        ...(charges.length
          ? {
              charges: charges.map((charge) => ({
                kind: charge.kind,
                amount: Number(charge.amount),
                paidTo: charge.paidTo,
                // Only meaningful when somebody other than the seller was paid.
                ...(charge.paidTo === 'other' && charge.payeeName.trim()
                  ? { payeeName: charge.payeeName.trim() }
                  : {}),
                allocate: charge.allocate,
                ...(charge.note.trim() ? { note: charge.note.trim() } : {}),
              })),
            }
          : {}),
        allocationBasis: showBasis ? draft.basis : 'value',
        date: draft.date,
        ...(draft.invoiceNo.trim() ? { invoiceNo: draft.invoiceNo.trim() } : {}),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      }).unwrap();
      writeStore(LAST_SELLER, payeeId);
      toast(tf('purchase.savedToast', { code: purchase.purchaseCode }));
      onClose();
    } catch (failure) {
      /*
       * Field errors land beside their fields. The memo number and note live
       * behind "আরও", so a complaint about either opens it; then the first
       * marked field is brought into view, once the errors have rendered.
       */
      const failed = fieldErrors(failure);
      if (failed.invoiceNo || failed.note) setMoreOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(() => focusFirstInvalid(root.current)));
    }
  };

  const addSeller = async () => {
    const name = (newSeller ?? '').trim();
    if (name.length < 2) return;
    try {
      const { payee } = await createPayee({ nameBn: name, kind: 'supplier' }).unwrap();
      set({ payeeId: payee.id });
      setNewSeller(null);
      toast(tf('purchase.newSellerAdded', { name: payee.nameBn }));
    } catch {
      // Shown under the field.
    }
  };

  const err = (key: string, problem: boolean) => errors[key] ?? (tried && problem ? t('app.required') : undefined);
  const payeeError = err('payeeId', !payeeId);

  /*
   * Every server complaint has a place on the form, except one this form has no
   * field for. Those are said in the summary rather than lost.
   */
  const PLACED = [
    /^(payeeId|date|invoiceNo|note|allocationBasis|lines|charges)$/,
    /^lines\.\d+(\.(supplyId|quantity|unitCost))?$/,
    /^charges\.\d+(\.(kind|amount|paidTo|payeeName|note))?$/,
  ];
  const unplaced = Object.entries(errors)
    .filter(([key]) => !PLACED.some((pattern) => pattern.test(key)))
    .map(([, text]) => text);

  const summary =
    tried && missingCount > 0
      ? tf('app.fieldsMissing', { count: formatNumber(missingCount) })
      : serverFieldErrors
        ? unplaced.length
          ? unplaced.join(' · ')
          : t('app.fixFields')
        : createState.error
          ? errorMessage(createState.error)
          : null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || Boolean(from);

  const payeeOption = (payee: Payee) => (
    <option key={payee.id} value={payee.id}>
      {payee.nameBn}
    </option>
  );

  return (
    <Modal
      open
      wide
      dirty={dirty}
      onClose={onClose}
      title={from ? t('purchase.reenter') : t('purchase.new')}
      footerLead={
        <>
          <FormErrorSummary message={summary} />
          {/*
           * The two totals, apart and above the save button. They differ by
           * whatever was handed to a third party, and showing one of them alone
           * is how a seller's due ends up overstated.
           */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
            <div className="bg-surface px-3 py-1.5">
              <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('purchase.payeeTotal')}</p>
              <p className="tabular text-base font-bold leading-tight sm:text-lg">
                {formatMoney(goodsCost + payeeCharge)}
              </p>
            </div>
            <div className="bg-surface px-3 py-1.5">
              <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('purchase.total')}</p>
              <p className="tabular text-base font-bold leading-tight sm:text-lg">
                {formatMoney(goodsCost + chargeTotal)}
              </p>
            </div>
          </div>
        </>
      }
      footer={
        <>
          <ModalCancel />
          <Button loading={createState.isLoading} onClick={save}>
            {t('app.save')}
          </Button>
        </>
      }
    >
      <div ref={root}>
        {from && (
          <Alert tone="primary">{tf('purchase.reenterNotice', { code: from.purchaseCode })}</Alert>
        )}

        {/* A purchase cannot be edited afterwards, so the first sheet says so up front. */}
        {showHint && !from && <Alert tone="warning">{t('purchase.cancelHelp')}</Alert>}

        {/*
         * Both dropdowns below are fed by other screens, and an empty one is a dead
         * end rather than an error. So the sheet says which list is missing and
         * links straight to it.
         */}
        {supplies.isSuccess && supplyList.length === 0 && (
          <Alert tone="primary" title={t('costSetup.next')}>
            {t('costSetup.emptySupply')}{' '}
            <Link href="/owner/supplies" className="font-semibold underline">
              {t('nav.supplies')}
            </Link>
          </Alert>
        )}

        <div className="grid gap-x-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label={t('purchase.payee')} htmlFor="purchase-payee" error={payeeError} required>
            <Select
              id="purchase-payee"
              value={payeeId}
              aria-invalid={payeeError ? true : undefined}
              onChange={(event) => set({ payeeId: event.target.value })}
            >
              <option value="">{t('purchase.payee')}</option>
              {/* Sellers first: a purchase is almost always from one. */}
              {sellers.length > 0 && others.length > 0 ? (
                <>
                  <optgroup label={t('payeeKind.supplier')}>{sellers.map(payeeOption)}</optgroup>
                  <optgroup label={t('purchase.otherPayees')}>{others.map(payeeOption)}</optgroup>
                </>
              ) : (
                payeeList.map(payeeOption)
              )}
            </Select>
            {newSeller === null ? (
              <button
                type="button"
                onClick={() => setNewSeller('')}
                className="tap mt-1 inline-flex items-center gap-1 rounded-lg px-1 text-sm font-semibold text-primary-ink hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
                {t('purchase.newSeller')}
              </button>
            ) : (
              /*
               * Inline rather than a second sheet: a sheet over a sheet on a phone
               * loses the first one's place, and this needs only a name.
               */
              <div className="mt-2 rounded-xl border border-border bg-muted/40 p-3">
                <label htmlFor="new-seller" className="mb-1.5 block text-[0.8125rem] font-semibold">
                  {t('payee.name')}
                </label>
                <Input
                  id="new-seller"
                  value={newSeller}
                  onChange={(event) => setNewSeller(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addSeller();
                    }
                  }}
                  autoFocus
                />
                {createPayeeState.error && (
                  <p className="mt-1.5 text-xs font-medium text-danger">
                    {fieldErrors(createPayeeState.error).nameBn ?? errorMessage(createPayeeState.error)}
                  </p>
                )}
                <div className="mt-2 flex gap-2 [&>button]:flex-1">
                  <Button size="sm" variant="outline" onClick={() => setNewSeller(null)}>
                    {t('app.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    loading={createPayeeState.isLoading}
                    disabled={newSeller.trim().length < 2}
                    onClick={addSeller}
                  >
                    {t('purchase.newSellerSave')}
                  </Button>
                </div>
              </div>
            )}
          </Field>

          <Field label={t('purchase.date')} htmlFor="purchase-date" error={errors.date}>
            <Input
              id="purchase-date"
              type="date"
              max={businessDate()}
              className="tabular"
              value={draft.date}
              onChange={(event) => set({ date: event.target.value })}
            />
          </Field>
        </div>

        {/* ------------------------------------------------------------ lines -- */}
        <section className="mb-4 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-bold">{t('purchase.lines')}</h3>

          {typeof errors.lines === 'string' && <Alert tone="danger">{errors.lines}</Alert>}

          <ul className="space-y-3">
            {draft.lines.map((line, index) => {
              const supply = supplyOf(line.supplyId);
              const landed = landedUnitCost(line);
              const problems = lineProblems[index];
              const supplyError = err(`lines.${index}.supplyId`, problems.supply);
              const quantityError = err(`lines.${index}.quantity`, problems.quantity);
              const rateError =
                errors[`lines.${index}.unitCost`] ??
                (tried || line.unitCost ? moneyError(line.unitCost, { allowZero: true }) : undefined);
              return (
                <li key={line.key} className="rounded-xl border border-border p-3">
                  {errors[`lines.${index}`] && (
                    <p role="alert" aria-invalid className="mb-2 text-xs font-medium text-danger">
                      {errors[`lines.${index}`]}
                    </p>
                  )}
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {supply ? supply.nameBn : tf('purchase.lineNumber', { n: formatNumber(index + 1) })}
                    </span>
                    {draft.lines.length > 1 && (
                      <button
                        type="button"
                        aria-label={t('purchase.removeLine')}
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
                        }
                        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <Field label={t('purchase.item')} htmlFor={`supply-${index}`} error={supplyError} required>
                    <Select
                      id={`supply-${index}`}
                      value={line.supplyId}
                      aria-invalid={supplyError ? true : undefined}
                      onChange={(event) => setLine(index, { supplyId: event.target.value })}
                    >
                      <option value="">{t('purchase.item')}</option>
                      {supplyList.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.nameBn}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {/* Side by side even on a phone: two short numbers, read together. */}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('purchase.quantity')} htmlFor={`quantity-${index}`} error={quantityError} required>
                      <Input
                        id={`quantity-${index}`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="tabular"
                        value={line.quantity}
                        invalid={Boolean(quantityError)}
                        trailing={
                          supply ? <span className="text-xs text-muted-foreground">{tUnit(supply.unit)}</span> : undefined
                        }
                        onChange={(event) => setLine(index, { quantity: event.target.value })}
                      />
                    </Field>

                    <Field label={t('purchase.rate')} htmlFor={`unitCost-${index}`} error={rateError} required>
                      <MoneyInput
                        id={`unitCost-${index}`}
                        value={line.unitCost}
                        invalid={Boolean(rateError)}
                        onChange={(event) => setLine(index, { unitCost: event.target.value })}
                      />
                    </Field>
                  </div>

                  {/*
                   * The line's own two figures. `landedUnitCost` is a preview of
                   * what the server will store, and it is the whole reason this
                   * form spreads the charges at all.
                   */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted px-3 py-2">
                    <div>
                      <p className="text-[0.6875rem] font-medium text-muted-foreground">{t('purchase.lineCost')}</p>
                      <p className="tabular text-sm font-semibold">
                        {formatMoney(num(line.quantity) * num(line.unitCost))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[0.6875rem] font-medium text-muted-foreground">
                        {t('purchase.landedUnitCost')}
                      </p>
                      <p className="tabular text-sm font-bold text-primary-ink">
                        {landed == null ? '—' : formatMoney(landed)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Under the last line, where the thumb already is. */}
          <Button
            variant="outline"
            full
            className="mt-3"
            disabled={draft.lines.length >= 30}
            onClick={() => setDraft((prev) => ({ ...prev, lines: [...prev.lines, blankLine()] }))}
          >
            <Plus className="h-4 w-4" />
            {t('purchase.addLine')}
          </Button>
        </section>

        {/* ---------------------------------------------------------- charges -- */}
        <section className="mb-4 border-t border-border pt-4">
          <h3 className="mb-1 text-sm font-bold">{t('purchase.charges')}</h3>
          <p className="mb-3 text-xs text-muted-foreground">{t('purchase.landedHint')}</p>

          {typeof errors.charges === 'string' && <Alert tone="danger">{errors.charges}</Alert>}

          {draft.charges.length > 0 && (
            <ul className="mb-3 space-y-3">
              {draft.charges.map((charge, index) => {
                const amountError =
                  errors[`charges.${index}.amount`] ??
                  (tried || charge.amount ? moneyError(charge.amount, { allowZero: true }) : undefined);
                const noteError = errors[`charges.${index}.note`];
                const noteShown = noteOpen.includes(charge.key) || Boolean(charge.note) || Boolean(noteError);
                return (
                  <li key={charge.key} className="rounded-xl border border-border p-3">
                    {errors[`charges.${index}`] && (
                      <p role="alert" aria-invalid className="mb-2 text-xs font-medium text-danger">
                        {errors[`charges.${index}`]}
                      </p>
                    )}
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{tChargeKind(charge.kind)}</span>
                      <button
                        type="button"
                        aria-label={t('purchase.removeCharge')}
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, charges: prev.charges.filter((_, i) => i !== index) }))
                        }
                        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('purchase.chargeKind')} htmlFor={`chargeKind-${index}`} error={errors[`charges.${index}.kind`]}>
                        <Select
                          id={`chargeKind-${index}`}
                          value={charge.kind}
                          onChange={(event) => setCharge(index, { kind: event.target.value as ChargeDraft['kind'] })}
                        >
                          {CHARGE_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {tChargeKind(kind)}
                            </option>
                          ))}
                        </Select>
                      </Field>

                      <Field label={t('purchase.chargeAmount')} htmlFor={`chargeAmount-${index}`} error={amountError}>
                        <MoneyInput
                          id={`chargeAmount-${index}`}
                          value={charge.amount}
                          invalid={Boolean(amountError)}
                          onChange={(event) => setCharge(index, { amount: event.target.value })}
                        />
                      </Field>
                    </div>

                    {/*
                     * Who is owed, which is a different question from whether the
                     * charge raises the shelf price. See docs/adr/0023.
                     */}
                    <Field
                      label={t('purchase.paidTo')}
                      htmlFor={`paidTo-${index}`}
                      hint={t('purchase.paidToHint')}
                      error={errors[`charges.${index}.paidTo`]}
                    >
                      <Select
                        id={`paidTo-${index}`}
                        value={charge.paidTo}
                        onChange={(event) => setCharge(index, { paidTo: event.target.value as ChargeDraft['paidTo'] })}
                      >
                        <option value="payee">{t('purchase.paidToPayee')}</option>
                        <option value="other">{t('purchase.paidToOther')}</option>
                      </Select>
                    </Field>

                    {charge.paidTo === 'other' && (
                      <Field
                        label={t('purchase.chargePaidToOtherName')}
                        htmlFor={`payeeName-${index}`}
                        error={errors[`charges.${index}.payeeName`]}
                      >
                        <Input
                          id={`payeeName-${index}`}
                          value={charge.payeeName}
                          onChange={(event) => setCharge(index, { payeeName: event.target.value })}
                        />
                      </Field>
                    )}

                    <Switch
                      checked={charge.allocate}
                      onChange={(checked) => setCharge(index, { allocate: checked })}
                      label={t('purchase.allocate')}
                      hint={t('purchase.allocateHint')}
                    />

                    {noteShown ? (
                      <Field
                        className="mb-0 mt-2"
                        label={t('app.notes')}
                        htmlFor={`chargeNote-${index}`}
                        hint={t('app.optional')}
                        error={noteError}
                      >
                        <Input
                          id={`chargeNote-${index}`}
                          invalid={Boolean(noteError)}
                          value={charge.note}
                          onChange={(event) => setCharge(index, { note: event.target.value })}
                        />
                      </Field>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setNoteOpen((prev) => [...prev, charge.key])}
                        className="tap inline-flex items-center gap-1 rounded-lg px-1 text-sm font-medium text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('purchase.addNote')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <Button
            variant="outline"
            full
            disabled={draft.charges.length >= 10}
            onClick={() => setDraft((prev) => ({ ...prev, charges: [...prev.charges, blankCharge()] }))}
          >
            <Plus className="h-4 w-4" />
            {t('purchase.addCharge')}
          </Button>

          {showBasis && (
            <Field className="mt-4" label={t('purchase.basis')} htmlFor="purchase-basis" error={errors.allocationBasis}>
              <Select
                id="purchase-basis"
                value={draft.basis}
                onChange={(event) => set({ basis: event.target.value as Draft['basis'] })}
              >
                <option value="value">{t('purchase.basisValue')}</option>
                <option value="quantity">{t('purchase.basisQuantity')}</option>
              </Select>
            </Field>
          )}
        </section>

        {/* ------------------------------------------------- rarely needed -- */}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="tap mb-2 flex w-full items-center justify-between rounded-lg border-t border-border pt-2 text-left text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          {moreOpen ? t('purchase.lessFields') : t('purchase.moreFields')}
          <ChevronDown className={cn('h-4 w-4 transition-transform', moreOpen && 'rotate-180')} />
        </button>

        {moreOpen && (
          <>
            <Field label={t('purchase.invoiceNo')} htmlFor="purchase-invoice" hint={t('app.optional')} error={errors.invoiceNo}>
              <Input
                id="purchase-invoice"
                value={draft.invoiceNo}
                onChange={(event) => set({ invoiceNo: event.target.value })}
              />
            </Field>

            <Field label={t('app.notes')} htmlFor="purchase-note" hint={t('app.optional')} error={errors.note}>
              <Textarea
                id="purchase-note"
                rows={2}
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
