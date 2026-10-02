'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Ban,
  CircleAlert,
  MessageSquare,
  PenLine,
  Power,
  Send,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { bn, t, tf, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { measure } from '@/lib/gsm7';
import { cn } from '@/lib/utils';
import { useUrlSearch, useUrlState } from '@/lib/use-url-state';
import {
  useGetSmsLogQuery,
  useGetSmsLogsInfiniteQuery,
  useGetSmsOverviewQuery,
  useResendSmsMutation,
  useSendTestSmsMutation,
  useToggleSmsMutation,
  type SmsOverviewData,
} from '@/lib/store/endpoints/people';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  FilteredEmpty,
  PageHeader,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
  type Tone,
} from '@/components/ui/layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PhoneField } from '@/components/ui/phone-field';
import { Modal } from '@/components/ui/modal';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { ListSkeleton, StatSkeleton } from '@/components/ui/skeleton';
import { SearchInput, Segmented, Toolbar, ToolbarSpacer } from '@/components/ui/toolbar';
import { useToast } from '@/components/ui/toast';
import { LoadMore } from '@/components/ui/load-more';
import type { SmsLog, SmsLogDetail, SmsStatus } from '@/lib/types';

/**
 * The owner's SMS panel: one switch, and the record of every message.
 *
 * The switch is the reason this page exists. SMS is the only thing in this app
 * that spends money every time it happens, and the owner needs to be able to
 * stop it for everybody in one tap, from a phone, without hunting through a
 * settings form. So it is the first thing on the page and turning it off saves
 * on the tap; turning it on, which starts spending, asks first.
 *
 * The record is the other half. "Did that customer get their text" used to be
 * answerable only by ringing the customer; now every attempt is a row, including
 * the ones that never left the building, and the gateway's own reply is kept
 * against each one.
 */

/* ------------------------------------------------------------ vocabulary -- */

const STATUS_LABEL: Record<SmsStatus, DictKey> = {
  sent: 'sms.statusSent',
  failed: 'sms.statusFailed',
  blocked: 'sms.statusBlocked',
};

const STATUS_TONE: Record<SmsStatus, Tone> = {
  sent: 'success',
  failed: 'danger',
  // Not a failure. A blocked message is the switch doing its job, and colouring
  // it red would have the owner chasing a problem they created on purpose.
  blocked: 'warning',
};

const PURPOSE_LABEL: Record<string, DictKey> = {
  notification: 'sms.purposeNotification',
  test: 'sms.purposeTest',
  manual: 'sms.purposeManual',
  otp: 'sms.purposeOtp',
  owner_alert: 'sms.purposeOwnerAlert',
  customer: 'sms.purposeCustomer',
};

const REASON_LABEL: Record<string, DictKey> = {
  feature_off: 'sms.reasonFeatureOff',
  not_configured: 'sms.reasonNotConfigured',
  no_credits: 'sms.reasonNoCredits',
  no_recipient: 'sms.reasonNoRecipient',
  empty_text: 'sms.reasonEmptyText',
};

/** What to do about a blocked message, by why it was blocked. */
const REASON_FIX: Record<string, DictKey> = {
  feature_off: 'smsPanel.fixFeatureOff',
  not_configured: 'smsPanel.fixNotConfigured',
  no_credits: 'smsPanel.fixNoCredits',
  no_recipient: 'smsPanel.fixNoRecipient',
  empty_text: 'smsPanel.fixEmptyText',
};

/** What one row says happened, in one phrase. */
function outcomeOf(log: Pick<SmsLog, 'status' | 'blockedReason'>): string {
  if (log.status === 'blocked' && log.blockedReason && REASON_LABEL[log.blockedReason]) {
    return t(REASON_LABEL[log.blockedReason]);
  }
  return STATUS_LABEL[log.status] ? t(STATUS_LABEL[log.status]) : log.status;
}

const purposeOf = (purpose: string) => t(PURPOSE_LABEL[purpose] ?? 'sms.purposeNotification');

/** An event identifier such as `order.shipped`, in Bengali when the dictionary has it. */
function eventOf(eventType: string | null): string | undefined {
  if (!eventType) return undefined;
  const key = `event.${eventType}`;
  return key in bn ? t(key as DictKey) : eventType;
}

/**
 * The start of the thirty-day window, to the hour. Rounded so that the request,
 * and so its cache entry, stays the same for a whole hour instead of changing
 * on every render; the overview counts the same thirty days.
 */
function thirtyDaysAgo(): string {
  const at = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  at.setMinutes(0, 0, 0);
  return at.toISOString();
}

/* ------------------------------------------------------------------ page -- */

type Filter = SmsStatus | 'all';
const FILTERS: Filter[] = ['all', 'sent', 'failed', 'blocked'];

export default function OwnerSmsPage() {
  const [filters, setFilters, { reset }] = useUrlState({ status: 'all', window: '30', purpose: '' });
  const { input, setInput, term } = useUrlSearch();
  const status: Filter = FILTERS.includes(filters.status as Filter) ? (filters.status as Filter) : 'all';
  const recent = filters.window !== 'all';
  const [since] = useState(thirtyDaysAgo);
  const [open, setOpen] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const overview = useGetSmsOverviewQuery();

  // A page at a time: the log grows by one row per message, forever.
  const logs = useGetSmsLogsInfiniteQuery({
    status: status === 'all' ? undefined : status,
    q: term,
    purpose: filters.purpose || undefined,
    from: recent ? since : undefined,
  });

  const rows = logs.data?.pages.flatMap((page) => page.logs) ?? [];
  const logTotal = logs.data?.pages[0]?.total ?? 0;
  const switching = logs.isFetching && !logs.isFetchingNextPage && !logs.currentData;
  const stats = overview.data?.stats;
  const filtered = Boolean(term || status !== 'all' || filters.purpose || !recent);

  /*
   * The counts on the filter are the overview's thirty-day counts, so they are
   * shown only while the list covers the same thirty days. They used to sit on
   * an all-time list and disagree with it.
   */
  const countOf = (value: Filter): number | undefined => {
    if (!recent || !stats || filters.purpose || term) return undefined;
    const { sent, failed, blocked } = stats.last30;
    return value === 'all' ? sent + failed + blocked : stats.last30[value];
  };

  return (
    <>
      <PageHeader
        title={t('sms.title')}
        subtitle={t('sms.help')}
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={'/owner/settings#customer-sms' as Route} variant="outline">
              <PenLine aria-hidden className="h-4 w-4" />
              {t('smsPanel.templates')}
            </ButtonLink>
            <Button variant="outline" onClick={() => setTesting(true)}>
              <Send aria-hidden className="h-4 w-4" />
              {t('sms.test')}
            </Button>
          </div>
        }
      />

      {overview.isError && !overview.data ? (
        <div className="mb-4">
          <ErrorState onRetry={() => overview.refetch()} isRetrying={overview.isFetching} error={overview.error} />
        </div>
      ) : (
        <MasterSwitch overview={overview.data} />
      )}

      {overview.isLoading ? (
        <StatSkeleton count={4} />
      ) : stats ? (
        /*
         * Two across on a phone rather than one. These are small counts and a
         * single column of them pushes the log, which is the reason the page
         * was opened, below two screens of scrolling.
         */
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={t('sms.sentToday')}
            value={formatNumber(stats.sentToday)}
            icon={MessageSquare}
            tone="primary"
          />
          <Stat label={t('sms.sent30')} value={formatNumber(stats.last30.sent)} />
          <Stat
            label={t('sms.failed30')}
            value={formatNumber(stats.last30.failed)}
            tone={stats.last30.failed > 0 ? 'danger' : 'neutral'}
            icon={stats.last30.failed > 0 ? TriangleAlert : undefined}
          />
          {overview.data?.spent30d != null ? (
            <Stat
              label={t('smsPanel.spent30')}
              value={formatMoney(overview.data.spent30d)}
              icon={Wallet}
              hint={
                overview.data.costPerSegment != null
                  ? tf('smsPanel.perSegment', { amount: formatMoney(overview.data.costPerSegment) })
                  : undefined
              }
            />
          ) : (
            <Stat
              label={t('sms.creditsOut')}
              value={formatNumber(stats.resellerCredits)}
              hint={`${t('sms.pricePerCredit')} ${formatMoney(overview.data?.pricePerCredit ?? 0)}`}
            />
          )}
        </div>
      ) : null}

      <Card id="sms-log">
        <CardHeader title={t('sms.log')} subtitle={t('sms.logHelp')} />

        {filters.purpose && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-primary-softer px-3 py-1 text-sm text-primary-ink">
            <span className="min-w-0 truncate font-medium">
              {tf('smsPanel.onlyPurpose', { purpose: purposeOf(filters.purpose) })}
            </span>
            <button
              type="button"
              onClick={() => setFilters({ purpose: '' })}
              className="tap inline-flex shrink-0 items-center gap-1 rounded-lg px-2 font-semibold hover:bg-primary-soft"
            >
              <X aria-hidden className="h-4 w-4" />
              {t('app.clearFilters')}
            </button>
          </div>
        )}

        <Toolbar>
          <Segmented<Filter>
            label={t('app.status')}
            value={status}
            onChange={(value) => setFilters({ status: value })}
            options={FILTERS.map((value) => ({
              value,
              label: value === 'all' ? t('app.all') : t(STATUS_LABEL[value]),
              count: countOf(value),
            }))}
          />
          <Segmented
            label={t('smsPanel.window')}
            value={recent ? '30' : 'all'}
            onChange={(value) => setFilters({ window: value })}
            options={[
              { value: '30', label: t('smsPanel.last30') },
              { value: 'all', label: t('smsPanel.allTime') },
            ]}
          />
          <ToolbarSpacer />
          <SearchInput value={input} onChange={setInput} placeholder={t('sms.search')} />
        </Toolbar>

        {logs.isLoading && <ListSkeleton rows={5} />}

        {logs.isError && rows.length === 0 && (
          <ErrorState onRetry={() => logs.refetch()} isRetrying={logs.isFetching} error={logs.error} />
        )}

        {logs.isSuccess && rows.length === 0 &&
          (filtered ? (
            <FilteredEmpty
              onClear={() => {
                setInput('');
                reset();
              }}
            />
          ) : (
            <EmptyState icon={MessageSquare} title={t('sms.none')} description={t('sms.noneHelp')} />
          ))}

        {rows.length > 0 && (
          <div className={cn('transition-opacity', switching && 'opacity-60')} aria-busy={switching || undefined}>
            {/* Cards below `lg`. Six columns do not belong on a phone. */}
            <div className="grid gap-3 lg:hidden">
              {rows.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => setOpen(log.id)}
                  className="card card-interactive min-w-0 p-4 text-left"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="tabular text-sm font-semibold">{log.phone}</span>
                    <Badge tone={STATUS_TONE[log.status]} dot>
                      {outcomeOf(log)}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 break-words text-sm text-muted-foreground">{log.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDateTime(log.createdAt)}</span>
                    <span>{purposeOf(log.purpose)}</span>
                    {log.resellerName && <span className="truncate">{log.resellerName}</span>}
                    <span className="tabular">
                      {formatNumber(log.segments)} {t('sms.segments')}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <TableWrap from="lg">
              <thead>
                <tr>
                  <Th>{t('app.date')}</Th>
                  <Th>{t('sms.recipient')}</Th>
                  <Th>{t('sms.message')}</Th>
                  <Th>{t('sms.shop')}</Th>
                  <Th className="text-right">{t('sms.segments')}</Th>
                  <Th>{t('app.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  /*
                   * A row that opens a sheet, reachable and operable from the
                   * keyboard like the button it behaves as.
                   */
                  <Tr
                    key={log.id}
                    className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                    tabIndex={0}
                    role="button"
                    aria-label={`${log.phone} · ${outcomeOf(log)}`}
                    onClick={() => setOpen(log.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setOpen(log.id);
                      }
                    }}
                  >
                    <Td className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </Td>
                    <Td className="tabular whitespace-nowrap text-sm font-medium">{log.phone}</Td>
                    <Td className="max-w-md">
                      <span className="line-clamp-1 text-sm">{log.text}</span>
                      <span className="text-xs text-muted-foreground">{purposeOf(log.purpose)}</span>
                    </Td>
                    <Td className="text-sm text-muted-foreground">{log.resellerName ?? '—'}</Td>
                    <Td className="tabular text-right text-sm">{formatNumber(log.segments)}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[log.status]} dot>
                        {outcomeOf(log)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>

            <LoadMore
              hasMore={Boolean(logs.hasNextPage)}
              loading={logs.isFetchingNextPage}
              onLoadMore={() => logs.fetchNextPage()}
              error={logs.isFetchNextPageError ? logs.error : null}
              shown={rows.length}
              total={logTotal}
            />
          </div>
        )}
      </Card>

      {open && (
        <LogDetail key={open} id={open} smsEnabled={overview.data?.enabled} onClose={() => setOpen(null)} />
      )}
      {testing && <TestSend onClose={() => setTesting(false)} />}
    </>
  );
}

/* ---------------------------------------------------------------- switch -- */

/**
 * The master switch.
 *
 * Off saves on the tap, with no draft and no Save button: the reason to touch
 * it is nearly always that something is going wrong right now. On asks first,
 * because it starts spending resellers' credits and the gateway balance.
 */
function MasterSwitch({ overview }: { overview?: SmsOverviewData }) {
  const toast = useToast();
  const [toggle, toggling] = useToggleSmsMutation();
  const [confirmingOn, setConfirmingOn] = useState(false);

  if (!overview) {
    return (
      <Card className="mb-4">
        <ListSkeleton rows={1} />
      </Card>
    );
  }

  const enabled = overview.enabled;

  const turnOff = async () => {
    try {
      await toggle({ enabled: false }).unwrap();
      toast(t('smsPanel.turnedOff'));
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('sms.master')}
        subtitle={
          overview.configured
            ? `${t('sms.senderId')}: ${overview.senderId ?? '—'}`
            : t('sms.notConfigured')
        }
        action={
          overview.configured && overview.balance !== null ? (
            <span className="text-right">
              {/* A count of messages, never taka: the gateway sells messages. */}
              <span
                className={cn(
                  'tabular block text-sm font-bold',
                  overview.balanceLow && 'text-danger'
                )}
              >
                {tf('smsPanel.balanceCount', { n: formatNumber(overview.balance) })}
              </span>
              <span className="block text-[0.6875rem] text-muted-foreground">{t('sms.balance')}</span>
            </span>
          ) : undefined
        }
      />

      {!overview.configured && (
        <Alert tone="warning" icon={CircleAlert} title={t('sms.notConfigured')}>
          {t('sms.notConfiguredHelp')}
        </Alert>
      )}

      {overview.configured && overview.balanceLow && (
        <Alert tone="danger" icon={TriangleAlert} title={t('smsPanel.lowBalanceTitle')}>
          {tf('smsPanel.lowBalance', { n: formatNumber(overview.lowBalanceAt ?? 0) })}
        </Alert>
      )}

      {/*
        The gateway being unreachable is not the same as SMS being broken, and it
        must not stop the page rendering, so it is a line rather than an error
        screen. Everything else here still works while Automas is down.
      */}
      {overview.configured && overview.balanceError && (
        <Alert tone="neutral" icon={CircleAlert}>
          {t('sms.balanceFailed')}
        </Alert>
      )}

      <Switch
        checked={enabled}
        disabled={toggling.isLoading}
        onChange={(next) => (next ? setConfirmingOn(true) : turnOff())}
        label={t('sms.master')}
        hint={enabled ? t('sms.masterOnHint') : t('sms.masterOffHint')}
      />

      {!enabled && (
        <Alert tone="warning" icon={Power} title={t('sms.offNotice')} className="mt-3">
          {t('sms.offNoticeHelp')}
        </Alert>
      )}

      {confirmingOn && (
        <ConfirmSheet
          title={t('smsPanel.turnOnTitle')}
          tone="primary"
          confirmLabel={t('smsPanel.turnOn')}
          onClose={() => setConfirmingOn(false)}
          onConfirm={async () => {
            await toggle({ enabled: true }).unwrap();
            toast(t('smsPanel.turnedOn'));
          }}
          consequences={[
            t('smsPanel.turnOnSends'),
            t('smsPanel.turnOnCost'),
            ...(overview.configured ? [] : [t('smsPanel.turnOnNoGateway')]),
          ]}
        />
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- detail -- */

/** One line of the detail sheet. Nothing renders for a value that is not there. */
function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-sm">{value}</span>
    </div>
  );
}

/**
 * Everything known about one message, including what the gateway said back.
 *
 * The raw reply is shown verbatim rather than prettified. When this screen is
 * open it is because something did not arrive, and at that point a faithful copy
 * of the bytes is worth more than a tidy summary of them.
 */
function LogDetail({
  id,
  smsEnabled,
  onClose,
}: {
  id: string;
  smsEnabled?: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const log = useGetSmsLogQuery({ id });
  const [resend, resending] = useResendSmsMutation();
  const row = log.data?.log;

  // A sign-in code is logged masked and a test is sent again from the test form.
  const resendable = row ? row.resendable !== false && row.purpose !== 'otp' && row.purpose !== 'test' : false;
  const canResend = Boolean(row) && row!.status !== 'sent' && resendable;

  const doResend = async () => {
    try {
      const { result } = await resend({ id }).unwrap();
      if (result.status === 'sent') toast(t('sms.resent'));
      else toast(tf('smsPanel.resendOutcome', { outcome: outcomeOf(result) }), 'danger');
      onClose();
    } catch (error) {
      toast(
        error instanceof ApiError && error.code === 'SMS_NOT_RESENDABLE'
          ? t('smsPanel.notResendable')
          : errorMessage(error),
        'danger'
      );
    }
  };

  /** Why a blocked message stopped, and what would let a resend through. */
  const fix =
    row?.status === 'blocked' && row.blockedReason && REASON_FIX[row.blockedReason]
      ? row.blockedReason === 'feature_off' && smsEnabled
        ? t('smsPanel.fixFeatureNowOn')
        : t(REASON_FIX[row.blockedReason])
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('sms.detail')}
      footer={
        canResend ? (
          <Button loading={resending.isLoading} onClick={doResend} full>
            {t('sms.resend')}
          </Button>
        ) : undefined
      }
      footerLead={
        canResend ? (
          <p className="text-xs text-muted-foreground">{t('sms.resendHelp')}</p>
        ) : row && row.status !== 'sent' && !resendable ? (
          <p className="text-xs text-muted-foreground">{t('smsPanel.notResendable')}</p>
        ) : undefined
      }
    >
      {log.isLoading && <ListSkeleton rows={4} />}
      {log.isError && <ErrorState onRetry={() => log.refetch()} isRetrying={log.isFetching} error={log.error} />}

      {row && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="tabular text-base font-bold">{row.phone}</span>
            <Badge tone={STATUS_TONE[row.status]} dot>
              {outcomeOf(row)}
            </Badge>
          </div>

          <div className="mb-4 break-words rounded-xl bg-subtle p-3 text-sm">{row.text}</div>

          {fix && (
            <Alert tone="warning" icon={Ban}>
              {fix}
            </Alert>
          )}

          {row.error && row.status !== 'blocked' && (
            <Alert tone="danger" icon={Ban}>
              <span className="break-words">{row.error}</span>
            </Alert>
          )}

          <Row label={t('app.date')} value={formatDateTime(row.createdAt)} />
          <Row label={t('sms.shop')} value={row.resellerName} />
          <Row label={t('smsPanel.purpose')} value={purposeOf(row.purpose)} />
          <Row label={t('sms.event')} value={eventOf(row.eventType)} />
          <Row label={t('sms.senderId')} value={row.senderId} />
          <Row
            label={t('sms.encoding')}
            value={row.encoding === 'unicode' ? t('sms.encodingUnicode') : t('sms.encodingGsm')}
          />
          <Row
            label={t('sms.segments')}
            value={<span className="tabular">{formatNumber(row.segments)}</span>}
          />
          <Row
            label={t('sms.credits')}
            value={
              row.creditsCharged > 0 ? (
                <span className="tabular">
                  {formatNumber(row.creditsCharged)}
                  {row.creditsRefunded > 0 && ` (${t('sms.refunded')})`}
                </span>
              ) : undefined
            }
          />
          <Row label={t('sms.providerId')} value={row.providerMessageId} />
          <Row
            label={t('sms.providerCode')}
            value={
              row.providerStatusCode === null ? undefined : (
                <span className="tabular">{row.providerStatusCode}</span>
              )
            }
          />
          <Row
            label={t('sms.duration')}
            value={
              row.durationMs === null ? undefined : (
                <span className="tabular">{tf('smsPanel.durationMs', { n: formatNumber(row.durationMs) })}</span>
              )
            }
          />

          {row.providerRaw && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">{t('sms.providerReply')}</p>
              {/* Its own scroller. A gateway that answers with an HTML page would
                * otherwise make the whole sheet scroll sideways. */}
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-subtle p-3 text-xs">
                {row.providerRaw}
              </pre>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ test -- */

/**
 * A test message to a number the owner picks.
 *
 * The one send that ignores the master switch, because the alternative is
 * turning SMS on for every reseller in order to find out whether the credentials
 * work. It is charged to nobody and logged as a test, so it stays out of the
 * delivery figures.
 */
function TestSend({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState<SmsLogDetail | null>(null);
  const [send, sending] = useSendTestSmsMutation();

  const errors = fieldErrors(sending.error);
  const phoneMissing = tried && !phone.trim();
  const textMissing = tried && !text.trim();

  /*
   * What it will cost, counted the way the gateway bills: one Bengali letter
   * makes the whole message Unicode, at 70 characters a part against 160.
   * Shown while typing, the only moment the number can still change anything.
   */
  const cost = text ? measure(text) : null;

  const submit = async () => {
    setTried(true);
    if (!phone.trim() || !text.trim()) return;
    try {
      const data = await send({ phone, text }).unwrap();
      setResult(data.result);
      if (data.result.status === 'sent') toast(t('smsPanel.testSent'));
      else toast(tf('smsPanel.testOutcome', { outcome: outcomeOf(data.result) }), 'danger');
    } catch (error) {
      if (Object.keys(fieldErrors(error)).length === 0) toast(errorMessage(error), 'danger');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('sms.test')}
      dirty={Boolean(text) && !result}
      footerLead={
        cost ? (
          <p className={cn('tabular text-xs', cost.encoding === 'UCS-2' ? 'text-warning-ink' : 'text-muted-foreground')}>
            {tf('smsPanel.estimate', {
              chars: formatNumber(cost.chars),
              segments: formatNumber(cost.segments),
              encoding: cost.encoding === 'UCS-2' ? t('smsPanel.encodingBn') : t('smsPanel.encodingEn'),
            })}
          </p>
        ) : undefined
      }
      footer={
        <Button loading={sending.isLoading} onClick={submit} full>
          <Send aria-hidden className="h-4 w-4" />
          {t('sms.testSend')}
        </Button>
      }
    >
      <Alert tone="neutral" icon={CircleAlert}>
        {t('sms.testWhileOff')}
      </Alert>

      {sending.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(sending.error)}</Alert>
      )}

      {/*
        The gateway refusing the message is not a failed request: the API answers
        200 with a row saying what went wrong. So the outcome is read off the row
        rather than off the mutation, which would report success either way.
      */}
      {result && (
        <Alert
          tone={result.status === 'sent' ? 'success' : 'danger'}
          title={outcomeOf(result)}
          icon={result.status === 'sent' ? undefined : Ban}
        >
          <span className="break-words">
            {result.status === 'sent'
              ? `${t('sms.providerId')}: ${result.providerMessageId ?? '—'}`
              : (result.error ?? '')}
          </span>
        </Alert>
      )}

      <PhoneField
        id="testPhone"
        label={t('sms.recipient')}
        value={phone}
        onChange={setPhone}
        error={errors.phone ?? (phoneMissing ? t('smsPanel.phoneRequired') : undefined)}
        autoComplete="off"
        required
      />

      <Field
        label={t('sms.testText')}
        htmlFor="testText"
        error={errors.text ?? (textMissing ? t('smsPanel.textRequired') : undefined)}
        hint={t('smsPanel.testTextHint')}
        required
      >
        <Textarea
          id="testText"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          invalid={Boolean(errors.text) || textMissing}
        />
      </Field>

      <Link
        href={'/owner/settings#customer-sms' as Route}
        className="tap inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"
      >
        <PenLine aria-hidden className="h-4 w-4" />
        {t('smsPanel.templates')}
      </Link>
    </Modal>
  );
}
