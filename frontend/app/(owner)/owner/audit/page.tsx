'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ChevronDown, ChevronRight, History, ScrollText, SlidersHorizontal, X } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useGetAuditInfiniteQuery, type AuditArgs } from '@/lib/store/endpoints/audit';
import { useGetResellersInfiniteQuery } from '@/lib/store/endpoints/people';
import { useUrlState } from '@/lib/use-url-state';
import {
  bn,
  t,
  tf,
  tMovementKind,
  tPaidFrom,
  tPayeeKind,
  tPayeeLedgerKind,
  tRequestStatus,
  tMaybe,
  tStatus,
  tUnit,
  type DictKey,
} from '@/lib/i18n/bn';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import type { AuditEntry, ResellerSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { SearchInput } from '@/components/ui/toolbar';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';

/*
 * Action families, filtered by prefix (`order.*`). The API matches a trailing
 * `*` as a prefix, so one choice here covers every action of that kind,
 * including ones added after this list was written.
 */
const ACTION_GROUPS: { value: string; labelKey: DictKey }[] = [
  { value: 'order.*', labelKey: 'audit.group.order' },
  { value: 'complaint.*', labelKey: 'audit.group.complaint' },
  { value: 'reseller.*', labelKey: 'audit.group.reseller' },
  { value: 'kyc.*', labelKey: 'audit.group.kyc' },
  { value: 'deposit.*', labelKey: 'audit.group.deposit' },
  { value: 'withdrawal.*', labelKey: 'audit.group.withdrawal' },
  { value: 'ledger.*', labelKey: 'audit.group.ledger' },
  { value: 'product.*', labelKey: 'audit.group.product' },
  { value: 'supply.*', labelKey: 'audit.group.supply' },
  { value: 'purchase.*', labelKey: 'audit.group.purchase' },
  { value: 'payee.*', labelKey: 'audit.group.payee' },
  { value: 'expense.*', labelKey: 'audit.group.expense' },
  { value: 'expenseCategory.*', labelKey: 'audit.group.expenseCategory' },
  { value: 'source.*', labelKey: 'audit.group.source' },
  { value: 'zone.*', labelKey: 'audit.group.zone' },
  { value: 'landing.*', labelKey: 'audit.group.landing' },
  { value: 'settings.*', labelKey: 'audit.group.settings' },
  { value: 'outbox.*', labelKey: 'audit.group.outbox' },
  { value: 'user.*', labelKey: 'audit.group.user' },
  { value: 'device.*', labelKey: 'audit.group.device' },
];

const TARGET_TYPES: { value: string; labelKey: DictKey }[] = [
  { value: 'Order', labelKey: 'audit.target.Order' },
  { value: 'Complaint', labelKey: 'audit.target.Complaint' },
  { value: 'ResellerProfile', labelKey: 'audit.target.ResellerProfile' },
  { value: 'User', labelKey: 'audit.target.User' },
  { value: 'KycSubmission', labelKey: 'audit.target.KycSubmission' },
  { value: 'Deposit', labelKey: 'audit.target.Deposit' },
  { value: 'Withdrawal', labelKey: 'audit.target.Withdrawal' },
  { value: 'Product', labelKey: 'audit.target.Product' },
  { value: 'ResellerProduct', labelKey: 'audit.target.ResellerProduct' },
  { value: 'Supply', labelKey: 'audit.target.Supply' },
  { value: 'Purchase', labelKey: 'audit.target.Purchase' },
  { value: 'Payee', labelKey: 'audit.target.Payee' },
  { value: 'Expense', labelKey: 'audit.target.Expense' },
  { value: 'ExpenseCategory', labelKey: 'audit.target.ExpenseCategory' },
  { value: 'Source', labelKey: 'audit.target.Source' },
  { value: 'DeliveryZone', labelKey: 'audit.target.DeliveryZone' },
  { value: 'LandingContent', labelKey: 'audit.target.LandingContent' },
  { value: 'Setting', labelKey: 'audit.target.Setting' },
  { value: 'OutboxMessage', labelKey: 'audit.target.OutboxMessage' },
  { value: 'TrustedDevice', labelKey: 'audit.target.TrustedDevice' },
];

/**
 * Where a target lives. A record with its own page opens it; the rest open the
 * list they belong to, which is where the owner would go to look anyway.
 */
const TARGET_HREF: Record<string, (id: string) => string | null> = {
  Order: (id) => `/owner/orders/${id}`,
  ResellerProfile: (id) => `/owner/resellers/${id}`,
  Payee: (id) => `/owner/payees/${id}`,
  Supply: (id) => `/owner/supplies/${id}`,
  Source: (id) => `/owner/sources/${id}`,
  Product: () => '/owner/products',
  Purchase: () => '/owner/purchases',
  Expense: () => '/owner/expenses',
  ExpenseCategory: () => '/owner/expenses',
  Complaint: () => '/owner/complaints',
  Deposit: () => '/owner/finance?tab=deposits',
  Withdrawal: () => '/owner/finance?tab=withdrawals',
  KycSubmission: () => '/owner/kyc',
  DeliveryZone: () => '/owner/zones',
  Setting: () => '/owner/settings',
  LandingContent: () => '/owner/landing',
  OutboxMessage: () => '/owner/notifications/failed',
  TrustedDevice: () => '/owner/account',
};

const hrefOf = (entry: AuditEntry): Route | null => {
  if (!entry.targetId) return null;
  const href = TARGET_HREF[entry.targetType]?.(entry.targetId);
  return href ? (href as Route) : null;
};

const known = (key: string): key is DictKey => key in bn;

/** An action as a person reads it: its own name, or at least its family's. */
function actionLabel(action: string): string {
  const key = `audit.action.${action}`;
  if (known(key)) return t(key);
  const group = ACTION_GROUPS.find((g) => action.startsWith(g.value.slice(0, -1)));
  return group ? t(group.labelKey) : action;
}

function targetTypeLabel(type: string): string {
  const match = TARGET_TYPES.find((target) => target.value === type);
  return match ? t(match.labelKey) : type;
}

/**
 * A recorded field's name. Settings record dotted paths
 * (`features.telegram`, `customerSmsTemplates.ship`), so the whole path is
 * tried, then its parts joined.
 */
function fieldLabel(key: string): string {
  const whole = `audit.field.${key}`;
  if (known(whole)) return t(whole);
  const parts = key.split('.');
  if (parts.length > 1) return parts.map(fieldLabel).join(' · ');
  return key;
}

type Filters = {
  action: string;
  targetType: string;
  targetId: string;
  actor: string;
  from: string;
  to: string;
};

const DEFAULTS: Filters = { action: '', targetType: '', targetId: '', actor: '', from: '', to: '' };

/**
 * Who changed what, newest first.
 *
 * Read when something needs explaining: a credit limit that moved, a deposit
 * nobody remembers approving, an order whose address is not the one the
 * customer gave. So the page leads with the filters that answer those
 * questions, each row names its record in words and opens it, and each row
 * unfolds to show only what changed, in Bengali, not two snapshots of English
 * field names to compare by eye.
 *
 * The filters live in the URL, so a link from a record's page can open its
 * history (`?targetId=…`) and Back from a record returns to the same view. On a
 * phone they sit behind one "ফিল্টার (n)" button rather than five boxes above
 * the first row.
 *
 * Paged by cursor, because the log only grows and page numbers over a growing
 * list skip and repeat rows.
 */
export default function OwnerAuditPage() {
  const { data: session } = useSession();
  const [filters, setFilters, { reset, activeCount }] = useUrlState(DEFAULTS);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The whole list, once, for the actor picker; searched on the device.
  const resellers = useGetResellersInfiniteQuery({}, { refetchOnMountOrArgChange: 300 });
  const resellerRows = resellers.data?.pages.flatMap((page) => page.resellers) ?? [];

  // A range entered backwards is swapped rather than answered with nothing.
  const [from, to] =
    filters.from && filters.to && filters.from > filters.to
      ? [filters.to, filters.from]
      : [filters.from, filters.to];

  const args: AuditArgs = {
    action: filters.action,
    targetType: filters.targetType,
    targetId: filters.targetId,
    actor: filters.actor,
    from,
    to,
  };
  const audit = useGetAuditInfiniteQuery(args);

  const entries = audit.data?.pages.flatMap((page) => page.entries) ?? [];
  const count = activeCount();
  const filtered = count > 0;

  // The one record whose history is open, named by whatever its entries call it.
  const focused = filters.targetId
    ? (entries.find((entry) => entry.targetLabel)?.targetLabel ??
      (filters.targetType ? targetTypeLabel(filters.targetType) : t('audit.record')))
    : null;

  // Drawn in two places (the card and the phone's sheet), so each copy gets its own ids.
  const fields = (where: string) => (
    <FilterFields
      idPrefix={where}
      filters={filters}
      setFilters={setFilters}
      resellers={resellerRows}
      meId={session?.user._id}
    />
  );

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      {/* A phone gets one button and a sheet; anything wider gets the boxes. */}
      <div className="mb-3 flex items-center gap-2 sm:hidden">
        <Button variant="outline" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" />
          {count > 0 ? tf('audit.filterButton', { count: formatNumber(count) }) : t('app.filters')}
        </Button>
        {filtered && (
          <Button variant="quiet" onClick={reset}>
            {t('app.clearFilters')}
          </Button>
        )}
      </div>

      <Card className="mb-4 hidden sm:block">
        {fields('audit')}
        {filtered && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="quiet" onClick={reset}>
              {t('app.clearFilters')}
            </Button>
          </div>
        )}
      </Card>

      {sheetOpen && (
        <Modal
          open
          onClose={() => setSheetOpen(false)}
          title={t('audit.filterTitle')}
          footer={
            <>
              {filtered && (
                <Button variant="outline" onClick={reset}>
                  {t('app.clearFilters')}
                </Button>
              )}
              <Button onClick={() => setSheetOpen(false)}>{t('audit.apply')}</Button>
            </>
          }
        >
          {fields('audit-sheet')}
        </Modal>
      )}

      {focused && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-primary-softer px-3 py-2 text-sm text-primary-ink">
          <History aria-hidden className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {t('audit.targetFilter')}: <span className="font-semibold">{focused}</span>
          </span>
          <button
            type="button"
            onClick={() => setFilters({ targetId: '', targetType: '' })}
            className="tap inline-flex items-center gap-1 rounded-lg px-2 font-semibold hover:bg-primary-soft"
          >
            <X aria-hidden className="h-4 w-4" />
            {t('audit.targetFilterClear')}
          </button>
        </div>
      )}

      {audit.isLoading && <ListSkeleton rows={6} />}

      {audit.isError && !audit.data && (
        <ErrorState onRetry={() => audit.refetch()} isRetrying={audit.isFetching} error={audit.error} />
      )}

      {audit.isSuccess && entries.length === 0 &&
        (filtered ? (
          <FilteredEmpty onClear={reset} description={t('audit.emptyFiltered')} />
        ) : (
          <EmptyState icon={ScrollText} title={t('audit.empty')} />
        ))}

      {entries.length > 0 && (
        // The old rows stay while a new filter loads, dimmed, so a tap never blanks the page.
        <div className={cn('transition-opacity', audit.isFetching && !audit.isFetchingNextPage && 'opacity-60')}>
          <ul className="grid gap-3 lg:hidden">
            {entries.map((entry) => (
              <li key={entry.id}>
                <AuditCard entry={entry} onHistory={() => setFilters({ targetId: entry.targetId ?? '', targetType: entry.targetType })} />
              </li>
            ))}
          </ul>

          <TableWrap from="lg" minWidth="56rem">
            <thead>
              <tr>
                <Th>{t('app.date')}</Th>
                <Th>{t('audit.action')}</Th>
                <Th>{t('audit.actor')}</Th>
                <Th>{t('audit.target')}</Th>
                <Th className="w-32 text-right">{t('audit.changes')}</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </TableWrap>

          <LoadMore
            hasMore={Boolean(audit.hasNextPage)}
            loading={audit.isFetchingNextPage}
            onLoadMore={() => audit.fetchNextPage()}
            error={audit.isFetchNextPageError ? audit.error : null}
          />
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- filters -- */

function FilterFields({
  idPrefix,
  filters,
  setFilters,
  resellers,
  meId,
}: {
  idPrefix: string;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  resellers: ResellerSummary[];
  meId?: string;
}) {
  const set = (key: keyof Filters) => (event: { target: { value: string } }) =>
    setFilters({ [key]: event.target.value });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t('audit.action')} htmlFor={`${idPrefix}-action`} className="mb-0">
        <Select id={`${idPrefix}-action`} value={filters.action} onChange={set('action')}>
          <option value="">{t('app.all')}</option>
          {ACTION_GROUPS.map((group) => (
            <option key={group.value} value={group.value}>
              {t(group.labelKey)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('audit.target')} htmlFor={`${idPrefix}-target`} className="mb-0">
        <Select
          id={`${idPrefix}-target`}
          value={filters.targetType}
          // A different kind of record cannot keep one record's id.
          onChange={(event) => setFilters({ targetType: event.target.value, targetId: '' })}
        >
          <option value="">{t('app.all')}</option>
          {TARGET_TYPES.map((target) => (
            <option key={target.value} value={target.value}>
              {t(target.labelKey)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('reports.from')} htmlFor={`${idPrefix}-from`} className="mb-0">
        <Input id={`${idPrefix}-from`} type="date" value={filters.from} onChange={set('from')} />
      </Field>

      <Field label={t('reports.to')} htmlFor={`${idPrefix}-to`} className="mb-0">
        <Input id={`${idPrefix}-to`} type="date" value={filters.to} onChange={set('to')} />
      </Field>

      <div className="sm:col-span-2 lg:col-span-4">
        <ActorPicker
          value={filters.actor}
          onChange={(actor) => setFilters({ actor })}
          resellers={resellers}
          meId={meId}
        />
      </div>
    </div>
  );
}

/**
 * Who did it, found by typing. A select of every shop was a list of a hundred
 * names to scroll on a phone; this searches shop, person and phone as the owner
 * types, with "me" and "the system" one tap away.
 */
function ActorPicker({
  value,
  onChange,
  resellers,
  meId,
}: {
  value: string;
  onChange: (actor: string) => void;
  resellers: ResellerSummary[];
  meId?: string;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const digits = term.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g, '');

  const matches = term
    ? resellers
        .filter((reseller) => reseller.user?._id)
        .filter(
          (reseller) =>
            reseller.shopName.toLowerCase().includes(term) ||
            reseller.user.name?.toLowerCase().includes(term) ||
            (digits.length >= 3 && reseller.user.phoneE164?.includes(digits))
        )
        .slice(0, 8)
    : [];

  const selected =
    value === ''
      ? t('audit.actorAll')
      : value === 'system'
        ? t('audit.actorSystem')
        : value === meId
          ? t('audit.actorMe')
          : (resellers.find((reseller) => reseller.user?._id === value)?.shopName ?? t('audit.actor'));

  const chip = (actor: string, label: string) => (
    <button
      type="button"
      onClick={() => onChange(actor)}
      aria-pressed={value === actor}
      className={cn(
        'min-h-11 rounded-full border px-3 text-sm transition-colors sm:min-h-9',
        value === actor
          ? 'border-primary bg-primary-softer font-semibold text-primary-ink'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {label}
    </button>
  );

  return (
    <fieldset>
      <legend className="mb-1.5 block text-[0.8125rem] font-semibold">
        {t('audit.actor')}: <span className="font-normal text-muted-foreground">{selected}</span>
      </legend>
      <div className="mb-2 flex flex-wrap gap-2">
        {chip('', t('audit.actorAll'))}
        {meId && chip(meId, t('audit.actorMe'))}
        {chip('system', t('audit.actorSystem'))}
      </div>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t('audit.actorSearch')}
        className="sm:max-w-sm"
      />
      {term && (
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border sm:max-w-sm">
          {matches.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">{t('audit.actorNone')}</li>
          )}
          {matches.map((reseller) => (
            <li key={reseller.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(reseller.user._id);
                  setQuery('');
                }}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-muted"
              >
                <span className="min-w-0 truncate font-medium">{reseller.shopName}</span>
                <span className="shrink-0 truncate text-xs text-muted-foreground">{reseller.user.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ rows -- */

function ActorName({ entry }: { entry: AuditEntry }) {
  if (!entry.actor) return <span className="text-muted-foreground">{t('audit.system')}</span>;
  return (
    <span>
      {entry.actor.name}
      <span className="text-muted-foreground">
        {' · '}
        {t(entry.actor.role === 'owner' ? 'role.owner' : 'role.reseller')}
      </span>
    </span>
  );
}

/** The record, by name, linked to where it lives. */
function TargetName({ entry, className }: { entry: AuditEntry; className?: string }) {
  const href = hrefOf(entry);
  const name = entry.targetLabel ?? targetTypeLabel(entry.targetType);
  if (!href) return <span className={className}>{name}</span>;
  return (
    <Link
      href={href}
      className={cn('inline-flex min-h-11 items-center gap-0.5 font-medium text-primary-ink hover:underline lg:min-h-0', className)}
    >
      {name}
      <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
    </Link>
  );
}

function AuditCard({ entry, onHistory }: { entry: AuditEntry; onHistory: () => void }) {
  const [open, setOpen] = useState(false);
  const changes = diff(entry);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{actionLabel(entry.action)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(entry.at)}</p>
        </div>
        <Badge tone="neutral">{targetTypeLabel(entry.targetType)}</Badge>
      </div>

      <p className="mt-2 text-sm">
        <ActorName entry={entry} />
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
        <TargetName entry={entry} />
        {entry.targetId && (
          <button
            type="button"
            onClick={onHistory}
            className="tap inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <History aria-hidden className="h-3.5 w-3.5" />
            {t('audit.targetFilter')}
          </button>
        )}
      </div>

      {changes.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="tap mt-2 flex w-full items-center justify-between rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
          >
            {t('audit.showChanges').replace('{n}', formatNumber(changes.length))}
            <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && <ChangeList entry={entry} changes={changes} className="mt-3" />}
        </>
      )}
    </Card>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const changes = diff(entry);

  return (
    <Fragment>
      <Tr>
        <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(entry.at)}</Td>
        <Td className="font-medium">{actionLabel(entry.action)}</Td>
        <Td className="text-sm">
          <ActorName entry={entry} />
        </Td>
        <Td>
          <div className="text-xs text-muted-foreground">{targetTypeLabel(entry.targetType)}</div>
          <TargetName entry={entry} className="text-sm" />
        </Td>
        <Td className="text-right">
          {changes.length > 0 ? (
            <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {formatNumber(changes.length)}
              <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </Td>
      </Tr>
      {open && (
        <tr>
          <td colSpan={5} className="border-b border-border bg-muted/40 px-5 py-3">
            <ChangeList entry={entry} changes={changes} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ diff -- */

type Change = { key: string; before: unknown; after: unknown };

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** An id or nothing: a value that means nothing to the person reading. */
const opaque = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && OBJECT_ID.test(value));

/**
 * The keys whose value differs between `before` and `after`, in the order they
 * first appear. A key present on one side only is a change too: an `after`
 * with nothing before it is what a creation looks like. A change from one id
 * to another is left out; the record's name is already on the row.
 */
function diff(entry: AuditEntry): Change[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .filter((key) => !(opaque(before[key]) && opaque(after[key])))
    .map((key) => ({ key, before: before[key], after: after[key] }));
}

/** A status as the record it belongs to names it. */
function statusLabel(targetType: string, value: string): string {
  if (targetType === 'Deposit' || targetType === 'Withdrawal' || targetType === 'KycSubmission') {
    return tRequestStatus(value);
  }
  if (targetType === 'Purchase' && value === 'received') return t('purchase.received');
  if (targetType === 'OutboxMessage') {
    if (value === 'dead') return t('failed.channelFailed');
    if (value === 'sent') return t('failed.channelSent');
    if (value === 'pending') return t('failed.channelPending');
    if (value === 'dismissed') return t('failed.dismissed');
  }
  return tStatus(value);
}

/** A kind, from whichever vocabulary knows it. */
function kindLabel(value: string): string {
  for (const translate of [tPayeeKind, tPayeeLedgerKind, tMovementKind]) {
    const label = translate(value);
    if (label !== value) return label;
  }
  return value;
}

/**
 * A stored value, readable. Money kept in poisha is shown in taka, quantities
 * kept in thousandths as the number, statuses and kinds in Bengali, times in
 * Dhaka, and anything nested as its own short list instead of raw JSON.
 */
function formatValue(entry: AuditEntry, key: string, value: unknown): React.ReactNode {
  const leaf = key.split('.').pop() ?? key;
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? t('audit.yes') : t('audit.no');
  if (typeof value === 'number') {
    if (/Poisha$/.test(leaf)) return formatMoney(value / 100);
    if (/Milli$/.test(leaf)) return formatNumber(value / 1000);
    return formatNumber(value);
  }
  if (typeof value === 'string') {
    if (leaf === 'status') return statusLabel(entry.targetType, value);
    if (leaf === 'kind') return kindLabel(value);
    if (leaf === 'paidFrom') return tPaidFrom(value);
    if (leaf === 'unit') return tUnit(value);
    // A picture is stored as an id or an address, neither of which says anything on screen.
    if (/(cover|image|logo|url)$/i.test(leaf)) return t('audit.imageSet');
    if (leaf === 'role') return value === 'owner' ? t('role.owner') : value === 'reseller' ? t('role.reseller') : value;
    if (leaf === 'scope') return value === 'order' ? t('expense.scopeOrder') : value === 'period' ? t('expense.scopeGeneral') : value;
    if (leaf === 'paymentStatus') return value === 'paid' ? t('expense.paid') : value === 'unpaid' ? t('expense.unpaid') : value;
    if (/^phone/i.test(leaf)) return value.replace(/^\+880/, '0');
    if (ISO_TIME.test(value)) return formatDateTime(value);
    if (DATE_ONLY.test(value)) return formatDate(value);
    if (OBJECT_ID.test(value)) return '—';
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      // Field names (a landing edit) and channel names read as words.
      return value
        .map((item) => {
          const text = String(item);
          if (leaf === 'fields') return fieldLabel(text);
          // The outbox names push `web_push`; the screens call it ফোনে.
          if (leaf === 'channels') return tMaybe(`prefs.channel.${text === 'web_push' ? 'push' : text}`, text);
          return formatValue(entry, leaf, item);
        })
        .join(', ');
    }
    return (
      <ol className="mt-0.5 space-y-1">
        {value.map((item, index) => (
          <li key={index} className="rounded-md bg-muted/60 px-2 py-1">
            {formatValue(entry, leaf, item)}
          </li>
        ))}
      </ol>
    );
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).filter(([, inner]) => !opaque(inner));
    if (parts.length === 0) return '—';
    return (
      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
        {parts.map(([innerKey, inner]) => (
          <span key={innerKey}>
            <span className="text-muted-foreground">{fieldLabel(innerKey)}:</span>{' '}
            {formatValue(entry, innerKey, inner)}
          </span>
        ))}
      </span>
    );
  }
  return String(value);
}

function ChangeList({
  entry,
  changes,
  className,
}: {
  entry: AuditEntry;
  changes: Change[];
  className?: string;
}) {
  return (
    <dl className={cn('space-y-2 text-sm', className)}>
      {changes.map((change) => (
        <div key={change.key} className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{fieldLabel(change.key)}</dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 break-words">
            {change.before !== undefined && (
              <>
                <span className="sr-only">{t('app.before')}:</span>
                <span className="text-danger line-through decoration-danger/50">
                  {formatValue(entry, change.key, change.before)}
                </span>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              </>
            )}
            <span className="sr-only">{t('app.after')}:</span>
            <span className="font-medium text-success-ink">
              {formatValue(entry, change.key, change.after)}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
