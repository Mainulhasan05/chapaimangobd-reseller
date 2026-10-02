import type { OwnerDashboard, Position } from '@/lib/types';
import { api } from '../api';
import { qs } from '../base-query';
import { byQueryString } from './shared';

/**
 * The owner dashboard's own reads. They sit under `/owner/reports/*` on the
 * server but nothing else asks for them, so they live with the screen. The
 * dashboard's other panels (pick list, profit, supplies) are shared reports and
 * live in reports.ts.
 *
 * Poll the payload with `LIVE` from the screen; the dashboard tag is
 * invalidated by every action that moves one of its counts.
 */

export type OrdersByDay = { days: { date: string; orders: number; customerTotal: number }[] };

export const dashboardApi = api.injectEndpoints({
  endpoints: (build) => ({
    getDashboard: build.query<OwnerDashboard, void>({
      query: () => '/owner/reports/dashboard',
      providesTags: ['Dashboard'],
    }),

    // Owed both ways: resellers to the owner, the owner to payees.
    getPosition: build.query<Position, void>({
      query: () => '/owner/reports/position',
      providesTags: ['Dashboard', 'Report'],
    }),

    getOrdersByDay: build.query<OrdersByDay, { from?: string; to?: string }>({
      query: (arg) => `/owner/reports/orders-by-day${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),
  }),
});

export const { useGetDashboardQuery, useGetPositionQuery, useGetOrdersByDayQuery } = dashboardApi;
