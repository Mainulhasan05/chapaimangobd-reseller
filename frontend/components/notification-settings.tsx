'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight, Lock, MailWarning, Send } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import {
  useCreateTelegramLinkTokenMutation,
  useGetNotificationPreferencesQuery,
  useGetTelegramStatusQuery,
  useUnlinkTelegramMutation,
  useUpdateNotificationPreferenceMutation,
  useUpdateNotificationPreferencesMutation,
  type PreferenceChange,
} from '@/lib/store/endpoints/notifications';
import { useGetDashboardQuery } from '@/lib/store/endpoints/dashboard';
import { t, tf, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { NotificationPreferences, PreferenceChannel, Role } from '@/lib/types';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CopyButton,
  ErrorState,
  PageHeader,
} from '@/components/ui/layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { BackLink } from '@/components/ui/back-link';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { ListSkeleton, Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { PushCard } from '@/components/notifications-view';

/**
 * Where notifications go, for either role: the browser, Telegram, and which
 * events use which channel. The inbox itself stays on its own page; this is the
 * screen a person visits once and then leaves alone.
 */

type Base = '/reseller' | '/owner';

const CHANNELS: PreferenceChannel[] = ['push', 'telegram', 'sms'];

const TIME = new Intl.DateTimeFormat('bn-BD', {
  timeZone: 'Asia/Dhaka',
  hour: 'numeric',
  minute: '2-digit',
});

const eventName = (eventType: string) => {
  const key = `event.${eventType}` as DictKey;
  return t(key) ?? eventType;
};

export function NotificationSettings({ base }: { base: Base }) {
  const { data: session } = useSession();
  const role = base.slice(1) as Role;
  const inboxHref = base === '/owner' ? '/owner/notifications' : '/reseller/notifications';

  return (
    <>
      <BackLink fallback={inboxHref} label={t('nav.notifications')} />
      <PageHeader title={t('prefs.link')} />

      {base === '/owner' && <FailedDeliveriesLink />}
      <PushCard base={base} />
      {session?.features.telegram !== false && <TelegramCard role={role} />}
      <PreferencesCard role={role} />
    </>
  );
}

/* ------------------------------------------------------- failed deliveries -- */

/**
 * The way to the messages that never arrived. Shown only when there are some:
 * the dashboard's health panel counts them, and this is the screen where a
 * person thinking about delivery would look next.
 */
function FailedDeliveriesLink() {
  const { data } = useGetDashboardQuery();
  const count = data?.health.deadLetters ?? 0;
  if (count === 0) return null;

  return (
    <Link
      href={'/owner/notifications/failed' as Route}
      className="card mb-4 flex min-h-12 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
    >
      <MailWarning aria-hidden className="h-5 w-5 shrink-0 text-danger-ink" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t('prefs.failedLink')}</span>
        <span className="block text-xs text-muted-foreground">{t('prefs.failedLinkHint')}</span>
      </span>
      <Badge tone="danger">{formatNumber(count)}</Badge>
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/* --------------------------------------------------------------- telegram -- */

/**
 * Linking is a round trip through Telegram: a one-time token from the API, the
 * bot opened with it, Start pressed there. This page cannot see that happen, so
 * the status is re-read when the person comes back to the tab (the store
 * refetches on focus).
 *
 * The bot is opened by a real link the person taps, not by `window.open` after
 * the token request answers: by then the tap that started it is over, and
 * phone browsers block a window opened without one. The token lives fifteen
 * minutes; when it runs out the link is swapped for a "new link" button rather
 * than left to fail silently in Telegram.
 */
function TelegramCard({ role }: { role: Role }) {
  const toast = useToast();
  const status = useGetTelegramStatusQuery({ role });
  const [createToken, token] = useCreateTelegramLinkTokenMutation();
  const [unlink] = useUnlinkTelegramMutation();
  const [expired, setExpired] = useState(false);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  const expiresAt = token.data?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return undefined;
    const ms = new Date(expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => setExpired(true), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  const requestLink = async () => {
    setExpired(false);
    try {
      await createToken({ role }).unwrap();
    } catch (error) {
      toast(errorMessage(error), 'danger');
    }
  };

  const linked = status.data?.linked === true;
  const link = token.data && !expired ? token.data : null;

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('telegram.title')}
        subtitle={t('telegram.subtitle')}
        action={
          status.data && (
            <Badge tone={linked ? 'success' : 'neutral'} dot={linked}>
              {linked ? t('telegram.linked') : t('telegram.notLinked')}
            </Badge>
          )
        }
      />

      {status.isLoading && <Skeleton className="h-11 w-40" />}
      {status.isError && !status.data && (
        <ErrorState onRetry={() => status.refetch()} isRetrying={status.isFetching} error={status.error} />
      )}

      {status.data && !status.data.configured && (
        <Alert tone="warning">{t('telegram.notConfigured')}</Alert>
      )}

      {status.data?.configured && linked && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {status.data.linkedAt && (
            <p className="text-sm text-muted-foreground">
              {t('telegram.linkedSince')}: {formatDateTime(status.data.linkedAt)}
            </p>
          )}
          <Button size="sm" variant="outline" onClick={() => setConfirmingUnlink(true)}>
            {t('telegram.unlink')}
          </Button>
        </div>
      )}

      {status.data?.configured && !linked && (
        <>
          {expired && <Alert tone="warning">{t('telegram.expired')}</Alert>}

          {link && (
            <Alert tone="neutral">
              {link.deepLink ? (
                <>
                  <p>{t('telegram.linkReady')}</p>
                  <p className="mt-1 text-xs">
                    {tf('telegram.expiresAt', { time: TIME.format(new Date(link.expiresAt)) })}
                  </p>
                </>
              ) : (
                <span className="flex flex-wrap items-center gap-1">
                  {t('telegram.noBotUsername')}{' '}
                  <code lang="en" className="break-all font-mono">{`/start ${link.linkToken}`}</code>
                  <CopyButton
                    value={`/start ${link.linkToken}`}
                    onCopied={() => toast(t('app.copied'))}
                  />
                </span>
              )}
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            {link?.deepLink ? (
              <a
                href={link.deepLink}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ size: 'sm' })}
              >
                <Send className="h-4 w-4" />
                {t('telegram.open')}
              </a>
            ) : (
              !link && (
                <Button size="sm" loading={token.isLoading} onClick={requestLink}>
                  <Send className="h-4 w-4" />
                  {expired ? t('telegram.newLink') : t('telegram.connect')}
                </Button>
              )
            )}
            {link && (
              <Button
                size="sm"
                variant="outline"
                loading={status.isFetching}
                onClick={() => status.refetch()}
              >
                {t('telegram.checkStatus')}
              </Button>
            )}
          </div>
        </>
      )}

      {confirmingUnlink && (
        <ConfirmSheet
          title={t('telegram.unlinkTitle')}
          tone="danger"
          confirmLabel={t('telegram.unlink')}
          consequences={[t('telegram.unlinkConsequence')]}
          onClose={() => setConfirmingUnlink(false)}
          onConfirm={async () => {
            await unlink({ role }).unwrap();
            token.reset();
            toast(t('telegram.unlinked'));
          }}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ preferences -- */

/** Why a channel cannot be switched on, in words, or null when it can. */
function unavailableReason(
  channel: PreferenceChannel,
  data: NotificationPreferences,
  role: Role
): string | null {
  if (channel === 'sms' && !data.smsAvailable) {
    return role === 'owner' ? t('prefs.smsUnavailableOwner') : t('prefs.smsUnavailableReseller');
  }
  if (channel === 'telegram' && !data.channels.telegram.available) return t('prefs.telegramUnavailable');
  if (channel === 'push' && !data.channels.push.available) return t('prefs.pushOff');
  return null;
}

/**
 * Events down the side, channels across the top, one small switch where they
 * meet.
 *
 * Each event used to be a block with three full-width switches under it, so
 * the owner's eleven events made a page of thirty-three rows on a phone. A
 * grid of 44px switches fits a group on one screen at 360px, and the column
 * headings carry a group-wide "all on / all off" per channel, which is the
 * change people actually make ("no SMS for orders").
 *
 * A switch that cannot move says why: the reasons sit above the grid and each
 * disabled switch points at its reason for a screen reader. A failed change
 * flips back, names the event in a toast and stays marked on its row.
 */
function PreferencesCard({ role }: { role: Role }) {
  const toast = useToast();
  const prefs = useGetNotificationPreferencesQuery({ role });
  const [saveOne] = useUpdateNotificationPreferenceMutation();
  const [saveMany] = useUpdateNotificationPreferencesMutation();
  const [failed, setFailed] = useState<Record<string, string>>({});

  const data = prefs.data;

  const change = async (changes: PreferenceChange[]) => {
    const events = changes.map((c) => c.eventType);
    setFailed((current) => {
      const next = { ...current };
      events.forEach((event) => delete next[event]);
      return next;
    });
    try {
      if (changes.length === 1) await saveOne({ role, change: changes[0] }).unwrap();
      else await saveMany({ role, changes }).unwrap();
    } catch (error) {
      const message = errorMessage(error);
      setFailed((current) => ({
        ...current,
        ...Object.fromEntries(events.map((event) => [event, message])),
      }));
      toast(tf('prefs.saveFailed', { event: eventName(changes[0].eventType) }), 'danger');
    }
  };

  const reasons = data
    ? CHANNELS.map((channel) => ({ channel, reason: unavailableReason(channel, data, role) }))
    : [];
  const anyLocked = data?.groups.some((group) => group.events.some((row) => row.locked.length > 0));

  return (
    // Tighter on a phone, where the three switch columns need the width.
    <Card className="mb-4 p-4 sm:p-6">
      <CardHeader title={t('prefs.title')} subtitle={t('prefs.subtitle')} />

      {prefs.isLoading && <ListSkeleton rows={4} />}
      {prefs.isError && !data && (
        <ErrorState onRetry={() => prefs.refetch()} isRetrying={prefs.isFetching} error={prefs.error} />
      )}

      {data && (
        <>
          <ul className="mb-4 space-y-1 text-xs text-muted-foreground">
            {reasons.map(({ channel, reason }) =>
              reason ? (
                <li key={channel} id={`prefs-why-${channel}`}>
                  <span className="font-semibold text-foreground">
                    {t(`prefs.channel.${channel}` as DictKey)}:
                  </span>{' '}
                  {reason}
                </li>
              ) : null
            )}
            {data.smsAvailable && (
              <li>{role === 'owner' ? t('prefs.smsCostOwner') : t('prefs.smsCostReseller')}</li>
            )}
            {data.channels.telegram.available && !data.channels.telegram.linked && (
              <li>{t('prefs.telegramNotLinked')}</li>
            )}
            {anyLocked && (
              <li id="prefs-locked" className="flex items-center gap-1">
                <Lock aria-hidden className="h-3 w-3" />
                {t('prefs.locked')}
              </li>
            )}
          </ul>

          <div className="space-y-6">
            {data.groups.map((group) => {
              const groupName = t(`prefs.group.${group.key}` as DictKey);
              return (
                <section key={group.key} aria-label={groupName}>
                  <div className="flex items-end gap-1 border-b border-border pb-1">
                    <h3 className="min-w-0 flex-1 text-sm font-semibold">{groupName}</h3>
                    {CHANNELS.map((channel) => {
                      const reason = unavailableReason(channel, data, role);
                      const movable = group.events.filter((row) => !row.locked.includes(channel));
                      const allOn = movable.length > 0 && movable.every((row) => row[channel]);
                      const channelName = t(`prefs.channel.${channel}` as DictKey);
                      return (
                        <div key={channel} className="flex w-12 flex-col items-center">
                          <span className="text-center text-[0.6875rem] font-semibold text-muted-foreground">
                            {channelName}
                          </span>
                          <button
                            type="button"
                            disabled={Boolean(reason) || movable.length === 0}
                            onClick={() =>
                              change(movable.map((row) => ({ eventType: row.eventType, [channel]: !allOn })))
                            }
                            aria-label={tf('prefs.groupToggle', {
                              group: groupName,
                              channel: channelName,
                              state: allOn ? t('prefs.allOff') : t('prefs.allOn'),
                            })}
                            className="min-h-11 w-full rounded-lg text-[0.6875rem] font-semibold text-primary-ink hover:bg-muted disabled:text-muted-foreground disabled:opacity-50 disabled:hover:bg-transparent"
                          >
                            {allOn ? t('prefs.allOff') : t('prefs.allOn')}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <ul className="divide-y divide-border">
                    {group.events.map((row) => {
                      const name = eventName(row.eventType);
                      return (
                        <li key={row.eventType} className="py-1.5">
                          <div className="flex items-center gap-1">
                            <p className="min-w-0 flex-1 text-sm">{name}</p>
                            {CHANNELS.map((channel) => {
                              const locked = row.locked.includes(channel);
                              const reason = unavailableReason(channel, data, role);
                              return (
                                <ChannelSwitch
                                  key={channel}
                                  checked={row[channel]}
                                  locked={locked}
                                  disabled={locked || Boolean(reason)}
                                  label={`${name} — ${t(`prefs.channel.${channel}` as DictKey)}`}
                                  describedBy={
                                    locked ? 'prefs-locked' : reason ? `prefs-why-${channel}` : undefined
                                  }
                                  onChange={(checked) =>
                                    change([{ eventType: row.eventType, [channel]: checked }])
                                  }
                                />
                              );
                            })}
                          </div>
                          {failed[row.eventType] && (
                            <p role="alert" className="mt-0.5 text-xs font-medium text-danger">
                              {failed[row.eventType]}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * One switch in the grid: a 44px target around a small track. Named for a
 * screen reader by event and channel ("নতুন অর্ডার এসেছে — SMS"), because the
 * column heading it sits under is not announced with it.
 */
function ChannelSwitch({
  checked,
  locked,
  disabled,
  label,
  describedBy,
  onChange,
}: {
  checked: boolean;
  locked: boolean;
  disabled: boolean;
  label: string;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-11 w-12 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted disabled:hover:bg-transparent"
    >
      <span
        aria-hidden
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-input',
          disabled && !locked && 'opacity-40'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          )}
        >
          {locked && <Lock className="h-2.5 w-2.5 text-muted-foreground" />}
        </span>
      </span>
    </button>
  );
}

