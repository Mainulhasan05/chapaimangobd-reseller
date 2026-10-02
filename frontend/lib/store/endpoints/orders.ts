import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import type {
  CustomerEditResult,
  CustomerSmsAction,
  CustomerSmsPreview,
  DeliveryChargeChange,
  Order,
  OrderCost,
  OrdersSummary,
  OrderStatus,
  PackagingEstimate,
  Paged,
  Role,
} from '@/lib/types';
import { api, EFFECTS, LIST, listTags, type Tag } from '../api';
import { qs } from '../base-query';
import { byQueryString, pageNumbers, resellerIdOf, roleBase } from './shared';

/**
 * Orders: the owner's list, counts and detail, and every transition.
 *
 * The detail and the cancel/customer-edit calls are shared with the reseller
 * screens (the same components serve both), so they take a `role` and address
 * `/owner/...` or `/reseller/...` from it. The reseller's own list, confirm and
 * create live in reseller.ts.
 *
 * Every owner transition takes its row off the queues it is leaving as soon as
 * it is sent and writes the answer through to the detail and the lists, so a
 * sheet can close the moment the request answers; the tags refetch the counts
 * and reports behind it.
 */

/** What narrows the owner's order list, as the API spells it. */
export type OwnerOrdersArgs = {
  /** One status or a comma list. Omitted: every status. */
  status?: string;
  aging?: boolean;
  q?: string;
  /** A source id, from an orchard's page. */
  source?: string;
  /** A reseller profile id, from a reseller's page. */
  reseller?: string;
  from?: string;
  to?: string;
  /**
   * `oldest` is the fulfilment queue's order: longest waiting first, by when the
   * order was confirmed. Omitted: newest first.
   */
  sort?: 'oldest' | 'newest';
  /** Rows per page. The list pages by 20; the badge and dashboard ask for a handful. */
  limit?: number;
};

/**
 * The summary carries every list filter. `status` narrows only the money: the
 * counts on the tabs always span every status, so each tab still counts what
 * pressing it shows.
 */
export type OrdersSummaryArgs = Omit<OwnerOrdersArgs, 'limit' | 'sort'>;

export type OrderRef = { role: Role; id: string };

/** The owner's detail also carries what the order cost; the reseller's does not. */
export type OrderDetail = { order: Order; cost?: OrderCost };

export type OrderResult = { order: Order };

export type CourierChange = { courierName?: string; trackingNumber?: string };

export type CustomerSmsPreviewArgs = {
  id: string;
  action: CustomerSmsAction;
  courier?: string;
  trackingId?: string;
  reason?: string;
};

export type CustomerChanges = Partial<{
  name: string;
  phone: string;
  address: string;
  district: string;
}>;

// The state type is the store's, which this file cannot name without a cycle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dispatch = ThunkDispatch<any, unknown, UnknownAction>;

/**
 * Writes an order a mutation returned into its detail entry, so an open detail
 * screen shows the new status at once rather than after the refetch the tags
 * trigger. Merged rather than replaced: the owner's entry also carries `cost`,
 * which the transition response does not, and the refetch brings it up to date.
 */
export function primeOrder(dispatch: Dispatch, role: Role, order: Order | undefined): void {
  if (!order?.id) return;
  dispatch(
    ordersApi.util.updateQueryData('getOrder', { role, id: order.id }, (draft) => {
      draft.order = order;
    })
  );
}

/** The recent-couriers list, refreshed only by the calls that write a courier. */
const COURIERS: Tag = { type: 'Order', id: 'COURIERS' };

/** Customer SMS goes out through the gateway, so the SMS log and balance move. */
const smsTags = (sent: boolean | undefined): Tag[] => (sent ? ['Sms'] : []);

/**
 * How a transition takes part in a batch.
 *
 * `bulk` skips the transition's own refresh: twenty accepts each refetching
 * every loaded page, the counts and the dashboard was a hundred requests on a
 * 2G line. The optimistic removal and the write-through still happen per
 * order; the caller refreshes once at the end (`BULK_EFFECTS`).
 *
 * `chargeChanged` is the accept or ship sheet saying it changed the delivery
 * charge (sent with `bulk` so it refreshed nothing), so this one refresh also
 * covers the wallet the adjustment posted to.
 */
export type Batching = { bulk?: boolean; chargeChanged?: boolean };

/** Everything a batch of transitions can move, refreshed once when it ends. */
export const BULK_EFFECTS: Tag[] = [
  ...EFFECTS.order(),
  ...EFFECTS.wallet(),
  ...EFFECTS.supplies(),
  ...EFFECTS.stock(),
  'Source',
  COURIERS,
];


/** Whether a list filtered by these args would still show an order in `status`. */
function listKeeps(args: OwnerOrdersArgs | undefined, status: OrderStatus): boolean {
  if (!args) return true;
  // Aging is "confirmed and stale", whatever the status filter says.
  if (args.aging) return status === 'confirmed';
  if (!args.status) return true;
  return args.status.split(',').includes(status);
}

/**
 * Takes an order off every loaded queue it is about to leave, before the
 * request answers, so the owner working down "awaiting acceptance" sees the
 * row go at once instead of after a round trip and a refetch. Lists that would
 * still show the order (all, or a filter that includes the new status) keep the
 * row; the write-through below updates it there. Undone on failure.
 */
function leaveQueues(
  dispatch: Dispatch,
  getState: () => unknown,
  id: string,
  to: OrderStatus
): { undo: () => void } {
  const entries = ordersApi.util
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .selectInvalidatedBy(getState() as any, [{ type: 'Order', id }])
    .filter((entry) => entry.endpointName === 'getOwnerOrders');
  const patches = entries
    .filter((entry) => !listKeeps(entry.originalArgs as OwnerOrdersArgs, to))
    .map((entry) =>
      dispatch(
        ordersApi.util.updateQueryData(
          'getOwnerOrders',
          entry.originalArgs as OwnerOrdersArgs,
          (draft) => {
            let removed = 0;
            draft.pages.forEach((page) => {
              const before = page.orders.length;
              page.orders = page.orders.filter((row) => row.id !== id);
              removed += before - page.orders.length;
            });
            if (removed) draft.pages.forEach((page) => (page.total = Math.max(0, page.total - removed)));
          }
        )
      )
    );
  return { undo: () => patches.forEach((patch) => patch.undo()) };
}

/**
 * Writes the order a transition answered with into every loaded list row and
 * the detail entry, so the new status and buttons show before the refetch.
 */
function writeThrough(dispatch: Dispatch, getState: () => unknown, role: Role, order: Order | undefined) {
  if (!order?.id) return;
  primeOrder(dispatch, role, order);
  if (role !== 'owner') return;
  ordersApi.util
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .selectInvalidatedBy(getState() as any, [{ type: 'Order', id: order.id }])
    .filter((entry) => entry.endpointName === 'getOwnerOrders')
    .forEach((entry) =>
      dispatch(
        ordersApi.util.updateQueryData(
          'getOwnerOrders',
          entry.originalArgs as OwnerOrdersArgs,
          (draft) => {
            draft.pages.forEach((page) => {
              page.orders = page.orders.map((row) => (row.id === order.id ? order : row));
            });
          }
        )
      )
    );
}

/**
 * The shared shape of a transition's side effects: leave the queues now, write
 * the answer through, and put the rows back if the server said no.
 */
function transitionEffects(to: OrderStatus) {
  return async (
    arg: { id: string; role?: Role },
    {
      dispatch,
      getState,
      queryFulfilled,
    }: { dispatch: Dispatch; getState: () => unknown; queryFulfilled: Promise<{ data: OrderResult }> }
  ) => {
    const role = arg.role ?? 'owner';
    const left = role === 'owner' ? leaveQueues(dispatch, getState, arg.id, to) : null;
    try {
      const { data } = await queryFulfilled;
      writeThrough(dispatch, getState, role, data.order);
    } catch {
      // The caller shows the error; the row comes back where it was.
      left?.undo();
    }
  };
}

export const ordersApi = api.injectEndpoints({
  endpoints: (build) => ({
    getOwnerOrders: build.infiniteQuery<Paged<'orders', Order>, OwnerOrdersArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/orders${qs({ ...queryArg, limit: queryArg.limit ?? 20, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'orders', Order>>((page) => page.orders),
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Order', result?.pages.flatMap((page) => page.orders)),
    }),

    getOrdersSummary: build.query<OrdersSummary, OrdersSummaryArgs>({
      query: (arg) => `/owner/orders/summary${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['OrderSummary'],
    }),

    getOrder: build.query<OrderDetail, OrderRef>({
      query: ({ role, id }) => `${roleBase(role)}/orders/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, { id }) => [{ type: 'Order', id }],
    }),

    // Depends on the order, the recipes on its boxes and the shelf, so any of the three refreshes it.
    getPackagingEstimate: build.query<PackagingEstimate, { id: string }>({
      query: ({ id }) => `/owner/orders/${encodeURIComponent(id)}/packaging-estimate`,
      providesTags: (_result, _error, { id }) => [
        { type: 'Order', id },
        { type: 'Product', id: LIST },
        { type: 'Supply', id: LIST },
      ],
    }),

    // The templates live in settings and availability follows the SMS switch.
    getCustomerSmsPreview: build.query<CustomerSmsPreview, CustomerSmsPreviewArgs>({
      query: ({ id, ...params }) =>
        `/owner/orders/${encodeURIComponent(id)}/customer-sms-preview${qs(params)}`,
      serializeQueryArgs: byQueryString,
      providesTags: (_result, _error, { id }) => [{ type: 'Order', id }, 'Settings', 'Sms'],
    }),

    acceptOrder: build.mutation<
      OrderResult,
      {
        id: string;
        sources: { itemId: string; sourceId: string }[];
        sendCustomerSms?: boolean;
      } & Batching
    >({
      query: ({ id, sources, sendCustomerSms }) => ({
        url: `/owner/orders/${id}/accept`,
        method: 'POST',
        body: { sources, sendCustomerSms },
      }),
      // Each line now names its orchard, so the source pages move too.
      invalidatesTags: (result, error, { id, sendCustomerSms, bulk, chargeChanged }) =>
        error || bulk
          ? []
          : [
              ...EFFECTS.order(id),
              'Source',
              ...smsTags(sendCustomerSms),
              ...(chargeChanged ? EFFECTS.wallet(resellerIdOf(result?.order)) : []),
            ],
      onQueryStarted: transitionEffects('accepted'),
    }),

    packOrder: build.mutation<OrderResult, { id: string } & Batching>({
      query: ({ id }) => ({ url: `/owner/orders/${id}/pack`, method: 'POST', body: {} }),
      invalidatesTags: (_result, error, { id, bulk }) => (error || bulk ? [] : EFFECTS.order(id)),
      onQueryStarted: transitionEffects('packed'),
    }),

    shipOrder: build.mutation<
      OrderResult,
      { id: string; courierName: string; trackingNumber?: string; sendCustomerSms?: boolean } & Batching
    >({
      query: ({ id, courierName, trackingNumber, sendCustomerSms }) => ({
        url: `/owner/orders/${id}/ship`,
        method: 'POST',
        body: { courierName, trackingNumber, sendCustomerSms },
      }),
      invalidatesTags: (result, error, { id, sendCustomerSms, bulk, chargeChanged }) =>
        error || bulk
          ? []
          : [
              ...EFFECTS.order(id),
              COURIERS,
              ...smsTags(sendCustomerSms),
              ...(chargeChanged ? EFFECTS.wallet(resellerIdOf(result?.order)) : []),
            ],
      onQueryStarted: transitionEffects('shipped'),
    }),

    // COD collection posts to the wallet and the parcel's packaging is consumed (ADR 0026).
    deliverOrder: build.mutation<OrderResult, { id: string } & Batching>({
      query: ({ id }) => ({ url: `/owner/orders/${id}/deliver`, method: 'POST', body: {} }),
      invalidatesTags: (result, error, { id, bulk }) =>
        error || bulk
          ? []
          : [
              ...EFFECTS.order(id),
              ...EFFECTS.wallet(resellerIdOf(result?.order)),
              ...EFFECTS.supplies(),
              'Source',
            ],
      onQueryStarted: transitionEffects('delivered'),
    }),

    // Reverses the open debit and puts the stock back; the reseller may cancel their own too.
    cancelOrder: build.mutation<
      OrderResult,
      OrderRef & { reason: string; sendCustomerSms?: boolean }
    >({
      query: ({ role, id, ...body }) => ({
        url: `${roleBase(role)}/orders/${id}/cancel`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (result, error, { id, sendCustomerSms }) =>
        error
          ? []
          : [
              ...EFFECTS.order(id),
              ...EFFECTS.wallet(resellerIdOf(result?.order)),
              ...EFFECTS.stock(),
              'Source',
              ...smsTags(sendCustomerSms),
            ],
      onQueryStarted: transitionEffects('cancelled'),
    }),

    // Reverses the wallet, restocks only when ticked, and consumes the packaging like a delivery.
    returnOrder: build.mutation<OrderResult, { id: string; restock: boolean; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/owner/orders/${id}/return`, method: 'POST', body }),
      invalidatesTags: (result, error, { id, restock }) =>
        error
          ? []
          : [
              ...EFFECTS.order(id),
              ...EFFECTS.wallet(resellerIdOf(result?.order)),
              ...(restock ? EFFECTS.stock() : []),
              ...EFFECTS.supplies(),
              'Source',
            ],
      onQueryStarted: transitionEffects('returned'),
    }),

    // A changed charge on a confirmed order posts an adjustment to the reseller's wallet.
    changeDeliveryCharge: build.mutation<
      DeliveryChargeChange,
      { id: string; deliveryCharge: number } & Pick<Batching, 'bulk'>
    >({
      query: ({ id, deliveryCharge }) => ({
        url: `/owner/orders/${id}/delivery-charge`,
        method: 'PATCH',
        body: { deliveryCharge },
      }),
      invalidatesTags: (result, error, { id, bulk }) =>
        error || bulk ? [] : [...EFFECTS.order(id), ...EFFECTS.wallet(resellerIdOf(result?.order))],
      onQueryStarted: async (_arg, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          writeThrough(dispatch, getState, 'owner', data.order);
        } catch {
          // Shown by the caller.
        }
      },
    }),

    // A typo in the courier or tracking number, found once the parcel is out. Shipped only.
    editCourier: build.mutation<OrderResult & { changed: string[] }, { id: string } & CourierChange>({
      query: ({ id, ...body }) => ({ url: `/owner/orders/${id}/courier`, method: 'PATCH', body }),
      // Nothing moves but the order itself; its row tag reaches every list it is on.
      invalidatesTags: (_result, error, { id }) => (error ? [] : [{ type: 'Order', id }, COURIERS]),
      onQueryStarted: async (_arg, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          writeThrough(dispatch, getState, 'owner', data.order);
        } catch {
          // Shown by the caller.
        }
      },
    }),

    // What was written on recent parcels, most recent first, for the ship sheet to offer.
    getRecentCouriers: build.query<{ couriers: string[] }, void>({
      query: () => '/owner/couriers/recent',
      providesTags: [COURIERS],
    }),

    // Name, phone, address, district until the order ships (PLAN-2 decision 9).
    editOrderCustomer: build.mutation<CustomerEditResult, OrderRef & { changes: CustomerChanges }>({
      query: ({ role, id, changes }) => ({
        url: `${roleBase(role)}/orders/${id}/customer`,
        method: 'PATCH',
        body: changes,
      }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : EFFECTS.order(id)),
      onQueryStarted: async ({ role }, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          writeThrough(dispatch, getState, role, data.order);
        } catch {
          // Shown by the caller.
        }
      },
    }),
  }),
});

export const {
  useGetOwnerOrdersInfiniteQuery,
  useGetOrdersSummaryQuery,
  useGetOrderQuery,
  useGetPackagingEstimateQuery,
  useGetCustomerSmsPreviewQuery,
  useAcceptOrderMutation,
  usePackOrderMutation,
  useShipOrderMutation,
  useDeliverOrderMutation,
  useCancelOrderMutation,
  useReturnOrderMutation,
  useChangeDeliveryChargeMutation,
  useEditOrderCustomerMutation,
  useEditCourierMutation,
  useGetRecentCouriersQuery,
} = ordersApi;
