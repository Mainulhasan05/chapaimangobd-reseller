'use client';

import { Fragment, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { bn, t, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { AuditEntry, CursorPaged, ResellerSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LoadMore } from '@/components/ui/load-more';

const PAGE_SIZE = 30;

/*
 * Action families, filtered by prefix (`order.*`). The API matches a trailing
 * `*` as a prefix, so one choice here covers every action of that kind,
 * including ones added after this list was written.
 */
const ACTION_GROUPS: { value: string; labelKey: DictKey }[] = [
  { value: 'order.*', labelKey: 'audit.group.order' },
  { value: 'reseller.*', labelKey: 'audit.group.reseller' },
  { value: 'kyc.*', labelKey: 'audit.group.kyc' },
  { value: 'deposit.*', labelKey: 'audit.group.deposit' },
  { value: 'withdrawal.*', labelKey: 'audit.group.withdrawal' },
  { value: 'ledger.*', labelKey: 'audit.group.ledger' },
  { value: 'product.*', labelKey: 'audit.group.product' },
  { value: 'source.*', labelKey: 'audit.group.source' },
  { value: 'zone.*', labelKey: 'audit.group.zone' },
  { value: 'settings.*', labelKey: 'audit.group.settings' },
  { value: 'user.*', labelKey: 'audit.group.user' },
];

const TARGET_TYPES: { value: string; labelKey: DictKey }[] = [
  { value: 'Order', labelKey: 'audit.target.Order' },
  { value: 'ResellerProfile', labelKey: 'audit.target.ResellerProfile' },
  { value: 'User', labelKey: 'audit.target.User' },
  { value: 'KycSubmission', labelKey: 'audit.target.KycSubmission' },
  { value: 'Deposit', labelKey: 'audit.target.Deposit' },
  { value: 'Withdrawal', labelKey: 'audit.target.Withdrawal' },
  { value: 'Product', labelKey: 'audit.target.Product' },
  { value: 'ResellerProduct', labelKey: 'audit.target.ResellerProduct' },
  { value: 'Source', labelKey: 'audit.target.Source' },
  { value: 'DeliveryZone', labelKey: 'audit.target.DeliveryZone' },
  { value: 'Setting', labelKey: 'audit.target.Setting' },
];

/** An action as a person reads it. Unknown actions show as they are stored. */
function actionLabel(action: string): string {
  const key = `audit.action.${action}`;
  if (key in bn) return t(key as DictKey);
  const group = ACTION_GROUPS.find((g) => action.startsWith(g.value.slice(0, -1)));
  return group ? `${t(group.labelKey)} · ${action}` : action;
}

function targetLabel(type: string): string {
  const match = TARGET_TYPES.find((target) => target.value === type);
  return match ? t(match.labelKey) : type;
}

type Filters = { action: string; targetType: string; actor: string; from: string; to: string };

const EMPTY: Filters = { action: '', targetType: '', actor: '', from: '', to: '' };

/**
 * Who changed what, newest first.
 *
 * Read when something needs explaining: a credit limit that moved, a deposit
 * nobody remembers approving, an order whose address is not the one the
 * customer gave. So the page leads with the filters that answer those
 * questions, and each row opens to show only what changed, not two full
 * snapshots to compare by eye.
 *
 * Paged by cursor, because the log only grows and page numbers over a growing
 * list skip and repeat rows.
 */
export default function OwnerAuditPage() {
  const { data: session } = useSession();
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const resellers = useQuery({
    queryKey: ['owner', 'resellers', 'all-for-audit'],
    queryFn: () => api.get<{ resellers: ResellerSummary[] }>('/owner/resellers'),
    staleTime: 5 * 60_000,
  });

  // A range entered backwards is swapped rather than answered with nothing.
  const [from, to] =
    filters.from && filters.to && filters.from > filters.to
      ? [filters.to, filters.from]
      : [filters.from, filters.to];

  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  if (filters.action) params.set('action', filters.action);
  if (filters.targetType) params.set('targetType', filters.targetType);
  if (filters.actor) params.set('actor', filters.actor);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();

  const audit = useInfiniteQuery({
    queryKey: ['owner', 'audit', query],
    queryFn: ({ pageParam }) =>
      api.get<CursorPaged<'entries', AuditEntry>>(
        `/owner/audit?${query}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const entries = audit.data?.pages.flatMap((page) => page.entries) ?? [];
  const filtered = Object.values(filters).some(Boolean);

  const set = (key: keyof Filters) => (event: { target: { value: string } }) =>
    setFilters((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={t('audit.action')} htmlFor="audit-action" className="mb-0">
            <Select id="audit-action" value={filters.action} onChange={set('action')}>
              <option value="">{t('app.all')}</option>
              {ACTION_GROUPS.map((group) => (
                <option key={group.value} value={group.value}>
                  {t(group.labelKey)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('audit.target')} htmlFor="audit-target" className="mb-0">
            <Select id="audit-target" value={filters.targetType} onChange={set('targetType')}>
              <option value="">{t('app.all')}</option>
              {TARGET_TYPES.map((target) => (
                <option key={target.value} value={target.value}>
                  {t(target.labelKey)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('audit.actor')} htmlFor="audit-actor" className="mb-0">
            <Select id="audit-actor" value={filters.actor} onChange={set('actor')}>
              <option value="">{t('app.all')}</option>
              {session?.user && <option value={session.user._id}>{t('audit.actorMe')}</option>}
              {(resellers.data?.resellers ?? [])
                .filter((reseller) => reseller.user?._id)
                .map((reseller) => (
                  <option key={reseller.id} value={reseller.user._id}>
                    {reseller.shopName}
                  </option>
                ))}
            </Select>
          </Field>

          <Field label={t('reports.from')} htmlFor="audit-from" className="mb-0">
            <Input id="audit-from" type="date" value={filters.from} onChange={set('from')} />
          </Field>

          <Field label={t('reports.to')} htmlFor="audit-to" className="mb-0">
            <Input id="audit-to" type="date" value={filters.to} onChange={set('to')} />
          </Field>
        </div>

        {filtered && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="quiet" onClick={() => setFilters(EMPTY)}>
              {t('audit.clearFilters')}
            </Button>
          </div>
        )}
      </Card>

      {audit.isLoading && <ListSkeleton rows={6} />}

      {audit.isError && !audit.data && (
        <ErrorState onRetry={() => audit.refetch()} isRetrying={audit.isFetching} error={audit.error} />
      )}

      {audit.isSuccess && entries.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title={filtered ? t('app.noResults') : t('audit.empty')}
          description={filtered ? t('audit.emptyFiltered') : undefined}
        />
      )}

      {entries.length > 0 && (
        <>
          <ul className="grid gap-3 lg:hidden">
            {entries.map((entry) => (
              <li key={entry.id}>
                <AuditCard entry={entry} />
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
        </>
      )}
    </>
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

function AuditCard({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const changes = diff(entry);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{actionLabel(entry.action)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(entry.at)}</p>
        </div>
        <Badge tone="neutral">{targetLabel(entry.targetType)}</Badge>
      </div>

      <p className="mt-2 text-sm">
        <ActorName entry={entry} />
      </p>
      {entry.targetId && (
        <p className="tabular mt-0.5 truncate text-xs text-muted-foreground">{entry.targetId}</p>
      )}

      {changes.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="tap mt-3 flex w-full items-center justify-between rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
          >
            {t('audit.showChanges').replace('{n}', String(changes.length))}
            <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && <ChangeList changes={changes} className="mt-3" />}
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
          <div className="text-sm">{targetLabel(entry.targetType)}</div>
          {entry.targetId && (
            <div className="tabular text-xs text-muted-foreground">{entry.targetId}</div>
          )}
        </Td>
        <Td className="text-right">
          {changes.length > 0 ? (
            <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {changes.length}
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
            <ChangeList changes={changes} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ diff -- */

type Change = { key: string; before: unknown; after: unknown };

/**
 * The keys whose value differs between `before` and `after`, in the order they
 * first appear. A key present on one side only is a change too: an `after`
 * with nothing before it is what a creation looks like.
 */
function diff(entry: AuditEntry): Change[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, before: before[key], after: after[key] }));
}

/** A stored value, readable. Money kept in poisha is shown in taka. */
function formatValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? t('audit.yes') : t('audit.no');
  if (typeof value === 'number' && /Poisha$/.test(key)) return formatMoney(value / 100);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function ChangeList({ changes, className }: { changes: Change[]; className?: string }) {
  return (
    <dl className={cn('space-y-2 text-sm', className)}>
      {changes.map((change) => (
        <div key={change.key} className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{change.key}</dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 break-all">
            <span className="text-danger line-through decoration-danger/50">
              {formatValue(change.key, change.before)}
            </span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <span className="font-medium text-success-ink">{formatValue(change.key, change.after)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
