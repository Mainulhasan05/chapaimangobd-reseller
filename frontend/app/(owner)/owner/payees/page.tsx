'use client';

/**
 * পার্টি — everyone the business owes money to, biggest debt first.
 *
 * The screen that answers "who is waiting on me". A `due` here is positive when
 * the owner owes, which is the opposite of a reseller's balance (docs/adr/0025),
 * so nothing on this page is ever added to a wallet figure and a negative due is
 * never shown as a minus sign: it is an advance, said in its own words.
 *
 * Built to the same brief as `owner/supplies`:
 *
 * 1. The words are what the owner says out loud — "পার্টি", "দিতে হবে",
 *    "টাকা দিন" — and every one of them comes from the dictionary.
 * 2. Nothing on a row here is worked out by the software. A due is the sum of an
 *    append-only ledger, and that arithmetic is shown on the detail page where
 *    there is room to lay it out, so no row carries a "কীভাবে?".
 * 3. An empty screen teaches. A first-time owner is told what a পার্টি is, with
 *    examples from the trade, and what happens after adding one.
 * 4. No row is a dead end: a name opens the খাতা, a due can be paid from the
 *    row, and the foot of the list links to the two screens that move these
 *    figures.
 *
 * Taking somebody off the list never takes their due off the books: the totals
 * count archived payees, and the "সরানো পার্টি" switch brings them back.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import { HandCoins, Plus, Receipt, ShoppingCart, Wallet } from 'lucide-react';
import { t, tf, tPayeeKind } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Payee } from '@/lib/types';
import { useUrlSearch, useUrlState } from '@/lib/use-url-state';
import {
  useArchivePayeeMutation,
  useGetPayeesQuery,
  useRestorePayeeMutation,
} from '@/lib/store/endpoints/cost';
import { errorMessage } from '@/lib/api';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  PhoneLink,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { DownloadMenu } from '@/components/report/download-menu';
import { Segmented, SearchInput, Toolbar, ToolbarSpacer, type SegmentOption } from '@/components/ui/toolbar';
import { Switch } from '@/components/ui/switch';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { PAYEE_KINDS, PayeeModal, type PayeeKind } from './payee-form';
import { PaySheet } from './pay-sheet';

type KindFilter = 'all' | PayeeKind;

const KIND_FILTERS: SegmentOption<KindFilter>[] = [
  { value: 'all', label: t('app.all') },
  ...PAYEE_KINDS.map((kind) => ({ value: kind, label: tPayeeKind(kind) })),
];

/**
 * What one payee's account comes to, as a figure that cannot be misread.
 *
 * An advance is not a negative due. "You owe him ৳500" and "he owes you ৳500 of
 * goods" are opposite facts, so they get different words, a different tone and a
 * badge of their own rather than the same row with a minus sign in front of it.
 */
function DueFigure({ payee, align = 'right' }: { payee: Payee; align?: 'left' | 'right' }) {
  if (payee.isAdvance) {
    return (
      <div className={align === 'right' ? 'text-right' : ''}>
        <Badge tone="primary">{t('payee.advance')}</Badge>
        <p className="tabular mt-1 font-bold text-primary-ink">{formatMoney(payee.advance)}</p>
      </div>
    );
  }

  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p
        className={cn(
          'tabular font-bold',
          payee.due > 0 ? 'text-warning-ink' : 'text-muted-foreground'
        )}
      >
        {formatMoney(payee.due)}
      </p>
      <p className="text-xs text-muted-foreground">{t('payee.due')}</p>
    </div>
  );
}

/**
 * Where the figures on this page actually come from.
 *
 * Under the list rather than in a corner, because a due nobody recognises is
 * almost always a কেনা or an unpaid খরচ somebody forgot to write down, and both
 * of those are entered on another screen.
 */
function WhereFrom() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>{t('costSetup.thenPurchase')}</span>
      <Link
        href="/owner/purchases"
        className="tap inline-flex items-center gap-1 font-semibold text-primary-ink underline"
      >
        <ShoppingCart className="h-3.5 w-3.5" />
        {t('costSetup.recordPurchase')}
      </Link>
      <Link
        href="/owner/expenses"
        className="tap inline-flex items-center gap-1 font-semibold text-primary-ink underline"
      >
        <Receipt className="h-3.5 w-3.5" />
        {t('expense.new')}
      </Link>
    </div>
  );
}

export default function OwnerPayeesPage() {
  const toast = useToast();
  const [filters, setFilters, { reset }] = useUrlState({
    kind: 'all',
    owing: false as boolean,
    archived: false as boolean,
  });
  const search = useUrlSearch('q');
  const kind = (KIND_FILTERS.some((option) => option.value === filters.kind)
    ? filters.kind
    : 'all') as KindFilter;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Payee | null>(null);
  const [paying, setPaying] = useState<Payee | null>(null);
  const [archiving, setArchiving] = useState<Payee | null>(null);

  const payees = useGetPayeesQuery({
    kind: kind === 'all' ? undefined : kind,
    owingOnly: filters.owing,
    q: search.term,
    includeArchived: filters.archived,
  });

  const [archive] = useArchivePayeeMutation();
  const [restore, restoreState] = useRestorePayeeMutation();

  const rows = payees.data?.payees ?? [];
  const totals = payees.data?.totals;
  /** A narrowed list that came back empty is a different sentence from a book nobody is in yet. */
  const narrowed = kind !== 'all' || filters.owing || Boolean(search.term);
  // The previous list stays on screen, dimmed, while the next filter loads.
  const switching = payees.isFetching && !payees.isLoading;

  const clearFilters = () => {
    reset();
    search.setInput('');
  };

  const doRestore = async (payee: Payee) => {
    try {
      await restore({ id: payee.id }).unwrap();
      toast(tf('payee.restoredToast', { name: payee.nameBn }));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  const doArchive = async (payee: Payee) => {
    await archive({ id: payee.id }).unwrap();
    toast(tf('payee.archivedToast', { name: payee.nameBn }), 'success', {
      action: { label: t('app.undo'), onClick: () => void doRestore(payee) },
    });
  };

  /** The actions a row offers, the same on a card and in the table. */
  const actions = (payee: Payee, size: 'sm' | 'md') => {
    if (payee.isArchived) {
      return [
        <Button
          key="restore"
          size={size}
          variant="outline"
          loading={restoreState.isLoading && restoreState.originalArgs?.id === payee.id}
          onClick={() => void doRestore(payee)}
        >
          {t('app.restore')}
        </Button>,
      ];
    }
    return [
      <Button key="edit" size={size} variant="ghost" onClick={() => setEditing(payee)}>
        {t('app.edit')}
      </Button>,
      // Archived, never deleted: the ledger behind it settles an argument with a supplier.
      <Button key="archive" size={size} variant="ghost" onClick={() => setArchiving(payee)}>
        {t('payee.archive')}
      </Button>,
    ];
  };

  return (
    <>
      <PageHeader
        title={t('payee.title')}
        subtitle={t('payee.help')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Who to pay, as a sheet to carry to the market. Undated on purpose:
              * a due is where an account stands at the moment it is printed. */}
            <DownloadMenu range={null} only={['payables']} />
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('payee.new')}
            </Button>
          </div>
        }
      />

      <Toolbar>
        <Segmented
          label={t('payee.kind')}
          value={kind}
          onChange={(value) => setFilters({ kind: value })}
          options={KIND_FILTERS}
        />
        <ToolbarSpacer />
        <SearchInput
          value={search.input}
          onChange={search.setInput}
          placeholder={t('payee.searchPlaceholder')}
        />
      </Toolbar>

      {/* Full width below `sm`: the whole row is the tap target on a phone. */}
      <div className="mb-3 grid gap-x-6 sm:grid-cols-2 lg:max-w-2xl">
        <Switch
          checked={filters.owing}
          onChange={(owing) => setFilters({ owing })}
          label={t('payee.owingOnly')}
        />
        <Switch
          checked={filters.archived}
          onChange={(archived) => setFilters({ archived })}
          label={t('payee.showArchived')}
        />
      </div>

      {/*
       * Two figures, never one. Netting an advance off a due would produce a
       * number that is true of nobody: money already handed over is a different
       * fact from money still owed. See docs/adr/0025.
       *
       * The due counts archived payees whether or not they are listed, and says
       * how much of it they hold, so taking a name off the list never makes a
       * debt look paid.
       */}
      {payees.isLoading && (
        <>
          <StatSkeleton count={3} />
          <ListSkeleton rows={4} />
        </>
      )}

      {totals && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat
            className="col-span-2 sm:col-span-1"
            icon={HandCoins}
            label={t('payee.totalDue')}
            value={formatMoney(totals.due)}
            hint={
              totals.archivedDue
                ? tf('payee.archivedDueNote', { amount: formatMoney(totals.archivedDue) })
                : t('payee.dueHint')
            }
            tone={totals.due > 0 ? 'warning' : 'neutral'}
          />
          <Stat
            icon={Wallet}
            label={t('payee.totalAdvance')}
            value={formatMoney(totals.advance)}
            tone={totals.advance > 0 ? 'primary' : 'neutral'}
          />
          <Stat
            label={t('payee.title')}
            value={formatNumber(totals.count)}
            hint={`${formatNumber(totals.owingCount)} · ${t('payee.owingOnly')}`}
          />
        </div>
      )}

      {payees.isError && !payees.data && (
        <ErrorState
          onRetry={() => payees.refetch()}
          isRetrying={payees.isFetching}
          error={payees.error}
        />
      )}

      {/*
       * Nobody in the book yet. This is the first thing a new owner sees here, so
       * it says what belongs on this screen, with examples from the trade, and
       * then what happens next: a পার্টি on its own moves no money until a কেনা or
       * a খরচ is written against it.
       */}
      {payees.data && rows.length === 0 && !narrowed && !filters.archived && (
        <EmptyState
          icon={HandCoins}
          title={t('payee.title')}
          description={t('payee.help')}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                {t('payee.new')}
              </Button>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t('costSetup.thenPayee')} {t('costSetup.thenPurchase')}
              </p>
            </div>
          }
        />
      )}

      {payees.data && rows.length === 0 && (narrowed || filters.archived) && (
        <FilteredEmpty onClear={clearFilters} />
      )}

      {rows.length > 0 && (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          <ul className="space-y-3 lg:hidden">
            {rows.map((payee) => (
              <li key={payee.id}>
                <Card className={cn('p-4', payee.isArchived && 'bg-muted/40')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/owner/payees/${payee.id}` as Route}
                        className="block truncate py-1 font-semibold text-primary-ink hover:underline"
                      >
                        {payee.nameBn}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-2">
                        <Badge>{tPayeeKind(payee.kind)}</Badge>
                        {payee.isArchived && <Badge tone="neutral">{t('payee.archivedBadge')}</Badge>}
                        {/* A number on a phone is for calling, not for reading. */}
                        <PhoneLink phone={payee.phone} className="text-xs text-muted-foreground" />
                      </div>
                    </div>
                    <div className="shrink-0">
                      <DueFigure payee={payee} />
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2 border-t border-border pt-3 [&>*]:flex-1">
                    {/* The due, paid from the row: the reason most people open this list. */}
                    {payee.due > 0 && !payee.isArchived && (
                      <Button onClick={() => setPaying(payee)}>
                        <HandCoins className="h-4 w-4" />
                        {t('payee.pay')}
                      </Button>
                    )}
                    <ButtonLink href={`/owner/payees/${payee.id}`} variant="outline">
                      {t('payee.ledger')}
                    </ButtonLink>
                  </div>
                  <div className="mt-1 flex gap-2 [&>*]:flex-1">{actions(payee, 'md')}</div>
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap from="lg" minWidth="44rem">
            <thead>
              <tr>
                <Th>{t('payee.name')}</Th>
                <Th>{t('payee.kind')}</Th>
                <Th>{t('auth.phone')}</Th>
                <Th className="text-right">{t('payee.due')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((payee) => (
                <Tr key={payee.id} className={payee.isArchived ? 'bg-muted/40' : undefined}>
                  <Td className="font-medium">
                    <Link
                      href={`/owner/payees/${payee.id}` as Route}
                      className="rounded-md text-primary-ink hover:underline"
                    >
                      {payee.nameBn}
                    </Link>
                    {payee.isArchived && (
                      <Badge tone="neutral" className="ml-2">
                        {t('payee.archivedBadge')}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge>{tPayeeKind(payee.kind)}</Badge>
                  </Td>
                  <Td className="text-sm">
                    {payee.phone ? <PhoneLink phone={payee.phone} showIcon={false} /> : '—'}
                  </Td>
                  <Td className="text-right">
                    <DueFigure payee={payee} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {payee.due > 0 && !payee.isArchived && (
                        <Button size="sm" onClick={() => setPaying(payee)}>
                          {t('payee.pay')}
                        </Button>
                      )}
                      <ButtonLink href={`/owner/payees/${payee.id}`} size="sm" variant="outline">
                        {t('payee.ledger')}
                      </ButtonLink>
                      {actions(payee, 'sm')}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          <WhereFrom />
        </div>
      )}

      {(creating || editing) && (
        <PayeeModal
          key={editing?.id ?? 'new'}
          payee={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {paying && <PaySheet key={paying.id} payee={paying} onClose={() => setPaying(null)} />}

      {archiving && (
        <ConfirmSheet
          title={tf('payee.archiveTitle', { name: archiving.nameBn })}
          confirmLabel={t('payee.archive')}
          tone="danger"
          onClose={() => setArchiving(null)}
          onConfirm={() => doArchive(archiving)}
          summary={
            <>
              <p className="font-semibold">{archiving.nameBn}</p>
              <p className="text-xs text-muted-foreground">{tPayeeKind(archiving.kind)}</p>
            </>
          }
          consequences={[
            ...(archiving.due > 0
              ? [tf('payee.archiveDue', { amount: formatMoney(archiving.due) })]
              : archiving.isAdvance
                ? [tf('payee.archiveAdvance', { amount: formatMoney(archiving.advance) })]
                : []),
            t('payee.archiveKeep'),
          ]}
        />
      )}
    </>
  );
}
