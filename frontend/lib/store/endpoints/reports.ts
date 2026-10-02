import type {
  CustomersReport,
  ExpenseReport,
  OrderSheet,
  PayablesReport,
  PickList,
  ProductsReport,
  ProfitReport,
  PurchaseReport,
  ResellerReport,
  SalesReport,
  SourcesReport,
  SupplyReport,
} from '@/lib/types';
import { api } from '../api';
import { qs } from '../base-query';
import { byQueryString } from './shared';

/**
 * Every `/owner/reports/*` read (except the dashboard's own, in dashboard.ts)
 * and the CSV export links.
 *
 * They all provide `Report`, which every action that moves money, stock or an
 * order invalidates, so a report open beside an action refreshes after it.
 * Ranges are `from`/`to` business dates; omitted means all time (or today, for
 * the pick list), exactly as before.
 */

export type RangeArgs = { from?: string; to?: string };

export type Receivables = {
  /** What resellers owe the owner: the negative ledger balances. */
  totalOwed: number;
  /** What the owner holds for resellers: the positive ledger balances. */
  totalPayable: number;
  openOrders: number;
  /** Every reseller not square with the ledger, or whose cached balance drifted. */
  resellers: {
    id: string;
    shopName: string;
    user?: { name: string; phoneE164: string };
    /** The ledger balance, signed: negative owes, positive is held for them. */
    balance: number;
    owed: number;
    payable: number;
    creditLimit: number;
    atLimit: boolean;
    /** The cached balance disagrees with the ledger. A reconcile says why. */
    drift: boolean;
  }[];
};

export type ProductsSold = {
  from: string;
  to: string;
  products: {
    product: string;
    name: string;
    unit: string;
    quantity: number;
    revenue: number;
    cost: number;
    orders: number;
  }[];
};

export type ReconcileResult = {
  checked: number;
  drifted: { reseller: string; problems: string[] }[];
};

/** The orders list's own filters, so the sheet printed from a filtered queue is that queue. */
export type OrderSheetArgs = RangeArgs & {
  status?: string;
  q?: string;
  /** `'true'` for the aging filter, as the list sends it. */
  aging?: string;
  source?: string;
  reseller?: string;
};

/** The purchase list's own filters, so the sheet prints what the screen showed. */
export type PurchaseReportArgs = RangeArgs & {
  payeeId?: string;
  supplyId?: string;
  status?: string;
  max?: number;
};

/** The expense list's own filters. Voided expenses are never on the sheet. */
export type ExpenseReportArgs = RangeArgs & {
  categoryId?: string;
  payeeId?: string;
  orderId?: string;
  scope?: string;
  paymentStatus?: string;
  max?: number;
};

/**
 * The itemised purchase sheet (PLAN-4 §4.2.7). `rows` lists what the filter
 * matches, cancelled ones included and labelled; the totals never count them.
 */
export type PurchaseReportView = PurchaseReport & {
  rows?: {
    id: string;
    purchaseCode: string;
    businessDate: string;
    invoiceNo: string | null;
    payeeId: string;
    payeeNameBn: string;
    status: 'received' | 'cancelled';
    supplies: string[];
    goodsCost: number;
    chargeTotal: number;
    spent: number;
    billed: number;
  }[];
  rowCount?: number;
  truncated?: boolean;
};

export type ExpenseReportView = ExpenseReport & {
  rows?: {
    id: string;
    businessDate: string;
    categoryId: string;
    categoryNameBn: string;
    scope: 'order' | 'period';
    orderId: string | null;
    orderCode: string | null;
    payeeId: string | null;
    payeeNameBn: string | null;
    paymentStatus: 'paid' | 'unpaid';
    paidFrom: string | null;
    amount: number;
    note: string | null;
  }[];
  rowCount?: number;
  truncated?: boolean;
};

/**
 * The CSV files the API streams. Links, not requests: the browser downloads them
 * with the cookies. The purchase and expense files take their lists' filters, so
 * a download can carry every filter on screen.
 */
export type ExportFile = 'orders.csv' | 'ledger.csv' | 'purchases.csv' | 'expenses.csv';

export function exportHref(file: ExportFile, params?: Record<string, unknown>): string {
  return `/api/owner/exports/${file}${qs(params)}`;
}

export const reportsApi = api.injectEndpoints({
  endpoints: (build) => ({
    getReceivables: build.query<Receivables, void>({
      query: () => '/owner/reports/receivables',
      providesTags: ['Report'],
    }),

    getProductsSold: build.query<ProductsSold, RangeArgs>({
      query: (arg) => `/owner/reports/products-sold${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    // A check run on demand from a button: the lazy hook, never kept.
    getReconcile: build.query<ReconcileResult, void>({
      query: () => '/owner/reports/reconcile',
      keepUnusedDataFor: 0,
    }),

    getSalesReport: build.query<SalesReport, RangeArgs>({
      query: (arg) => `/owner/reports/sales${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getResellerReport: build.query<ResellerReport, RangeArgs>({
      query: (arg) => `/owner/reports/resellers${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getProductsReport: build.query<ProductsReport, RangeArgs>({
      query: (arg) => `/owner/reports/products${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getSourcesReport: build.query<SourcesReport, RangeArgs>({
      query: (arg) => `/owner/reports/sources${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    // No range is today's collection list, which the dashboard shows.
    getPickList: build.query<PickList, RangeArgs>({
      query: (arg) => `/owner/reports/pick-list${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getOrderSheet: build.query<OrderSheet, OrderSheetArgs>({
      query: (arg) => `/owner/reports/order-sheet${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getCustomersReport: build.query<CustomersReport, void>({
      query: () => '/owner/reports/customers',
      providesTags: ['Report'],
    }),

    getSupplyReport: build.query<SupplyReport, RangeArgs>({
      query: (arg) => `/owner/reports/supplies${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getPurchaseReport: build.query<PurchaseReportView, PurchaseReportArgs>({
      query: (arg) => `/owner/reports/purchases${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getPayablesReport: build.query<PayablesReport, void>({
      query: () => '/owner/reports/payables',
      providesTags: ['Report'],
    }),

    getExpenseReport: build.query<ExpenseReportView, ExpenseReportArgs>({
      query: (arg) => `/owner/reports/expenses${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),

    getProfitReport: build.query<ProfitReport, RangeArgs>({
      query: (arg) => `/owner/reports/profit${qs(arg)}`,
      serializeQueryArgs: byQueryString,
      providesTags: ['Report'],
    }),
  }),
});

export const {
  useGetReceivablesQuery,
  useGetProductsSoldQuery,
  useGetReconcileQuery,
  useLazyGetReconcileQuery,
  useGetSalesReportQuery,
  useGetResellerReportQuery,
  useGetProductsReportQuery,
  useGetSourcesReportQuery,
  useGetPickListQuery,
  useGetOrderSheetQuery,
  useGetCustomersReportQuery,
  useGetSupplyReportQuery,
  useGetPurchaseReportQuery,
  useGetPayablesReportQuery,
  useGetExpenseReportQuery,
  useGetProfitReportQuery,
} = reportsApi;
