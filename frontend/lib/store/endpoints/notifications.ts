import type {
  CursorPaged,
  NotificationPreferences,
  Paged,
  PreferenceChannel,
  Role,
  TelegramLinkToken,
  TelegramStatus,
} from '@/lib/types';
import { api, LIST, listTags } from '../api';
import { qs } from '../base-query';
import { byQueryString, cursorPages, pageNumbers, roleBase } from './shared';

/**
 * Notifications for both sides: the inbox, push, Telegram and the per-event
 * channel switches. The owner and a reseller use the same screens against
 * `/owner/...` and `/reseller/...`, so every endpoint takes a `role`.
 */

export type RoleArg = { role: Role };

export type NotificationRow = {
  _id: string;
  eventType: string;
  title: string;
  body?: string;
  data?: { orderId?: string; orderCode?: string; url?: string };
  readAt: string | null;
  createdAt: string;
};

/** The newest page carries the freshest unread count. */
export type NotificationsPage = CursorPaged<'notifications', NotificationRow> & { unread: number };

export type NotificationsArgs = RoleArg & {
  /** The inbox pages by 30; the shell's bell asks for 1 and reads `unread` off the first page. */
  limit?: number;
};

export type PreferenceChange = { eventType: string } & Partial<Record<PreferenceChannel, boolean>>;

export type PushSubscriptionBody = { endpoint: string; keys: Record<string, string> };

/**
 * A message that gave up after every attempt (a dead letter). The in-app copy
 * of a notification always exists; this is the push, Telegram message or SMS
 * that never arrived.
 */
export type FailedDelivery = {
  id: string;
  kind: 'notification' | 'customer_sms';
  eventType: string | null;
  status: string;
  /** A customer SMS has only the number it was going to. Null for a removed account. */
  recipient: {
    type: 'customer' | Role;
    id: string | null;
    name: string | null;
    phone: string | null;
  } | null;
  title: string | null;
  body: string | null;
  url: string | null;
  orderId: string | null;
  channels: { name: string; status: string; attempts: number; lastError: string | null }[];
  attempts: number;
  lastError: string | null;
  deadAt: string | null;
  createdAt: string;
};

export type FailedDeliveriesPage = Paged<'messages', FailedDelivery>;

type CacheEntry = { endpointName: string; originalArgs: unknown };

/** Of the cached entries a tag selects, the inboxes and bells of one role. */
function inboxesFor(entries: CacheEntry[], role: Role): NotificationsArgs[] {
  return entries
    .filter(
      (entry) =>
        entry.endpointName === 'getNotifications' &&
        (entry.originalArgs as NotificationsArgs | undefined)?.role === role
    )
    .map((entry) => entry.originalArgs as NotificationsArgs);
}

/** Takes one dead letter out of a loaded page, for an instant retry or dismiss. */
function withoutFailed(page: FailedDeliveriesPage, id: string) {
  const before = page.messages.length;
  page.messages = page.messages.filter((row) => row.id !== id);
  if (page.messages.length < before) page.total = Math.max(0, page.total - 1);
}

export const notificationsApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Newest first. Poll with `LIVE` from the shell's bell; the inbox polls the same way.
    getNotifications: build.infiniteQuery<NotificationsPage, NotificationsArgs, string>({
      query: ({ queryArg: { role, ...params }, pageParam }) =>
        `${roleBase(role)}/notifications${qs({ ...params, limit: params.limit ?? 30, cursor: pageParam })}`,
      infiniteQueryOptions: cursorPages,
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Notification', result?.pages.flatMap((page) => page.notifications)),
    }),

    /*
     * Marks everything read. Shown at once on every loaded inbox and bell for
     * this role; a failure puts the server's answer back.
     */
    markNotificationsRead: build.mutation<unknown, RoleArg>({
      query: ({ role }) => ({ url: `${roleBase(role)}/notifications/read`, method: 'POST' }),
      invalidatesTags: [{ type: 'Notification', id: LIST }],
      onQueryStarted: async ({ role }, { dispatch, getState, queryFulfilled }) => {
        const now = new Date().toISOString();
        const patches = notificationsApi.util
          .selectInvalidatedBy(getState(), [{ type: 'Notification', id: LIST }])
          .filter(
            (entry) =>
              entry.endpointName === 'getNotifications' &&
              (entry.originalArgs as NotificationsArgs | undefined)?.role === role
          )
          .map((entry) =>
            dispatch(
              notificationsApi.util.updateQueryData(
                'getNotifications',
                entry.originalArgs as NotificationsArgs,
                (draft) => {
                  draft.pages.forEach((page) => {
                    page.unread = 0;
                    page.notifications.forEach((row) => {
                      row.readAt ??= now;
                    });
                  });
                }
              )
            )
          );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((patch) => patch.undo());
        }
      },
    }),

    /*
     * Marks the one row that was tapped. Shown read at once on every loaded
     * inbox and bell for this role, and the badge drops by one; the answer's
     * `unread` then sets the badge exactly. Nothing is refetched.
     */
    markNotificationRead: build.mutation<{ unread: number }, RoleArg & { id: string }>({
      query: ({ role, id }) => ({
        url: `${roleBase(role)}/notifications/${id}/read`,
        method: 'POST',
      }),
      onQueryStarted: async ({ role, id }, { dispatch, getState, queryFulfilled }) => {
        const now = new Date().toISOString();
        const inboxes = inboxesFor(
          notificationsApi.util.selectInvalidatedBy(getState(), [{ type: 'Notification', id: LIST }]),
          role
        );
        const patches = inboxes.map((args) =>
          dispatch(
            notificationsApi.util.updateQueryData('getNotifications', args, (draft) => {
              const wasUnread = draft.pages.some((page) =>
                page.notifications.some((row) => row._id === id && !row.readAt)
              );
              draft.pages.forEach((page) => {
                page.notifications.forEach((row) => {
                  if (row._id === id) row.readAt ??= now;
                });
                // A row on no loaded page (the bell holds one) still counted as unread.
                if (wasUnread || args.limit === 1) page.unread = Math.max(0, page.unread - 1);
              });
            })
          )
        );
        try {
          const { data } = await queryFulfilled;
          inboxes.forEach((args) =>
            dispatch(
              notificationsApi.util.updateQueryData('getNotifications', args, (draft) => {
                draft.pages.forEach((page) => {
                  page.unread = data.unread;
                });
              })
            )
          );
        } catch {
          patches.forEach((patch) => patch.undo());
        }
      },
    }),

    /*
     * Any number of switches in one request. Deliberately plain: the
     * preferences screen shows the change itself and sends these one at a
     * time, in order, because each answer is the whole set and two in flight
     * could land out of order and flip a later switch back.
     */
    updateNotificationPreferences: build.mutation<
      NotificationPreferences,
      RoleArg & { changes: PreferenceChange[] }
    >({
      query: ({ role, changes }) => ({
        url: `${roleBase(role)}/notification-preferences`,
        method: 'PUT',
        body: { events: changes },
      }),
    }),

    /*
     * Failed deliveries, newest failure first, by page number. The dashboard
     * counts them (`health.deadLetters`); this lists them.
     */
    getFailedDeliveries: build.infiniteQuery<FailedDeliveriesPage, { limit?: number }, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/outbox/failed${qs({ limit: queryArg.limit ?? 20, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<FailedDeliveriesPage>((page) => page.messages),
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Outbox', result?.pages.flatMap((page) => page.messages)),
    }),

    // Queued again; the worker sends it on its next tick. Leaves the list at once.
    retryFailedDelivery: build.mutation<{ message: FailedDelivery }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/outbox/${id}/retry`, method: 'POST' }),
      // The refetch closes the gap a removal leaves in page-number paging.
      invalidatesTags: (_result, error) =>
        error ? [] : ['Dashboard', { type: 'Outbox', id: LIST }],
      onQueryStarted: async ({ id }, { dispatch, getState, queryFulfilled }) => {
        const patches = notificationsApi.util
          .selectInvalidatedBy(getState(), [{ type: 'Outbox', id: LIST }])
          .filter((entry) => entry.endpointName === 'getFailedDeliveries')
          .map((entry) =>
            dispatch(
              notificationsApi.util.updateQueryData(
                'getFailedDeliveries',
                entry.originalArgs as { limit?: number },
                (draft) => draft.pages.forEach((page) => withoutFailed(page, id))
              )
            )
          );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((patch) => patch.undo());
        }
      },
    }),

    // Let go: kept on record, no longer counted as a fault.
    dismissFailedDelivery: build.mutation<{ message: FailedDelivery }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/outbox/${id}/dismiss`, method: 'POST' }),
      // The refetch closes the gap a removal leaves in page-number paging.
      invalidatesTags: (_result, error) =>
        error ? [] : ['Dashboard', { type: 'Outbox', id: LIST }],
      onQueryStarted: async ({ id }, { dispatch, getState, queryFulfilled }) => {
        const patches = notificationsApi.util
          .selectInvalidatedBy(getState(), [{ type: 'Outbox', id: LIST }])
          .filter((entry) => entry.endpointName === 'getFailedDeliveries')
          .map((entry) =>
            dispatch(
              notificationsApi.util.updateQueryData(
                'getFailedDeliveries',
                entry.originalArgs as { limit?: number },
                (draft) => draft.pages.forEach((page) => withoutFailed(page, id))
              )
            )
          );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((patch) => patch.undo());
        }
      },
    }),

    // Read once, just before subscribing, so it is never kept.
    getPushKey: build.query<{ publicKey: string | null }, RoleArg>({
      query: ({ role }) => `${roleBase(role)}/push/key`,
      keepUnusedDataFor: 0,
    }),

    // A subscription makes the push channel available in the preferences.
    subscribePush: build.mutation<unknown, RoleArg & PushSubscriptionBody>({
      query: ({ role, ...body }) => ({ url: `${roleBase(role)}/push/subscribe`, method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['NotificationPrefs']),
    }),

    getTelegramStatus: build.query<TelegramStatus, RoleArg>({
      query: ({ role }) => `${roleBase(role)}/telegram`,
      providesTags: ['Telegram'],
    }),

    /*
     * A fresh link token. Nothing is linked until the person presses Start in
     * Telegram, which the status picks up on the next focus, so nothing cached
     * changes here.
     */
    createTelegramLinkToken: build.mutation<TelegramLinkToken, RoleArg>({
      query: ({ role }) => ({ url: `${roleBase(role)}/telegram/link-token`, method: 'POST' }),
    }),

    // Unlinking also turns the Telegram channel off in the preferences.
    unlinkTelegram: build.mutation<unknown, RoleArg>({
      query: ({ role }) => ({ url: `${roleBase(role)}/telegram/link`, method: 'DELETE' }),
      invalidatesTags: (_result, error) => (error ? [] : ['Telegram', 'NotificationPrefs']),
    }),

    getNotificationPreferences: build.query<NotificationPreferences, RoleArg>({
      query: ({ role }) => `${roleBase(role)}/notification-preferences`,
      providesTags: ['NotificationPrefs'],
    }),

    /*
     * One switch at a time. Flipped on screen straight away; the answer (the
     * whole preference set) then becomes the cached copy, and a failure puts the
     * previous one back.
     */
    updateNotificationPreference: build.mutation<
      NotificationPreferences,
      RoleArg & { change: PreferenceChange }
    >({
      query: ({ role, change }) => ({
        url: `${roleBase(role)}/notification-preferences`,
        method: 'PUT',
        body: { events: [change] },
      }),
      onQueryStarted: async ({ role, change }, { dispatch, queryFulfilled }) => {
        const patch = dispatch(
          notificationsApi.util.updateQueryData('getNotificationPreferences', { role }, (draft) => {
            draft.groups.forEach((group) => {
              group.events.forEach((row) => {
                if (row.eventType === change.eventType) Object.assign(row, change);
              });
            });
          })
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(notificationsApi.util.upsertQueryData('getNotificationPreferences', { role }, data));
        } catch {
          patch.undo();
        }
      },
    }),
  }),
});

export const {
  useGetNotificationsInfiniteQuery,
  useMarkNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useUpdateNotificationPreferencesMutation,
  useGetFailedDeliveriesInfiniteQuery,
  useRetryFailedDeliveryMutation,
  useDismissFailedDeliveryMutation,
  useGetPushKeyQuery,
  useLazyGetPushKeyQuery,
  useSubscribePushMutation,
  useGetTelegramStatusQuery,
  useCreateTelegramLinkTokenMutation,
  useUnlinkTelegramMutation,
  useGetNotificationPreferencesQuery,
  useUpdateNotificationPreferenceMutation,
} = notificationsApi;
