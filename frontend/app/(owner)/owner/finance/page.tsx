'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowDownToLine, ArrowUpFromLine, CircleCheckBig, TriangleAlert, X } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { t, tf, tMethod, tRequestStatus } from '@/lib/i18n/bn';
import { formatDateTime, formatMoney, formatNumber, formatSignedMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUrlState } from '@/lib/use-url-state';
import { LIVE } from '@/lib/store/api';
import { useGetDashboardQuery } from '@/lib/store/endpoints/dashboard';
import {
  useApproveDepositMutation,
  useApproveWithdrawalMutation,
  useGetDepositScreenshotQuery,
  useGetDepositsInfiniteQuery,
  useGetWithdrawalsInfiniteQuery,
  useRejectDepositMutation,
  useRejectWithdrawalMutation,
  type DepositRow,
  type ResellerRef,
  type WithdrawalRow,
} from '@/lib/store/endpoints/people';
import {
  Alert,
  Badge,
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  PhoneLink,
  statusTone,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/layout';
import { rangeOf } from '@/components/ui/date-range';
import { DownloadMenu } from '@/components/report/download-menu';
import { Segmented, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Skeleton, ListSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { LoadMore } from '@/components/ui/load-more';
import { ZoomableImage } from '@/components/document-viewer';

/**
 * Reseller deposits and withdrawals: the two queues where the owner moves
 * money on a reseller's word.
 *
 * Every decision here goes through a confirm sheet that names the shop, shows
 * the evidence (the screenshot, the transaction id, the number to pay) and the
 * balance before and after. A deposit used to be approved on a single tap of a
 * green button beside the reject one, with the screenshot behind another tap
 * and the balance nowhere on the screen.
 *
 * The tab, the status and an optional reseller live in the URL, so the
 * dashboard's "withdrawals waiting" tile and the reseller page can link
 * straight to the right queue.
 */

type Tab = 'deposits' | 'withdrawals';
type Status = 'pending' | 'approved' | 'rejected' | 'all';

const STATUSES: Status[] = ['pending', 'approved', 'rejected', 'all'];

/** The id to link a reseller with, whichever of the two the row carries. */
const resellerId = (reseller: ResellerRef): string | undefined => reseller?.id ?? reseller?._id;

/** Bengali digits for the minimum the server enforces on a reason. */
const MIN_REASON = 3;

export default function OwnerFinancePage() {
  const [filters, setFilters] = useUrlState({ tab: 'deposits', status: 'pending', reseller: '' });
  const tab: Tab = filters.tab === 'withdrawals' ? 'withdrawals' : 'deposits';
  const status: Status = STATUSES.includes(filters.status as Status)
    ? (filters.status as Status)
    : 'pending';

  // The same payload the shell's badges read, so the counts agree with the nav.
  const dashboard = useGetDashboardQuery(undefined, LIVE);
  const counts = {
    deposits: dashboard.data?.pendingDeposits,
    withdrawals: dashboard.data?.pendingWithdrawals,
  };

  const tabs = [
    { value: 'deposits' as const, label: t('nav.deposits'), count: counts.deposits },
    { value: 'withdrawals' as const, label: t('nav.withdrawals'), count: counts.withdrawals },
  ];

  const statuses = STATUSES.map((value) => ({
    value,
    label: value === 'all' ? t('app.all') : tRequestStatus(value),
    count: value === 'pending' ? counts[tab] : undefined,
  }));

  const list = { status, reseller: filters.reseller, clearReseller: () => setFilters({ reseller: '' }) };

  /*
   * Two segmented controls rather than two dropdowns in the page header. Both of
   * these are read as often as they are changed: which queue am I in, and am I
   * looking at what is waiting or what is settled. A dropdown answers that only
   * after it is opened.
   */
  return (
    <>
      <PageHeader
        title={t('finance.title')}
        subtitle={t('finance.subtitle')}
        /*
         * A deposit is somebody paying down what they owe, so the sheet worth
         * having open beside this screen is the one that says what is owed.
         */
        action={<DownloadMenu range={rangeOf('last30')} only={['due', 'resellers']} />}
      />

      <Toolbar>
        <Segmented
          label={t('finance.tabs')}
          value={tab}
          onChange={(value) => setFilters({ tab: value })}
          options={tabs}
        />
        <ToolbarSpacer />
        <Segmented
          label={t('app.status')}
          value={status}
          onChange={(value) => setFilters({ status: value })}
          options={statuses}
        />
      </Toolbar>

      {tab === 'deposits' ? <Deposits {...list} /> : <Withdrawals {...list} />}
    </>
  );
}

type ListProps = { status: Status; reseller: string; clearReseller: () => void };

/* --------------------------------------------------------------- shared -- */

/** The shop, linked to its page, and the number to ring. */
function ResellerCell({ reseller }: { reseller: ResellerRef }) {
  const id = resellerId(reseller);
  return (
    <div className="min-w-0">
      {id ? (
        <Link
          href={`/owner/resellers/${id}` as Route}
          className="block truncate font-medium underline-offset-2 hover:underline"
        >
          {reseller?.shopName}
        </Link>
      ) : (
        <p className="truncate font-medium">{reseller?.shopName ?? '—'}</p>
      )}
      <PhoneLink phone={reseller?.user?.phoneE164} className="text-xs text-muted-foreground" />
    </div>
  );
}

/** Who decided, when, and what they said: the history the queue used to forget. */
function ReviewLine({
  row,
}: {
  row: { status: string; reviewedAt?: string | null; reviewedBy?: { name: string } | null; reason?: string | null; payoutReference?: string | null };
}) {
  if (row.status === 'pending') return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {row.reviewedAt && (
        <p>
          {row.reviewedBy
            ? tf('finance.reviewedBy', { name: row.reviewedBy.name, at: formatDateTime(row.reviewedAt) })
            : tf('finance.reviewedAt', { at: formatDateTime(row.reviewedAt) })}
        </p>
      )}
      {row.reason && <p className="text-danger-ink">{tf('finance.reasonShown', { reason: row.reason })}</p>}
      {row.payoutReference && (
        <p className="tabular break-all">{tf('finance.payoutShown', { ref: row.payoutReference })}</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={statusTone(status)} dot>
      {tRequestStatus(status)}
    </Badge>
  );
}

/** What the reseller wrote, quoted, so it is not mistaken for the owner's own note. */
function ResellerNote({ note }: { note?: string | null }) {
  if (!note) return null;
  return (
    <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs">
      <span className="font-semibold">{t('finance.resellerNote')}: </span>
      <span className="break-words">{note}</span>
    </p>
  );
}

/** A value with a copy button, for the numbers the owner pastes into bKash. */
function Copyable({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <span className="inline-flex max-w-full items-center justify-end gap-1">
      <span className="tabular min-w-0 break-all">{value}</span>
      <CopyButton value={value} label={label} onCopied={() => toast(t('app.copied'))} />
    </span>
  );
}

function ListLoading() {
  return <ListSkeleton rows={4} />;
}

/** The queue's empty state, which on the pending tab is good news. */
function QueueEmpty({
  kind,
  status,
  reseller,
  clearReseller,
}: ListProps & { kind: Tab }) {
  if (reseller) return <FilteredEmpty onClear={clearReseller} />;
  if (status === 'pending') {
    return (
      <EmptyState
        icon={CircleCheckBig}
        title={t('finance.allDoneTitle')}
        description={kind === 'deposits' ? t('finance.allDoneDeposits') : t('finance.allDoneWithdrawals')}
      />
    );
  }
  return (
    <EmptyState
      icon={kind === 'deposits' ? ArrowDownToLine : ArrowUpFromLine}
      title={kind === 'deposits' ? t('finance.noneDeposits') : t('finance.noneWithdrawals')}
    />
  );
}

/** Shown while the list is narrowed to one reseller, with the way back to everyone. */
function ResellerFilter({ shopName, onClear }: { shopName?: string; onClear: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-primary-softer px-3 py-1 text-sm text-primary-ink">
      <span className="min-w-0 truncate font-medium">
        {tf('finance.onlyReseller', { shop: shopName ?? '…' })}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="tap inline-flex shrink-0 items-center gap-1 rounded-lg px-2 font-semibold hover:bg-primary-soft"
      >
        <X aria-hidden className="h-4 w-4" />
        {t('finance.showAll')}
      </button>
    </div>
  );
}

/** The reason presets, by queue: the reasons an owner actually types. */
const REJECT_PRESETS: Record<Tab, () => string[]> = {
  deposits: () => [
    t('finance.rejectPresetNotReceived'),
    t('finance.rejectPresetTxn'),
    t('finance.rejectPresetAmount'),
  ],
  withdrawals: () => [
    t('finance.rejectPresetNumber'),
    t('finance.rejectPresetAsked'),
    t('finance.rejectPresetBalance'),
  ],
};

/**
 * Rejecting a request: one sheet per request, mounted only while open, so the
 * reason typed for one is never sent for the next. It names the request it is
 * about, because the old dialog said only "reject" over a blank box.
 */
function RejectSheet({
  kind,
  row,
  onClose,
}: {
  kind: Tab;
  row: DepositRow | WithdrawalRow;
  onClose: () => void;
}) {
  const toast = useToast();
  const [rejectDeposit] = useRejectDepositMutation();
  const [rejectWithdrawal] = useRejectWithdrawalMutation();
  const shop = row.reseller?.shopName ?? '—';
  const amount = formatMoney(row.amount);

  return (
    <ConfirmSheet
      title={kind === 'deposits' ? t('finance.rejectDepositTitle') : t('finance.rejectWithdrawalTitle')}
      tone="danger"
      confirmLabel={t('owner.reject')}
      onClose={onClose}
      onConfirm={async (reason) => {
        if (kind === 'deposits') await rejectDeposit({ id: row.id, reason }).unwrap();
        else await rejectWithdrawal({ id: row.id, reason }).unwrap();
        toast(
          tf(kind === 'deposits' ? 'finance.depositRejected' : 'finance.withdrawalRejected', { shop, amount })
        );
      }}
      summary={
        <>
          <p className="font-semibold">{shop}</p>
          <p className="tabular mt-0.5">
            {amount} · {tMethod(row.method)} · {formatDateTime(row.createdAt)}
          </p>
        </>
      }
      consequences={[t('finance.rejectConsequence')]}
      reason={{
        required: true,
        minLength: MIN_REASON,
        label: t('finance.rejectReasonLabel'),
        placeholder: tf('app.minChars', { count: formatNumber(MIN_REASON) }),
        presets: REJECT_PRESETS[kind](),
      }}
    />
  );
}

/* ------------------------------------------------------------- deposits -- */

/** The payment screenshot, fetched as a fresh signed URL each time it is shown. */
function DepositScreenshot({ id }: { id: string }) {
  const shot = useGetDepositScreenshotQuery({ id });
  if (shot.isLoading) return <Skeleton className="h-48 w-full rounded-lg" />;
  if (shot.isError || !shot.data) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
        <p>{t('finance.screenshotFailed')}</p>
        <Button size="sm" variant="outline" loading={shot.isFetching} onClick={() => shot.refetch()}>
          {t('app.retry')}
        </Button>
      </div>
    );
  }
  return <ZoomableImage src={shot.data.url} alt={t('wallet.screenshot')} onBroken={() => shot.refetch()} />;
}

/**
 * Approving a deposit, with everything the decision rests on in one place: who,
 * how much, from which number, the transaction id to look up in the owner's own
 * bKash, the screenshot, and what the balance becomes. Reject is offered from
 * here too, since this is where a mismatch is noticed.
 */
function ApproveDepositSheet({
  row,
  onClose,
  onReject,
}: {
  row: DepositRow;
  onClose: () => void;
  onReject: () => void;
}) {
  const toast = useToast();
  const [approve] = useApproveDepositMutation();
  const shop = row.reseller?.shopName ?? '—';
  const amount = formatMoney(row.amount);
  const balance = row.balance;

  return (
    <ConfirmSheet
      title={t('finance.approveDepositTitle')}
      tone="success"
      confirmLabel={tf('finance.approveAmount', { amount })}
      onClose={onClose}
      onConfirm={async () => {
        await approve({ id: row.id, resellerId: resellerId(row.reseller) }).unwrap();
        toast(tf('finance.depositApproved', { shop, amount }));
      }}
      summary={
        <>
          <p className="font-semibold">{shop}</p>
          <p className="tabular mt-0.5 text-xl font-bold">{amount}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tf('finance.requestedAt', { at: formatDateTime(row.createdAt) })}
          </p>
        </>
      }
      rows={[
        { label: t('wallet.method'), value: tMethod(row.method) },
        ...(row.senderNumber
          ? [{ label: t('finance.sender'), value: <Copyable value={row.senderNumber} label={t('finance.copyNumber')} /> }]
          : []),
        ...(row.transactionId
          ? [{ label: t('wallet.transactionId'), value: <Copyable value={row.transactionId} label={t('finance.copyTxn')} /> }]
          : []),
        ...(balance != null
          ? [
              { label: t('finance.balanceNow'), value: formatSignedMoney(balance) },
              {
                label: t('finance.balanceAfter'),
                value: formatSignedMoney(balance + row.amount),
                strong: true,
                tone: 'success' as const,
              },
            ]
          : []),
      ]}
      consequences={[
        tf('finance.depositCheck', { method: tMethod(row.method) }),
        tf('finance.depositConsequence', { amount }),
      ]}
    >
      <ResellerNote note={row.note} />
      <div className="mb-3 mt-3">
        {row.hasScreenshot ? (
          <DepositScreenshot id={row.id} />
        ) : (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t('finance.noScreenshot')}</p>
        )}
      </div>
      <Button variant="outline" full className="mb-2 text-danger" onClick={onReject}>
        {t('finance.rejectInstead')}
      </Button>
    </ConfirmSheet>
  );
}

type Decision<R> = { mode: 'approve' | 'reject' | 'screenshot'; row: R } | null;

function Deposits({ status, reseller, clearReseller }: ListProps) {
  const [deciding, setDeciding] = useState<Decision<DepositRow>>(null);

  // A page at a time; the approved and rejected histories only grow. The
  // pending queue is watched, so it polls.
  const deposits = useGetDepositsInfiniteQuery(
    { status: status === 'all' ? undefined : status, resellerId: reseller || undefined },
    status === 'pending' ? LIVE : undefined
  );
  const rows = deposits.data?.pages.flatMap((page) => page.deposits) ?? [];
  const total = deposits.data?.pages[0]?.total ?? 0;
  // The previous list stays, dimmed, while another status loads.
  const switching = deposits.isFetching && !deposits.isFetchingNextPage && !deposits.currentData;

  const actions = (row: DepositRow, compact?: boolean) => (
    <div className={cn('flex flex-wrap gap-2', compact ? 'justify-end' : '[&>button]:flex-1')}>
      {row.status === 'pending' ? (
        <>
          <Button size="sm" variant="outline" onClick={() => setDeciding({ mode: 'reject', row })}>
            {t('owner.reject')}
          </Button>
          <Button size="sm" variant="success" onClick={() => setDeciding({ mode: 'approve', row })}>
            {t('finance.check')}
          </Button>
        </>
      ) : row.hasScreenshot ? (
        <Button size="sm" variant="outline" onClick={() => setDeciding({ mode: 'screenshot', row })}>
          {t('wallet.screenshot')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      {reseller && <ResellerFilter shopName={rows[0]?.reseller?.shopName} onClear={clearReseller} />}

      {deposits.isLoading ? (
        <ListLoading />
      ) : deposits.isError && rows.length === 0 ? (
        <ErrorState onRetry={() => deposits.refetch()} isRetrying={deposits.isFetching} error={deposits.error} />
      ) : rows.length === 0 ? (
        <QueueEmpty kind="deposits" status={status} reseller={reseller} clearReseller={clearReseller} />
      ) : (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          <ul className="space-y-3 sm:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <ResellerCell reseller={row.reseller} />
                    <div className="shrink-0 text-right">
                      <StatusBadge status={row.status} />
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p className="tabular text-xl font-bold">{formatMoney(row.amount)}</p>
                      {row.status === 'pending' && row.balance != null && (
                        <p className="tabular text-xs text-muted-foreground">
                          {t('finance.balanceNow')} {formatSignedMoney(row.balance)}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 text-right text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{tMethod(row.method)}</p>
                      {row.senderNumber && <p className="tabular">{row.senderNumber}</p>}
                      {row.transactionId && <p className="tabular break-all">{row.transactionId}</p>}
                    </div>
                  </div>

                  <ResellerNote note={row.note} />
                  <ReviewLine row={row} />
                  <div className="mt-3">{actions(row)}</div>
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap>
            <thead>
              <tr>
                <Th>{t('finance.shop')}</Th>
                <Th>{t('wallet.method')}</Th>
                <Th className="text-right">{t('wallet.amount')}</Th>
                <Th>{t('wallet.transactionId')}</Th>
                <Th>{t('app.status')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="max-w-56">
                    <ResellerCell reseller={row.reseller} />
                    {row.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">“{row.note}”</p>}
                  </Td>
                  <Td>
                    {tMethod(row.method)}
                    {row.senderNumber && (
                      <div className="tabular text-xs text-muted-foreground">{row.senderNumber}</div>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="tabular font-medium">{formatMoney(row.amount)}</div>
                    {row.status === 'pending' && row.balance != null && (
                      <div className="tabular text-xs text-muted-foreground">
                        {t('finance.balanceNow')} {formatSignedMoney(row.balance)}
                      </div>
                    )}
                  </Td>
                  <Td className="tabular max-w-40 break-all text-xs">{row.transactionId ?? '—'}</Td>
                  <Td>
                    <StatusBadge status={row.status} />
                    <div className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</div>
                    <ReviewLine row={row} />
                  </Td>
                  <Td className="text-right">{actions(row, true)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          <LoadMore
            hasMore={Boolean(deposits.hasNextPage)}
            loading={deposits.isFetchingNextPage}
            onLoadMore={() => deposits.fetchNextPage()}
            error={deposits.isFetchNextPageError ? deposits.error : null}
            shown={rows.length}
            total={total}
          />
        </div>
      )}

      {deciding?.mode === 'approve' && (
        <ApproveDepositSheet
          key={deciding.row.id}
          row={deciding.row}
          onClose={() => setDeciding(null)}
          onReject={() => setDeciding({ mode: 'reject', row: deciding.row })}
        />
      )}
      {deciding?.mode === 'reject' && (
        <RejectSheet key={deciding.row.id} kind="deposits" row={deciding.row} onClose={() => setDeciding(null)} />
      )}
      {deciding?.mode === 'screenshot' && (
        <Modal open wide onClose={() => setDeciding(null)} title={t('wallet.screenshot')}>
          <p className="mb-3 text-sm text-muted-foreground">
            {deciding.row.reseller?.shopName} · <span className="tabular">{formatMoney(deciding.row.amount)}</span>
          </p>
          <DepositScreenshot id={deciding.row.id} />
        </Modal>
      )}
    </>
  );
}

/* ---------------------------------------------------------- withdrawals -- */

/**
 * Where the money goes, as the owner reads it off the screen to make the
 * payment. A bank transfer is four lines, not a number: the whole point of
 * asking for them is that the owner can act on them without ringing back.
 */
function PayoutDestination({ row, align = 'right' }: { row: WithdrawalRow; align?: 'left' | 'right' }) {
  if (row.bank) {
    return (
      <div className={align === 'right' ? 'text-right' : ''}>
        <p className="font-medium text-foreground">{row.bank.bankName}</p>
        <p>{row.bank.branchName}</p>
        <p className="tabular break-all font-medium text-foreground">{row.bank.accountNumber}</p>
        <p>{row.bank.accountName}</p>
        {row.bank.routingNumber && (
          <p className="tabular">
            {t('wallet.routingNumber')} {row.bank.routingNumber}
          </p>
        )}
      </div>
    );
  }
  return <p className="tabular break-all">{row.destinationNumber}</p>;
}

/**
 * What a failed withdrawal approval says.
 *
 * Approval can fail after the request was fine: a confirm since then may have
 * spent the balance, and a withdrawal never creates debt (docs/adr/0009). The
 * generic wording would leave the owner wondering whose balance and what now,
 * so this one says the request is still pending and what the choices are.
 */
const withdrawalFailure = (error: unknown): unknown =>
  error instanceof ApiError && error.code === 'INSUFFICIENT_BALANCE'
    ? new Error(t('finance.withdrawalShort'))
    : error;

/**
 * Approving a withdrawal: the method, the number to pay with a copy button,
 * the balance it comes out of, and the order to do things in. The transaction
 * id of the payout is typed here and kept on the request.
 */
function ApproveWithdrawalSheet({
  row,
  onClose,
  onReject,
}: {
  row: WithdrawalRow;
  onClose: () => void;
  onReject: () => void;
}) {
  const toast = useToast();
  const [approve] = useApproveWithdrawalMutation();
  const shop = row.reseller?.shopName ?? '—';
  const amount = formatMoney(row.amount);
  const balance = row.balance;
  const short = balance != null && row.amount > balance;

  return (
    <ConfirmSheet
      title={t('finance.approveWithdrawalTitle')}
      tone="success"
      confirmLabel={tf('finance.approveAmount', { amount })}
      onClose={onClose}
      onConfirm={async (payoutReference) => {
        try {
          await approve({
            id: row.id,
            payoutReference: payoutReference || undefined,
            resellerId: resellerId(row.reseller),
          }).unwrap();
        } catch (error) {
          throw withdrawalFailure(error);
        }
        toast(tf('finance.withdrawalApprovedNamed', { shop, amount }));
      }}
      summary={
        <>
          <p className="font-semibold">{shop}</p>
          <p className="tabular mt-0.5 text-xl font-bold">{amount}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tf('finance.requestedAt', { at: formatDateTime(row.createdAt) })}
          </p>
        </>
      }
      rows={[
        { label: t('wallet.method'), value: tMethod(row.method), strong: true },
        ...(balance != null
          ? [
              { label: t('finance.balanceNow'), value: formatSignedMoney(balance) },
              {
                label: t('finance.balanceAfter'),
                value: formatSignedMoney(balance - row.amount),
                strong: true,
                tone: short ? ('danger' as const) : undefined,
              },
            ]
          : []),
      ]}
      consequences={[tf('finance.withdrawalConsequence', { amount })]}
      reason={{
        label: t('finance.payoutReference'),
        placeholder: t('finance.payoutReferencePlaceholder'),
      }}
    >
      {short && (
        <Alert tone="danger" icon={TriangleAlert}>
          {t('finance.overBalance')}
        </Alert>
      )}

      <div className="mb-4 rounded-xl border border-border px-4 py-3 text-sm">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('wallet.payoutDestination')}</p>
        {row.bank ? (
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.bankName')}</dt>
              <dd className="text-right">{row.bank.bankName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.branchName')}</dt>
              <dd className="text-right">{row.bank.branchName}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.accountNumber')}</dt>
              <dd className="min-w-0 text-right font-semibold">
                <Copyable value={row.bank.accountNumber} label={t('finance.copyAccount')} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.accountName')}</dt>
              <dd className="text-right">{row.bank.accountName}</dd>
            </div>
            {row.bank.routingNumber && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('wallet.routingNumber')}</dt>
                <dd className="tabular text-right">{row.bank.routingNumber}</dd>
              </div>
            )}
          </dl>
        ) : row.destinationNumber ? (
          <div className="flex items-center justify-between gap-3">
            <span>{tMethod(row.method)}</span>
            <span className="text-lg font-bold">
              <Copyable value={row.destinationNumber} label={t('finance.copyNumber')} />
            </span>
          </div>
        ) : (
          <p>—</p>
        )}
      </div>

      <ResellerNote note={row.note} />

      <div className="my-4">
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('finance.stepsTitle')}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>{t('finance.step1')}</li>
          <li>{t('finance.step2')}</li>
          <li>{t('finance.step3')}</li>
        </ol>
      </div>

      <Button variant="outline" full className="mb-2 text-danger" onClick={onReject}>
        {t('finance.rejectInsteadWithdrawal')}
      </Button>
    </ConfirmSheet>
  );
}

function Withdrawals({ status, reseller, clearReseller }: ListProps) {
  const [deciding, setDeciding] = useState<Decision<WithdrawalRow>>(null);

  const withdrawals = useGetWithdrawalsInfiniteQuery(
    { status: status === 'all' ? undefined : status, resellerId: reseller || undefined },
    status === 'pending' ? LIVE : undefined
  );
  const rows = withdrawals.data?.pages.flatMap((page) => page.withdrawals) ?? [];
  const total = withdrawals.data?.pages[0]?.total ?? 0;
  const switching = withdrawals.isFetching && !withdrawals.isFetchingNextPage && !withdrawals.currentData;

  const actions = (row: WithdrawalRow, compact?: boolean) =>
    row.status === 'pending' ? (
      <div className={cn('flex flex-wrap gap-2', compact ? 'justify-end' : '[&>button]:flex-1')}>
        <Button size="sm" variant="outline" onClick={() => setDeciding({ mode: 'reject', row })}>
          {t('owner.reject')}
        </Button>
        <Button size="sm" variant="success" onClick={() => setDeciding({ mode: 'approve', row })}>
          {t('finance.pay')}
        </Button>
      </div>
    ) : null;

  /** A balance below the amount is the one thing to see before paying. */
  const balanceLine = (row: WithdrawalRow) =>
    row.status === 'pending' && row.balance != null ? (
      <p
        className={cn(
          'tabular text-xs',
          row.amount > row.balance ? 'font-semibold text-danger' : 'text-muted-foreground'
        )}
      >
        {t('finance.balanceNow')} {formatSignedMoney(row.balance)}
        {row.amount > row.balance && ` · ${t('finance.short')}`}
      </p>
    ) : null;

  return (
    <>
      {reseller && <ResellerFilter shopName={rows[0]?.reseller?.shopName} onClear={clearReseller} />}

      {withdrawals.isLoading ? (
        <ListLoading />
      ) : withdrawals.isError && rows.length === 0 ? (
        <ErrorState onRetry={() => withdrawals.refetch()} isRetrying={withdrawals.isFetching} error={withdrawals.error} />
      ) : rows.length === 0 ? (
        <QueueEmpty kind="withdrawals" status={status} reseller={reseller} clearReseller={clearReseller} />
      ) : (
        <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
          <ul className="space-y-3 sm:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <ResellerCell reseller={row.reseller} />
                    <div className="shrink-0 text-right">
                      <StatusBadge status={row.status} />
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p className="tabular text-xl font-bold">{formatMoney(row.amount)}</p>
                      {balanceLine(row)}
                    </div>
                    <div className="min-w-0 text-right text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{tMethod(row.method)}</p>
                      <PayoutDestination row={row} />
                    </div>
                  </div>

                  <ResellerNote note={row.note} />
                  <ReviewLine row={row} />
                  {row.status === 'pending' && <div className="mt-3">{actions(row)}</div>}
                </Card>
              </li>
            ))}
          </ul>

          <TableWrap>
            <thead>
              <tr>
                <Th>{t('finance.shop')}</Th>
                <Th>{t('wallet.payoutDestination')}</Th>
                <Th className="text-right">{t('wallet.amount')}</Th>
                <Th>{t('app.status')}</Th>
                <Th className="text-right">{t('app.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="max-w-56">
                    <ResellerCell reseller={row.reseller} />
                    {row.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">“{row.note}”</p>}
                  </Td>
                  <Td>
                    <div className="text-xs font-medium">{tMethod(row.method)}</div>
                    <div className="text-xs text-muted-foreground">
                      <PayoutDestination row={row} align="left" />
                    </div>
                  </Td>
                  <Td className="text-right">
                    <div className="tabular font-medium">{formatMoney(row.amount)}</div>
                    {balanceLine(row)}
                  </Td>
                  <Td>
                    <StatusBadge status={row.status} />
                    <div className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</div>
                    <ReviewLine row={row} />
                  </Td>
                  <Td className="text-right">{actions(row, true)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          <LoadMore
            hasMore={Boolean(withdrawals.hasNextPage)}
            loading={withdrawals.isFetchingNextPage}
            onLoadMore={() => withdrawals.fetchNextPage()}
            error={withdrawals.isFetchNextPageError ? withdrawals.error : null}
            shown={rows.length}
            total={total}
          />
        </div>
      )}

      {deciding?.mode === 'approve' && (
        <ApproveWithdrawalSheet
          key={deciding.row.id}
          row={deciding.row}
          onClose={() => setDeciding(null)}
          onReject={() => setDeciding({ mode: 'reject', row: deciding.row })}
        />
      )}
      {deciding?.mode === 'reject' && (
        <RejectSheet key={deciding.row.id} kind="withdrawals" row={deciding.row} onClose={() => setDeciding(null)} />
      )}
    </>
  );
}
