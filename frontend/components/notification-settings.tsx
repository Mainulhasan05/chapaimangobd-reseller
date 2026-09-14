'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Lock, Send } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t, type DictKey } from '@/lib/i18n/bn';
import { formatDateTime } from '@/lib/format';
import type {
  NotificationPreferences,
  PreferenceChannel,
  TelegramLinkToken,
  TelegramStatus,
} from '@/lib/types';
import { Alert, Badge, Card, CardHeader, ErrorState, PageHeader } from '@/components/ui/layout';
import { Button, Spinner } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { PushCard } from '@/components/notifications-view';

/**
 * Where notifications go, for either role: the browser, Telegram, and which
 * events use which channel. The inbox itself stays on its own page; this is the
 * screen a person visits once and then leaves alone.
 */

type Base = '/reseller' | '/owner';

const CHANNELS: PreferenceChannel[] = ['push', 'telegram', 'sms'];

export function NotificationSettings({ base }: { base: Base }) {
  const { data: session } = useSession();
  const inboxHref = base === '/owner' ? '/owner/notifications' : '/reseller/notifications';

  return (
    <>
      <PageHeader
        title={t('prefs.link')}
        action={
          <Link href={inboxHref}>
            <Button size="sm" variant="outline">
              <ChevronLeft className="h-4 w-4" />
              {t('nav.notifications')}
            </Button>
          </Link>
        }
      />

      <PushCard base={base} />
      {session?.features.telegram !== false && <TelegramCard base={base} />}
      <PreferencesCard base={base} />
    </>
  );
}

/* --------------------------------------------------------------- telegram -- */

/**
 * Linking is a round trip through Telegram: a one-time token from the API, the
 * bot opened with it, Start pressed there. This page cannot see that happen, so
 * the status is re-read when the person comes back to the tab.
 */
function TelegramCard({ base }: { base: Base }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const status = useQuery({
    queryKey: ['telegram-status', base],
    queryFn: () => api.get<TelegramStatus>(`${base}/telegram`),
    refetchOnWindowFocus: 'always',
  });

  const link = useMutation({
    mutationFn: () => api.post<TelegramLinkToken>(`${base}/telegram/link-token`),
    onSuccess: (data) => {
      // Opened from the click itself, so a phone hands it to the Telegram app.
      if (data.deepLink) window.open(data.deepLink, '_blank', 'noopener,noreferrer');
    },
  });

  const unlink = useMutation({
    mutationFn: () => api.del(`${base}/telegram/link`),
    onSuccess: async () => {
      link.reset();
      await queryClient.invalidateQueries({ queryKey: ['telegram-status', base] });
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences', base] });
      toast(t('telegram.unlinked'));
    },
  });

  const linked = status.data?.linked === true;

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

      {status.isLoading && <Spinner />}
      {status.isError && (
        <ErrorState onRetry={() => status.refetch()} isRetrying={status.isFetching} error={status.error} />
      )}

      {status.data && !status.data.configured && (
        <Alert tone="warning">{t('telegram.notConfigured')}</Alert>
      )}

      {link.error && <Alert tone="danger">{errorMessage(link.error)}</Alert>}
      {unlink.error && <Alert tone="danger">{errorMessage(unlink.error)}</Alert>}

      {status.data?.configured && linked && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {status.data.linkedAt && (
            <p className="text-sm text-muted-foreground">
              {t('telegram.linkedSince')}: {formatDateTime(status.data.linkedAt)}
            </p>
          )}
          <Button size="sm" variant="outline" loading={unlink.isPending} onClick={() => unlink.mutate()}>
            {t('telegram.unlink')}
          </Button>
        </div>
      )}

      {status.data?.configured && !linked && (
        <>
          {link.data && (
            <Alert tone="neutral">
              {link.data.deepLink ? (
                t('telegram.openHelp')
              ) : (
                <>
                  {t('telegram.noBotUsername')}{' '}
                  <code lang="en" className="break-all font-mono">{`/start ${link.data.linkToken}`}</code>
                </>
              )}
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            {link.data?.deepLink ? (
              <a href={link.data.deepLink} target="_blank" rel="noreferrer">
                <Button size="sm">
                  <Send className="h-4 w-4" />
                  {t('telegram.open')}
                </Button>
              </a>
            ) : (
              <Button size="sm" loading={link.isPending} onClick={() => link.mutate()}>
                <Send className="h-4 w-4" />
                {t('telegram.connect')}
              </Button>
            )}
            {link.data && (
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
    </Card>
  );
}

/* ------------------------------------------------------------ preferences -- */

/**
 * A grouped list rather than a table: at 360px a row of three switches beside
 * a Bengali event name does not fit, so each event is a small block with its
 * switches underneath, and each group a card section.
 */
function PreferencesCard({ base }: { base: Base }) {
  const queryClient = useQueryClient();
  const key = ['notification-preferences', base];

  const prefs = useQuery({
    queryKey: key,
    queryFn: () => api.get<NotificationPreferences>(`${base}/notification-preferences`),
  });

  const save = useMutation({
    mutationFn: (change: { eventType: string } & Partial<Record<PreferenceChannel, boolean>>) =>
      api.put<NotificationPreferences>(`${base}/notification-preferences`, { events: [change] }),
    // Flipped on screen straight away; a failure puts the server's answer back.
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationPreferences>(key);
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(key, {
          ...previous,
          groups: previous.groups.map((group) => ({
            ...group,
            events: group.events.map((row) =>
              row.eventType === change.eventType ? { ...row, ...change } : row
            ),
          })),
        });
      }
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  const data = prefs.data;

  return (
    <Card className="mb-4">
      <CardHeader title={t('prefs.title')} subtitle={t('prefs.subtitle')} />

      {prefs.isLoading && <Spinner />}
      {prefs.isError && (
        <ErrorState onRetry={() => prefs.refetch()} isRetrying={prefs.isFetching} error={prefs.error} />
      )}
      {save.error && <Alert tone="danger">{errorMessage(save.error)}</Alert>}

      {data && (
        <>
          {!data.smsAvailable && (
            <Alert tone="neutral">
              {base === '/owner' ? t('prefs.smsUnavailableOwner') : t('prefs.smsUnavailableReseller')}
            </Alert>
          )}
          {data.smsAvailable && (
            <p className="mb-3 text-xs text-muted-foreground">
              {base === '/owner' ? t('prefs.smsCostOwner') : t('prefs.smsCostReseller')}
            </p>
          )}
          {data.channels.telegram.available && !data.channels.telegram.linked && (
            <p className="mb-3 text-xs text-muted-foreground">{t('prefs.telegramNotLinked')}</p>
          )}

          <div className="space-y-5">
            {data.groups.map((group) => (
              <section key={group.key}>
                <h3 className="mb-2 text-sm font-semibold">{t(`prefs.group.${group.key}` as DictKey)}</h3>
                <ul className="space-y-2">
                  {group.events.map((row) => (
                    <li key={row.eventType} className="rounded-xl bg-muted/60 px-3.5 py-2.5">
                      <p className="text-sm font-medium">{t(`event.${row.eventType}` as DictKey) ?? row.eventType}</p>
                      <div className="mt-1 grid grid-cols-1 gap-x-4 min-[420px]:grid-cols-3">
                        {CHANNELS.map((channel) => {
                          const locked = row.locked.includes(channel);
                          const unavailable =
                            (channel === 'sms' && !data.smsAvailable) ||
                            (channel === 'telegram' && !data.channels.telegram.available) ||
                            (channel === 'push' && !data.channels.push.available);
                          return (
                            <Switch
                              key={channel}
                              className="py-1.5"
                              checked={row[channel]}
                              disabled={locked || unavailable}
                              onChange={(checked) =>
                                save.mutate({ eventType: row.eventType, [channel]: checked })
                              }
                              label={
                                <span className="inline-flex items-center gap-1">
                                  {locked && <Lock aria-hidden className="h-3 w-3" />}
                                  {t(`prefs.channel.${channel}` as DictKey)}
                                </span>
                              }
                              hint={locked ? t('prefs.locked') : undefined}
                            />
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
