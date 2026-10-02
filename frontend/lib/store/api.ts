import { createApi } from '@reduxjs/toolkit/query/react';
import { apiBaseQuery } from './base-query';

/**
 * Every kind of server record the cache knows about.
 *
 * A query `provides` the tags of what it returned and a mutation `invalidates`
 * the tags of what it changed, so a screen refreshes because the data under it
 * changed, not because somebody remembered to refetch it. Ids are used where a
 * record has its own screen (an order, a payee); `LIST` stands for "any list of
 * these", so a new row appears without knowing which filters it matches.
 */
export const TAG_TYPES = [
  'Session',
  'Dashboard',
  'Report',
  'Order',
  'OrderSummary',
  'Complaint',
  'Product',
  'Source',
  'Zone',
  'Supply',
  'Landing',
  'Reseller',
  'Ledger',
  'Deposit',
  'Withdrawal',
  'Kyc',
  'Customer',
  'Sms',
  'Settings',
  'Notification',
  'NotificationPrefs',
  'Telegram',
  'Audit',
  'Purchase',
  'Payee',
  'Expense',
  'ExpenseCategory',
  'Outbox',
  'Device',
  // Reseller side.
  'Wallet',
  'Catalog',
  'Shop',
  'SmsCredits',
] as const;

export type TagType = (typeof TAG_TYPES)[number];
export type Tag = TagType | { type: TagType; id: string | number };

export const LIST = 'LIST' as const;

/**
 * The tags a list provides: one per row plus the list itself. A mutation on one
 * row then refreshes every list that row appears in, and a create refreshes the
 * lists through `LIST`.
 */
export function listTags<T extends { id?: string; _id?: string }>(
  type: TagType,
  rows: readonly T[] | undefined
): Tag[] {
  const ids = (rows ?? [])
    .map((row) => row.id ?? row._id)
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ type, id }));
  return [...ids, { type, id: LIST }];
}

/**
 * What else moves when something happens, written down once.
 *
 * The old screens invalidated everything under `['owner']` after almost every
 * action, which refetched every list, report and figure the owner had open, on
 * a 2G connection, before closing the sheet. These groups name what actually
 * depends on what, so an action refreshes the screens it touched and nothing
 * else.
 */
export const EFFECTS = {
  /** An order changed state: lists, counts, the dashboard and the reports. */
  order: (id?: string): Tag[] => [
    { type: 'Order', id: LIST },
    ...(id ? [{ type: 'Order' as const, id }] : []),
    'OrderSummary',
    'Dashboard',
    'Report',
    'Customer',
  ],
  /** Money moved on a reseller's wallet. */
  wallet: (resellerId?: string): Tag[] => [
    'Ledger',
    'Wallet',
    'Dashboard',
    'Report',
    { type: 'Reseller', id: LIST },
    ...(resellerId ? [{ type: 'Reseller' as const, id: resellerId }] : []),
  ],
  /** Stock of a product's boxes moved. */
  stock: (): Tag[] => [{ type: 'Product', id: LIST }, 'Catalog', 'Dashboard'],
  /** Packaging or other supply stock moved. */
  supplies: (id?: string): Tag[] => [
    { type: 'Supply', id: LIST },
    ...(id ? [{ type: 'Supply' as const, id }] : []),
    'Dashboard',
    'Report',
  ],
  /** What the owner owes a payee moved. */
  payee: (id?: string): Tag[] => [
    { type: 'Payee', id: LIST },
    ...(id ? [{ type: 'Payee' as const, id }] : []),
    'Dashboard',
    'Report',
  ],
};

/**
 * The one API slice. Each area adds its endpoints with `api.injectEndpoints`
 * in `lib/store/endpoints/*`, so no screen defines its own request and two
 * screens asking for the same data share one cache entry and one request.
 *
 * Freshness, matching what the app had before:
 * - a cached result older than 30 seconds is refetched when a screen mounts;
 * - an unused result is kept for 60 seconds, so going back to a list is instant;
 * - returning to the tab or coming back online refetches what is on screen.
 */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: apiBaseQuery,
  tagTypes: TAG_TYPES,
  keepUnusedDataFor: 60,
  refetchOnMountOrArgChange: 30,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: () => ({}),
});

/** Polling for the queues the owner watches. Paused while the tab is hidden. */
export const LIVE = { pollingInterval: 60_000, skipPollingIfUnfocused: true } as const;
