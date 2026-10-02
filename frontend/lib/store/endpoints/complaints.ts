import type { Complaint, ComplaintKind } from '@/lib/types';
import { api, LIST, listTags, type Tag } from '../api';
import { qs } from '../base-query';
import { byQueryString, pageNumbers } from './shared';

/**
 * Complaints: the owner's list, one order's complaints, logging, resolving and
 * reopening.
 *
 * A complaint never changes an order or moves money, so these touch only the
 * complaint lists, the open count on the dashboard and the orchard pages and
 * report that weigh complaints against a source.
 */

export type ComplaintsArgs = {
  /** A string, because `qs` drops `false`: 'false' is the open queue, 'true' the resolved. */
  resolved?: 'true' | 'false';
  kind?: string;
  /** A source id, from an orchard's page. */
  source?: string;
  /** An order code, the customer's phone or their name. */
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type ComplaintsPage = { complaints: Complaint[]; total: number; open: number };

const complaintMoved = (id?: string): Tag[] => [
  { type: 'Complaint', id: LIST },
  ...(id ? [{ type: 'Complaint' as const, id }] : []),
  'Dashboard',
  'Report',
  'Source',
];

export const complaintsApi = api.injectEndpoints({
  endpoints: (build) => ({
    getComplaints: build.infiniteQuery<ComplaintsPage, ComplaintsArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/complaints${qs({ ...queryArg, limit: queryArg.limit ?? 20, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<ComplaintsPage>((page) => page.complaints),
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Complaint', result?.pages.flatMap((page) => page.complaints)),
    }),

    getOrderComplaints: build.query<{ complaints: Complaint[] }, { orderId: string }>({
      query: ({ orderId }) => `/owner/orders/${orderId}/complaints`,
      providesTags: (result) => listTags('Complaint', result?.complaints),
    }),

    createComplaint: build.mutation<
      { complaint: Complaint },
      { orderId: string; kind: ComplaintKind; note: string; itemIds: string[] }
    >({
      query: ({ orderId, ...body }) => ({
        url: `/owner/orders/${orderId}/complaints`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, error) => (error ? [] : complaintMoved()),
    }),

    resolveComplaint: build.mutation<unknown, { id: string; resolution: string }>({
      query: ({ id, resolution }) => ({
        url: `/owner/complaints/${id}/resolve`,
        method: 'POST',
        body: { resolution },
      }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : complaintMoved(id)),
    }),

    // The undo of a resolve, and the way back for one closed too early.
    reopenComplaint: build.mutation<{ complaint: Complaint }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/complaints/${id}/reopen`, method: 'POST', body: {} }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : complaintMoved(id)),
    }),
  }),
});

export const {
  useGetComplaintsInfiniteQuery,
  useGetOrderComplaintsQuery,
  useCreateComplaintMutation,
  useResolveComplaintMutation,
  useReopenComplaintMutation,
} = complaintsApi;
