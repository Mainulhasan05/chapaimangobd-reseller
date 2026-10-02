import type { SerializeQueryArgs } from '@reduxjs/toolkit/query/react';
import type { Order, Role } from '@/lib/types';
import { qs } from '../base-query';

/**
 * Helpers the endpoint files share. Nothing here talks to the API; it only
 * keeps the paging, the cache keys and the role prefix spelled one way.
 */

/** `/owner` or `/reseller`, for the few resources both sides read through one screen. */
export const roleBase = (role: Role): `/${Role}` => `/${role}`;

/**
 * The cache key of a filtered list: the endpoint and the query string it will
 * send. `{ q: '' }`, `{}` and no argument at all make the same request, so they
 * share one cache entry instead of three, which the default key (the arg as
 * JSON) would keep apart. Args must be flat, as every list filter is.
 */
export const byQueryString: SerializeQueryArgs<unknown> = ({ endpointName, queryArgs }) =>
  `${endpointName}${qs((queryArgs ?? undefined) as Record<string, unknown> | undefined)}`;

/**
 * Page-number paging, exactly as every old `getNextPageParam` did it: another
 * page while fewer rows are loaded than the first page's `total` says exist.
 */
export function pageNumbers<T extends { total: number }>(rowsOf: (page: T) => readonly unknown[]) {
  return {
    initialPageParam: 1,
    getNextPageParam: (last: T, pages: T[]): number | undefined => {
      const loaded = pages.reduce((count, page) => count + rowsOf(page).length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
  };
}

/**
 * Cursor paging: the server says where the next page starts, or null at the
 * end. An empty string is the first page, so `qs` drops it from the request.
 */
export const cursorPages = {
  initialPageParam: '',
  getNextPageParam: (last: { nextCursor: string | null }): string | undefined =>
    last.nextCursor ?? undefined,
};

/** The reseller an order belongs to, whether or not the API populated it. */
export function resellerIdOf(order: Pick<Order, 'reseller'> | undefined): string | undefined {
  if (!order) return undefined;
  return typeof order.reseller === 'string' ? order.reseller : order.reseller?._id;
}
