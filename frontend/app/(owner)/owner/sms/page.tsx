'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CircleAlert,
  MessageSquare,
  Power,
  Send,
  TriangleAlert,
} from 'lucide-react';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
  type Tone,
} from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { PhoneField } from '@/components/ui/phone-field';
import { Modal } from '@/components/ui/modal';
import { ListSkeleton } from '@/components/ui/skeleton';
import { SearchInput, Segmented, Toolbar } from '@/components/ui/toolbar';
import { useToast } from '@/components/ui/toast';
import type { SmsLog, SmsLogDetail, SmsOverview, SmsStatus } from '@/lib/types';

/**
 * The owner's SMS panel: one switch, and the record of every message.
 *
 * The switch is the reason this page exists. SMS is the only thing in this app
 * that spends money every time it happens, and the owner needs to be able to
 * stop it for everybody in one tap, from a phone, without hunting through a
 * settings form. So it is the first thing on the page and it saves on the tap
 * rather than waiting for a Save button at the bottom.
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
};

const REASON_LABEL: Record<string, DictKey> = {
  feature_off: 'sms.reasonFeatureOff',
  not_configured: 'sms.reasonNotConfigured',
  no_credits: 'sms.reasonNoCredits',
  no_recipient: 'sms.reasonNoRecipient',
  empty_text: 'sms.reasonEmptyText',
};

/** What one row says happened, in one phrase. */
function outcomeOf(log: SmsLog): string {
  if (log.status === 'blocked' && log.blockedReason && REASON_LABEL[log.blockedReason]) {
    return t(REASON_LABEL[log.blockedReason]);
  }
  return t(STATUS_LABEL[log.status]);
}

/* ------------------------------------------------------------------ page -- */

type Filter = SmsStatus | 'all';

export default function OwnerSmsPage() {
  const [status, setStatus] = useState<Filter>('all');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const search = useDebounced(term, 300);

  const overview = useQuery({
    queryKey: ['owner', 'sms', 'overview'],
    queryFn: () => api.get<SmsOverview>('/owner/sms/overview'),
  });

  const logs = useQuery({
    queryKey: ['owner', 'sms', 'logs', status, search],
    queryFn: () =>
      api.get<{ logs: SmsLog[]; total: number }>(
        `/owner/sms/logs?limit=50${status === 'all' ? '' : `&status=${status}`}${
          search ? `&q=${encodeURIComponent(search)}` : ''
        }`
      ),
  });

  const rows = logs.data?.logs ?? [];
  const stats = overview.data?.stats;

  return (
    <>
      <PageHeader
        title={t('sms.title')}
        subtitle={t('sms.help')}
        action={
          <Button variant="outline" onClick={() => setTesting(true)}>
            <Send className="h-4 w-4" />
            {t('sms.test')}
          </Button>
        }
      />

      <MasterSwitch overview={overview.data} loading={overview.isLoading} />

      {stats && (
        /*
         * Two across on a phone rather than one. These are four small counts and
         * a single column of them pushes the log, which is the reason the page
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
          <Stat
            label={t('sms.creditsOut')}
            value={formatNumber(stats.resellerCredits)}
            hint={`${t('sms.pricePerCredit')} ${formatMoney(overview.data?.pricePerCredit ?? 0)}`}
          />
        </div>
      )}

      <Card>
        <CardHeader title={t('sms.log')} subtitle={t('sms.logHelp')} />

        <Toolbar>
          <Segmented<Filter>
            label={t('app.status')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('app.all') },
              { value: 'sent', label: t('sms.statusSent') },
              { value: 'failed', label: t('sms.statusFailed'), count: stats?.last30.failed },
              { value: 'blocked', label: t('sms.statusBlocked'), count: stats?.last30.blocked },
            ]}
          />
          <SearchInput value={term} onChange={setTerm} placeholder={t('sms.search')} />
        </Toolbar>

        {logs.isLoading && <ListSkeleton rows={5} />}

        {logs.isError && <ErrorState onRetry={() => logs.refetch()} isRetrying={logs.isFetching} />}

        {logs.isSuccess && rows.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title={search || status !== 'all' ? t('app.noResults') : t('sms.none')}
            description={search || status !== 'all' ? undefined : t('sms.noneHelp')}
          />
        )}

        {rows.length > 0 && (
          <>
            {/* Cards below `lg`. Eight columns do not belong on a phone. */}
            <div className="grid gap-3 lg:hidden">
              {rows.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => setOpen(log.id)}
                  className="card card-interactive p-4 text-left"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="tabular text-sm font-semibold">{log.phone}</span>
                    <Badge tone={STATUS_TONE[log.status]} dot>
                      {outcomeOf(log)}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{log.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDateTime(log.createdAt)}</span>
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
                  <Tr key={log.id} className="cursor-pointer" onClick={() => setOpen(log.id)}>
                    <Td className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </Td>
                    <Td className="tabular whitespace-nowrap text-sm font-medium">{log.phone}</Td>
                    <Td className="max-w-md">
                      <span className="line-clamp-1 text-sm">{log.text}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(PURPOSE_LABEL[log.purpose] ?? 'sms.purposeNotification')}
                      </span>
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
          </>
        )}
      </Card>

      <LogDetail id={open} onClose={() => setOpen(null)} />
      <TestSend open={testing} onClose={() => setTesting(false)} />
    </>
  );
}

/* ---------------------------------------------------------------- switch -- */

/**
 * The master switch, saved on the tap.
 *
 * No draft and no Save button, unlike the settings form this used to live in.
 * The reason to touch this control is nearly always that something is going
 * wrong right now, and a switch that needs a second confirming tap somewhere
 * further down the page is a switch that gets left half-thrown.
 */
function MasterSwitch({ overview, loading }: { overview?: SmsOverview; loading: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.post('/owner/sms/toggle', { enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'sms'] });
      // The settings page reads the same flag, so its cache is stale from here.
      await queryClient.invalidateQueries({ queryKey: ['owner', 'settings'] });
      toast(t('app.saved'));
    },
  });

  if (loading || !overview) {
    return (
      <Card className="mb-4">
        <ListSkeleton rows={1} />
      </Card>
    );
  }

  const enabled = overview.enabled;

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
              <span className="tabular block text-sm font-bold">
                {formatNumber(overview.balance)}
              </span>
              <span className="block text-[0.6875rem] text-muted-foreground">
                {t('sms.balance')}
              </span>
            </span>
          ) : undefined
        }
      />

      {!overview.configured && (
        <Alert tone="warning" icon={CircleAlert} title={t('sms.notConfigured')}>
          {t('sms.notConfiguredHelp')}
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
        disabled={toggle.isPending}
        onChange={(next) => toggle.mutate(next)}
        label={t('sms.master')}
        hint={enabled ? t('sms.masterOnHint') : t('sms.masterOffHint')}
      />

      {toggle.error && <Alert tone="danger">{errorMessage(toggle.error)}</Alert>}

      {!enabled && (
        <Alert tone="warning" icon={Power} title={t('sms.offNotice')} className="mt-3">
          {t('sms.offNoticeHelp')}
        </Alert>
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
function LogDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const log = useQuery({
    queryKey: ['owner', 'sms', 'log', id],
    queryFn: () => api.get<{ log: SmsLogDetail }>(`/owner/sms/logs/${id}`),
    enabled: Boolean(id),
  });

  const resend = useMutation({
    mutationFn: () => api.post(`/owner/sms/logs/${id}/resend`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'sms'] });
      toast(t('sms.resent'));
      onClose();
    },
  });

  const row = log.data?.log;

  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      title={t('sms.detail')}
      footer={
        row && row.status !== 'sent' ? (
          <Button loading={resend.isPending} onClick={() => resend.mutate()} full>
            {t('sms.resend')}
          </Button>
        ) : undefined
      }
      footerLead={row && row.status !== 'sent' ? t('sms.resendHelp') : undefined}
    >
      {log.isLoading && <ListSkeleton rows={4} />}
      {log.isError && <ErrorState onRetry={() => log.refetch()} isRetrying={log.isFetching} />}

      {row && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="tabular text-base font-bold">{row.phone}</span>
            <Badge tone={STATUS_TONE[row.status]} dot>
              {outcomeOf(row)}
            </Badge>
          </div>

          <div className="mb-4 rounded-xl bg-subtle p-3 text-sm">{row.text}</div>

          {row.error && (
            <Alert tone={row.status === 'blocked' ? 'warning' : 'danger'} icon={Ban}>
              {row.error}
            </Alert>
          )}

          {resend.error && <Alert tone="danger">{errorMessage(resend.error)}</Alert>}

          <Row label={t('app.date')} value={formatDateTime(row.createdAt)} />
          <Row label={t('sms.shop')} value={row.resellerName} />
          <Row
            label={t('sms.purposeNotification')}
            value={t(PURPOSE_LABEL[row.purpose] ?? 'sms.purposeNotification')}
          />
          <Row label={t('sms.event')} value={row.eventType} />
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
            value={row.durationMs === null ? undefined : <span className="tabular">{row.durationMs} ms</span>}
          />

          {row.providerRaw && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted-foreground">{t('sms.providerReply')}</p>
              {/* Its own scroller. A gateway that answers with an HTML page would
                * otherwise make the whole sheet scroll sideways. */}
              <pre className="max-h-40 overflow-auto rounded-xl bg-subtle p-3 text-xs">
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
function TestSend({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<SmsLogDetail | null>(null);

  const send = useMutation({
    mutationFn: () => api.post<{ result: SmsLogDetail }>('/owner/sms/test', { phone, text }),
    onSuccess: async (data) => {
      setResult(data.result);
      await queryClient.invalidateQueries({ queryKey: ['owner', 'sms'] });
      if (data.result.status === 'sent') toast(t('sms.resent'));
    },
  });

  const close = () => {
    setResult(null);
    send.reset();
    onClose();
  };

  const errors = fieldErrors(send.error);

  // Bengali caps a segment at 70 characters against 160, so the same sentence
  // costs twice as much. Saying so while it is being typed is the only moment
  // the number can still change anything.
  const unicode = /[^\x00-\x7F]/.test(text);
  const segments = text ? Math.ceil(text.length / (unicode ? 70 : 160)) : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('sms.test')}
      dirty={Boolean(text) && !result}
      footerLead={
        segments > 0 ? (
          <span className="tabular">
            {formatNumber(segments)} {t('sms.costHint')}
          </span>
        ) : undefined
      }
      footer={
        <Button
          loading={send.isPending}
          disabled={!phone || !text}
          onClick={() => send.mutate()}
          full
        >
          <Send className="h-4 w-4" />
          {t('sms.testSend')}
        </Button>
      }
    >
      <Alert tone="neutral" icon={CircleAlert}>
        {t('sms.testWhileOff')}
      </Alert>

      {send.error && !Object.keys(errors).length && (
        <Alert tone="danger">{errorMessage(send.error)}</Alert>
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
          {result.status === 'sent'
            ? `${t('sms.providerId')}: ${result.providerMessageId ?? '—'}`
            : (result.error ?? '')}
        </Alert>
      )}

      <PhoneField
        id="testPhone"
        label={t('sms.recipient')}
        value={phone}
        onChange={setPhone}
        error={errors.phone}
        autoComplete="off"
      />

      <Field label={t('sms.testText')} htmlFor="testText" error={errors.text}>
        <Textarea
          id="testText"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          invalid={Boolean(errors.text)}
        />
      </Field>
    </Modal>
  );
}
