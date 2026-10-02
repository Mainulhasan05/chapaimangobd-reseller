import type {
  BankAccount,
  CursorPaged,
  Customer,
  KycStatus,
  LedgerEntry,
  Order,
  OrderStatus,
  Paged,
  ResellerSummary,
  Role,
  SmsLog,
  SmsLogDetail,
  SmsOverview,
} from '@/lib/types';
import { api, EFFECTS, LIST, listTags, type Tag } from '../api';
import { qs } from '../base-query';
import { byQueryString, cursorPages, pageNumbers, roleBase } from './shared';

/**
 * People and their money: deposits and withdrawals, resellers and their
 * ledgers, KYC, customers, and the SMS log.
 *
 * The customer SMS templates are saved through `updateSettings` (settings.ts):
 * they are fields of `PATCH /owner/settings`, and one URL has one endpoint.
 */

/* ---------------------------------------------------------------- types */

export type ResellerRef = {
  /** Same value as `_id`; the one to link `/owner/resellers/[id]` with. */
  id?: string;
  _id?: string;
  shopName: string;
  slug: string;
  user?: { _id?: string; name: string; phoneE164: string } | null;
} | null;

/** Who decided a request, and when. Null while it is pending. */
type Review = {
  /** What the reseller wrote with the request. */
  note?: string | null;
  /** The owner's rejection reason; null unless rejected. */
  reason?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: { id: string; name: string } | null;
  /**
   * The reseller's wallet balance now (taka, signed), not when they asked: it
   * is what an approval is weighed against.
   */
  balance?: number | null;
};

export type DepositRow = Review & {
  id: string;
  reseller: ResellerRef;
  amount: number;
  method: string;
  senderNumber?: string | null;
  transactionId?: string | null;
  hasScreenshot: boolean;
  status: string;
  createdAt: string;
};

export type WithdrawalRow = Review & {
  id: string;
  reseller: ResellerRef;
  amount: number;
  method: string;
  /** Exactly one of these is set, by method. See docs/adr/0018. */
  destinationNumber: string | null;
  bank: BankAccount | null;
  status: string;
  /** Typed on approval: the transaction id of the payout. */
  payoutReference?: string | null;
  createdAt: string;
};

export type ReviewArgs = {
  /** pending | approved | rejected; omitted for all. */
  status?: string;
  method?: string;
  /** One reseller's requests, for their detail page. */
  resellerId?: string;
  limit?: number;
};

/**
 * Who the decision is about, when the screen knows. It narrows the refresh to
 * that reseller's page; without it every reseller entry refreshes.
 */
type ResellerHint = { resellerId?: string };

/** `newest` pages by cursor; every other order answers the whole matching list at once. */
export type ResellerSort = 'newest' | 'name' | 'balance_desc' | 'balance_asc';

export type ResellersArgs = {
  kycStatus?: KycStatus | '';
  /** Shop, person or the last digits of the phone, matched on the server. */
  q?: string;
  sort?: ResellerSort;
  /** Omitted: the whole list in one page, which the dashboard and the audit filter use. */
  limit?: number;
};

/** What a reseller has traded. `salesTotal` is owner revenue (CONTEXT.md), not sales. */
export type ResellerStats = {
  orderCount: number;
  deliveredCount: number;
  salesTotal: number;
  customerTotal: number;
  lastOrderAt: string | null;
};

/** The reseller detail the list does not carry: preferences, counts, their latest KYC. */
export type ResellerDetail = {
  reseller: ResellerSummary & { channelPrefs?: { sms?: boolean }; address?: string | null };
  orderCounts?: Partial<Record<OrderStatus, number>>;
  stats?: ResellerStats;
  kyc?: {
    id: string;
    status: string;
    note?: string | null;
    createdAt: string;
    documents: { type: string }[];
  } | null;
};

/** One field at a time, as the management sheet sends it. */
export type ResellerPatch =
  | { creditLimit: number }
  | { isActive: boolean }
  | { smsEnabled: boolean }
  | { kycRequired: boolean };

/** The answer to `PATCH /owner/resellers/:id`. */
export type ResellerUpdate = {
  reseller: { id: string; isActive: boolean | null; deactivatedAt: string | null };
  /** Codes of the pending orders a deactivation cancelled. See docs/adr/0011. */
  cancelledOrders: string[];
};

export type KycSubmission = {
  id: string;
  reseller: {
    _id: string;
    shopName: string;
    slug: string;
    user?: { name: string; phoneE164: string };
  };
  status: string;
  documentTypes: string[];
  /** The owner's reason on a decision; null while pending or when none was given. */
  note?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: { id: string; name: string } | null;
  createdAt: string;
};

export type KycDocuments = { documents: { type: string; url: string }[] };

export type CustomersArgs = { role: Role; q?: string; limit?: number };

/** The owner addresses a customer by id, a reseller by phone number. */
export type CustomerRef = { role: Role; id: string };

export type CustomerDetail = {
  customer: Customer;
  orders: (Order & { shopName?: string | null })[];
};

export type SmsLogsArgs = {
  /** Omitted for "all". */
  status?: string;
  q?: string;
  /** One kind of message, such as `customer`, linked from the template editor. */
  purpose?: string;
  /** The window the list covers; omitted for all time. */
  from?: string;
  limit?: number;
};

/** A log row says whether resending applies at all: never for a sign-in code or a test. */
export type SmsLogRow = SmsLog & { resendable?: boolean };

export type SmsLogsPage = { logs: SmsLogRow[]; total: number };

/**
 * The overview, with the gateway balance's unit and what SMS cost the owner.
 * The balance is a count of messages, never taka; `spent30d` is null unless the
 * gateway's rate is configured, and then nothing is shown rather than a guess.
 */
export type SmsOverviewData = SmsOverview & {
  balanceUnit?: 'sms';
  lowBalanceAt?: number;
  balanceLow?: boolean | null;
  costPerSegment?: number | null;
  spent30d?: number | null;
};

/** A deposit approval credits the wallet; the dashboard counts the pending ones either way. */
const walletOf = ({ resellerId }: ResellerHint): Tag[] => [
  ...EFFECTS.wallet(resellerId),
  ...(resellerId ? [] : ['Reseller' as const]),
];

/**
 * Money moved on a wallet. The finance rows carry the reseller's current
 * balance, so both queues refresh with the wallet, not only the one acted on.
 */
const moneyMoved = (hint: ResellerHint): Tag[] => [
  ...walletOf(hint),
  { type: 'Deposit', id: LIST },
  { type: 'Withdrawal', id: LIST },
];

const kycMoved = (id: string): Tag[] => [
  { type: 'Kyc', id: LIST },
  { type: 'Kyc', id },
  // The reseller's KYC status shows on their row and detail.
  'Reseller',
  'Dashboard',
];

export const peopleApi = api.injectEndpoints({
  endpoints: (build) => ({
    /* ------------------------------------------------------------- finance */

    getDeposits: build.infiniteQuery<Paged<'deposits', DepositRow>, ReviewArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/deposits${qs({ ...queryArg, limit: queryArg.limit ?? 30, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'deposits', DepositRow>>((page) => page.deposits),
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Deposit', result?.pages.flatMap((page) => page.deposits)),
    }),

    approveDeposit: build.mutation<unknown, { id: string } & ResellerHint>({
      query: ({ id }) => ({ url: `/owner/deposits/${id}/approve`, method: 'POST', body: {} }),
      invalidatesTags: (_result, error, arg) =>
        error ? [] : [{ type: 'Deposit', id: arg.id }, ...moneyMoved(arg)],
    }),

    rejectDeposit: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/owner/deposits/${id}/reject`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Deposit', id: LIST }, { type: 'Deposit', id }, 'Dashboard'],
    }),

    // A short-lived signed URL: read on demand, never kept.
    getDepositScreenshot: build.query<{ url: string }, { id: string }>({
      query: ({ id }) => `/owner/deposits/${id}/screenshot`,
      keepUnusedDataFor: 0,
    }),

    getWithdrawals: build.infiniteQuery<Paged<'withdrawals', WithdrawalRow>, ReviewArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/withdrawals${qs({ ...queryArg, limit: queryArg.limit ?? 30, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'withdrawals', WithdrawalRow>>((page) => page.withdrawals),
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Withdrawal', result?.pages.flatMap((page) => page.withdrawals)),
    }),

    // Approving debits the wallet; rejecting posts nothing.
    approveWithdrawal: build.mutation<
      unknown,
      { id: string; payoutReference?: string } & ResellerHint
    >({
      query: ({ id, payoutReference }) => ({
        url: `/owner/withdrawals/${id}/approve`,
        method: 'POST',
        body: payoutReference ? { payoutReference } : {},
      }),
      invalidatesTags: (_result, error, arg) =>
        error ? [] : [{ type: 'Withdrawal', id: arg.id }, ...moneyMoved(arg)],
    }),

    rejectWithdrawal: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/owner/withdrawals/${id}/reject`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Withdrawal', id: LIST }, { type: 'Withdrawal', id }, 'Dashboard'],
    }),

    /* ----------------------------------------------------------- resellers */

    getResellers: build.infiniteQuery<CursorPaged<'resellers', ResellerSummary>, ResellersArgs, string>({
      query: ({ queryArg, pageParam }) => `/owner/resellers${qs({ ...queryArg, cursor: pageParam })}`,
      infiniteQueryOptions: cursorPages,
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Reseller', result?.pages.flatMap((page) => page.resellers)),
    }),

    getReseller: build.query<ResellerDetail, { id: string }>({
      query: ({ id }) => `/owner/resellers/${id}`,
      // The stats count orders, so an order moving refreshes them as well.
      providesTags: (_result, _error, { id }) => [{ type: 'Reseller', id }, 'OrderSummary'],
    }),

    /*
     * How many pending orders switching this reseller off would cancel. Read
     * when the confirm opens and never kept, so the number is as of that moment.
     */
    getDeactivationPreview: build.query<{ pendingOrders: number }, { id: string }>({
      query: ({ id }) => `/owner/resellers/${id}/deactivation-preview`,
      keepUnusedDataFor: 0,
    }),

    getResellerLedger: build.infiniteQuery<
      Paged<'entries', LedgerEntry>,
      { id: string; limit?: number },
      number
    >({
      query: ({ queryArg: { id, limit }, pageParam }) =>
        `/owner/resellers/${id}/ledger${qs({ limit: limit ?? 50, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'entries', LedgerEntry>>((page) => page.entries),
      serializeQueryArgs: byQueryString,
      providesTags: (_result, _error, { id }) => [{ type: 'Ledger', id }],
    }),

    /*
     * Credit limit, active, SMS or KYC-required, one field per call.
     * Deactivating cancels the reseller's pending orders (ADR 0011); requiring
     * KYC changes what their KYC row says.
     */
    updateReseller: build.mutation<ResellerUpdate, { id: string } & ResellerPatch>({
      query: ({ id, ...body }) => ({ url: `/owner/resellers/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, error, arg) => {
        if (error) return [];
        const tags: Tag[] = [
          { type: 'Reseller', id: LIST },
          { type: 'Reseller', id: arg.id },
          'Dashboard',
          'Report',
        ];
        if ('isActive' in arg && !arg.isActive) tags.push(...EFFECTS.order());
        if ('kycRequired' in arg) tags.push({ type: 'Kyc', id: LIST });
        return tags;
      },
    }),

    // An adjustment is a new entry, never an edit, so the note is required.
    postResellerLedgerEntry: build.mutation<
      { entry: LedgerEntry },
      {
        id: string;
        amount: number;
        direction: 'credit' | 'debit';
        note: string;
        /** One per entry, so a retry after a lost response credits once. */
        nonce?: string;
      }
    >({
      query: ({ id, ...body }) => ({ url: `/owner/resellers/${id}/ledger`, method: 'POST', body }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : moneyMoved({ resellerId: id })),
    }),

    // A check run on demand: use the lazy hook, and it is never kept.
    getResellerReconcile: build.query<{ ok: boolean; problems: string[] }, { id: string }>({
      query: ({ id }) => `/owner/resellers/${id}/reconcile`,
      keepUnusedDataFor: 0,
    }),

    // Changes nothing any screen caches: the password is shown once and forgotten.
    resetResellerPassword: build.mutation<{ temporaryPassword: string }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/resellers/${id}/password-reset`, method: 'POST' }),
    }),

    /* ----------------------------------------------------------------- kyc */

    // Oldest first by cursor; the pending queue is worked from the front.
    getKycSubmissions: build.infiniteQuery<
      CursorPaged<'submissions', KycSubmission>,
      ReviewArgs,
      string
    >({
      query: ({ queryArg, pageParam }) =>
        `/owner/kyc${qs({ ...queryArg, limit: queryArg.limit ?? 30, cursor: pageParam })}`,
      infiniteQueryOptions: cursorPages,
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Kyc', result?.pages.flatMap((page) => page.submissions)),
    }),

    /*
     * National ID scans: signed, short-lived URLs, and every fetch is audited.
     * Fetched when the review sheet opens and never kept.
     */
    getKycDocuments: build.query<KycDocuments, { id: string }>({
      query: ({ id }) => `/owner/kyc/${id}/documents`,
      keepUnusedDataFor: 0,
    }),

    approveKyc: build.mutation<unknown, { id: string; reason?: string }>({
      query: ({ id, reason }) => ({
        url: `/owner/kyc/${id}/approve`,
        method: 'POST',
        body: reason ? { reason } : {},
      }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : kycMoved(id)),
    }),

    rejectKyc: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/owner/kyc/${id}/reject`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : kycMoved(id)),
    }),

    /* ----------------------------------------------------------- customers */

    // Both sides: the owner's counts span every shop, a reseller's only their own.
    getCustomers: build.infiniteQuery<Paged<'customers', Customer>, CustomersArgs, number>({
      query: ({ queryArg: { role, ...params }, pageParam }) =>
        `${roleBase(role)}/customers${qs({ ...params, limit: params.limit ?? 30, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'customers', Customer>>((page) => page.customers),
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Customer', result?.pages.flatMap((page) => page.customers)),
    }),

    getCustomer: build.query<CustomerDetail, CustomerRef>({
      query: ({ role, id }) => `${roleBase(role)}/customers/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, { id }) => [{ type: 'Customer', id }],
    }),

    /* ----------------------------------------------------------------- sms */

    getSmsOverview: build.query<SmsOverviewData, void>({
      query: () => '/owner/sms/overview',
      providesTags: ['Sms'],
    }),

    // The log grows by one row per message, forever.
    getSmsLogs: build.infiniteQuery<SmsLogsPage, SmsLogsArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/sms/logs${qs({ ...queryArg, limit: queryArg.limit ?? 50, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<SmsLogsPage>((page) => page.logs),
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Sms', result?.pages.flatMap((page) => page.logs)),
    }),

    getSmsLog: build.query<{ log: SmsLogDetail & { resendable?: boolean } }, { id: string }>({
      query: ({ id }) => `/owner/sms/logs/${id}`,
      providesTags: (_result, _error, { id }) => [{ type: 'Sms', id }],
    }),

    // The master switch. Settings and the session's features read the same flag.
    toggleSms: build.mutation<unknown, { enabled: boolean }>({
      query: (body) => ({ url: '/owner/sms/toggle', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['Sms', 'Settings', 'Session', 'Dashboard']),
    }),

    // Answers with the new attempt's row, which may itself be blocked or failed.
    resendSms: build.mutation<{ result: SmsLogDetail }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/sms/logs/${id}/resend`, method: 'POST' }),
      invalidatesTags: (_result, error) => (error ? [] : ['Sms']),
    }),

    sendTestSms: build.mutation<{ result: SmsLogDetail }, { phone: string; text: string }>({
      query: (body) => ({ url: '/owner/sms/test', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['Sms']),
    }),
  }),
});

export const {
  useGetDepositsInfiniteQuery,
  useApproveDepositMutation,
  useRejectDepositMutation,
  useGetDepositScreenshotQuery,
  useLazyGetDepositScreenshotQuery,
  useGetWithdrawalsInfiniteQuery,
  useApproveWithdrawalMutation,
  useRejectWithdrawalMutation,
  useGetResellersInfiniteQuery,
  useGetResellerQuery,
  useGetDeactivationPreviewQuery,
  useGetResellerLedgerInfiniteQuery,
  useUpdateResellerMutation,
  usePostResellerLedgerEntryMutation,
  useGetResellerReconcileQuery,
  useLazyGetResellerReconcileQuery,
  useResetResellerPasswordMutation,
  useGetKycSubmissionsInfiniteQuery,
  useGetKycDocumentsQuery,
  useApproveKycMutation,
  useRejectKycMutation,
  useGetCustomersInfiniteQuery,
  useGetCustomerQuery,
  useGetSmsOverviewQuery,
  useGetSmsLogsInfiniteQuery,
  useGetSmsLogQuery,
  useToggleSmsMutation,
  useResendSmsMutation,
  useSendTestSmsMutation,
} = peopleApi;
