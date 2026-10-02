import type { AuditEntry, CursorPaged } from '@/lib/types';
import { api, listTags } from '../api';
import { qs } from '../base-query';
import { byQueryString, cursorPages } from './shared';

/**
 * The audit log, by cursor: it grows while it is read, and a cursor cannot skip
 * or repeat a row the way page numbers would.
 *
 * Nothing invalidates it. Every write is audited, so tagging it from every
 * mutation would refetch the log after each tap; it refreshes on mount, focus
 * and pull instead, like any list older than the store's 30 seconds.
 */

export type AuditArgs = {
  action?: string;
  targetType?: string;
  targetId?: string;
  /** A user id, or `system` once the backend accepts it (PLAN-4 §4.1 item 16). */
  actor?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type AuditPage = CursorPaged<'entries', AuditEntry>;

export const auditApi = api.injectEndpoints({
  endpoints: (build) => ({
    getAudit: build.infiniteQuery<AuditPage, AuditArgs, string>({
      query: ({ queryArg, pageParam }) =>
        `/owner/audit${qs({ ...queryArg, limit: queryArg.limit ?? 30, cursor: pageParam })}`,
      infiniteQueryOptions: cursorPages,
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Audit', result?.pages.flatMap((page) => page.entries)),
    }),
  }),
});

export const { useGetAuditInfiniteQuery } = auditApi;
