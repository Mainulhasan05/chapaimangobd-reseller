import type {
  BankAccount,
  CatalogItem,
  Deposit,
  KycStatus,
  LandingTemplate,
  LedgerEntry,
  Order,
  Paged,
  PaymentMode,
  SmsCreditsInfo,
  Wallet,
  Withdrawal,
} from '@/lib/types';
import { api, EFFECTS, LIST, listTags } from '../api';
import { qs } from '../base-query';
import { primeOrder, type OrderResult } from './orders';
import { byQueryString, pageNumbers } from './shared';

/**
 * Every `/reseller/*` call a reseller screen makes on its own.
 *
 * Shared with the owner, and so in the owner's files with a `role` argument:
 * the order detail, cancel and customer edit (orders.ts), customers
 * (people.ts), and notifications, push, Telegram and preferences
 * (notifications.ts).
 *
 * A reseller's session carries their profile, so profile writes refresh the
 * session rather than a profile entry of their own.
 */

/* ---------------------------------------------------------------- types */

export type ResellerOrdersArgs = {
  status?: string;
  q?: string;
  /** The list pages by 20; the badge and dashboard ask for 5 and read `total`. */
  limit?: number;
};

export type DailyStats = { days: { date: string; orders: number; margin: number }[] };

export type NewOrderInput = {
  paymentMode: PaymentMode;
  customer: { name: string; phone: string; address: string; district: string; note?: string };
  items: { product: string; variant: string; quantity: number; sellPrice: number }[];
};

export type ConfirmOrderInput = {
  id: string;
  paymentMode: PaymentMode;
  items: { product: string; variant: string | null; quantity: number; sellPrice: number }[];
};

export type CatalogUpdate = {
  productId: string;
  variants: { variant: string; sellPrice: number; regularPrice: number | null; isListed: boolean }[];
  hidePrice: boolean;
  isListed: boolean;
};

export type ResellerKyc = {
  /** The owner asked this reseller to verify. Nothing here is offered without it. */
  required: boolean;
  /** The module belongs on their screens: required, or already submitted. */
  visible: boolean;
  canSubmit: boolean;
  status: KycStatus;
  submission: {
    id: string;
    status: string;
    note?: string;
    documentTypes: string[];
    createdAt: string;
    reviewedAt?: string;
  } | null;
};

/** Which history, and how much of it at a time. */
export type HistoryArgs = { limit?: number } | void;

export type WithdrawalInput = {
  amount: number;
  method: string;
  /** Exactly one of these, by method. See docs/adr/0018. */
  destinationNumber?: string;
  bank?: BankAccount;
  note?: string;
};

export type ProfilePatch = Partial<{
  shopName: string;
  slug: string;
  address: string;
  about: string;
  publicPhone: string;
  whatsappNumber: string;
  facebookUrl: string;
  bkashNumber: string;
  nagadNumber: string;
  formActive: boolean;
  landingTemplate: LandingTemplate;
}>;

export const resellerApi = api.injectEndpoints({
  endpoints: (build) => ({
    /* -------------------------------------------------------------- orders */

    // Poll with `LIVE`: push may never arrive, so the pending badge relies on it.
    getResellerOrders: build.infiniteQuery<Paged<'orders', Order>, ResellerOrdersArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/reseller/orders${qs({ ...queryArg, limit: queryArg.limit ?? 20, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'orders', Order>>((page) => page.orders),
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Order', result?.pages.flatMap((page) => page.orders)),
    }),

    // A week's margin by day, for the dashboard chart.
    getResellerDailyStats: build.query<DailyStats, { days: number }>({
      query: ({ days }) => `/reseller/orders/stats/daily${qs({ days })}`,
      providesTags: ['Report'],
    }),

    // A new order may be placed straight into confirmed, which debits the wallet and takes stock.
    createResellerOrder: build.mutation<{ order: { id: string; orderCode: string } }, NewOrderInput>({
      query: (body) => ({ url: '/reseller/orders', method: 'POST', body }),
      invalidatesTags: (_result, error) =>
        error ? [] : [...EFFECTS.order(), 'Wallet', 'Ledger', 'Catalog'],
    }),

    // Confirming debits the wallet and takes the stock.
    confirmResellerOrder: build.mutation<OrderResult, ConfirmOrderInput>({
      query: ({ id, ...body }) => ({ url: `/reseller/orders/${id}/confirm`, method: 'POST', body }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [...EFFECTS.order(id), 'Wallet', 'Ledger', 'Catalog'],
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          primeOrder(dispatch, 'reseller', data.order);
        } catch {
          // Shown by the caller.
        }
      },
    }),

    /* ------------------------------------------------------------- catalog */

    // The catalog page, the order form and the onboarding nudge all read this one entry.
    getCatalog: build.query<{ products: CatalogItem[] }, void>({
      query: () => '/reseller/catalog',
      providesTags: ['Catalog'],
    }),

    // Prices and what is listed are what the public shop shows.
    updateCatalogItem: build.mutation<unknown, CatalogUpdate>({
      query: ({ productId, ...body }) => ({ url: `/reseller/catalog/${productId}`, method: 'PUT', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['Catalog', 'Shop']),
    }),

    /* ----------------------------------------------------------------- kyc */

    getResellerKyc: build.query<ResellerKyc, void>({
      query: () => '/reseller/kyc',
      providesTags: ['Kyc'],
    }),

    /*
     * Multipart: one file per document field. The session carries the KYC
     * status the shell reads. KYC_ALREADY_PENDING means another tab or device
     * got there first, so reloading shows its submission instead of the form.
     */
    submitKyc: build.mutation<unknown, { formData: FormData }>({
      query: ({ formData }) => ({ url: '/reseller/kyc', method: 'POST', formData }),
      invalidatesTags: (_result, error) =>
        !error ? ['Kyc', 'Session'] : error.code === 'KYC_ALREADY_PENDING' ? ['Kyc'] : [],
    }),

    /* -------------------------------------------------------------- wallet */

    getWallet: build.query<{ wallet: Wallet }, void>({
      query: () => '/reseller/wallet',
      providesTags: ['Wallet'],
    }),

    // The statement, newest first.
    getWalletLedger: build.infiniteQuery<Paged<'entries', LedgerEntry>, HistoryArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/reseller/wallet/ledger${qs({ limit: queryArg?.limit ?? 30, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'entries', LedgerEntry>>((page) => page.entries),
      serializeQueryArgs: byQueryString,
      providesTags: ['Ledger'],
    }),

    getMyDeposits: build.infiniteQuery<Paged<'deposits', Deposit>, HistoryArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/reseller/deposits${qs({ limit: queryArg?.limit ?? 10, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'deposits', Deposit>>((page) => page.deposits),
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Deposit', result?.pages.flatMap((page) => page.deposits)),
    }),

    // Multipart, because the payment screenshot goes up with the request. Nothing is credited until approved.
    createDeposit: build.mutation<unknown, { formData: FormData }>({
      query: ({ formData }) => ({ url: '/reseller/deposits', method: 'POST', formData }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'Deposit', id: LIST }]),
    }),

    getMyWithdrawals: build.infiniteQuery<Paged<'withdrawals', Withdrawal>, HistoryArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/reseller/withdrawals${qs({ limit: queryArg?.limit ?? 10, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'withdrawals', Withdrawal>>((page) => page.withdrawals),
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Withdrawal', result?.pages.flatMap((page) => page.withdrawals)),
    }),

    // Nothing is debited until the owner approves.
    createWithdrawal: build.mutation<unknown, WithdrawalInput>({
      query: (body) => ({ url: '/reseller/withdrawals', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'Withdrawal', id: LIST }]),
    }),

    /* ----------------------------------------------------------------- sms */

    getSmsCredits: build.query<SmsCreditsInfo, void>({
      query: () => '/reseller/sms',
      providesTags: ['SmsCredits'],
    }),

    // Paid from the wallet, so the balance and the statement move.
    buySmsCredits: build.mutation<{ smsCredits: number; charged: number }, { credits: number }>({
      query: (body) => ({ url: '/reseller/sms/purchase', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['SmsCredits', 'Wallet', 'Ledger']),
    }),

    /* ------------------------------------------------------------- profile */

    // Shop details, the open/closed switch and the page design.
    updateProfile: build.mutation<unknown, ProfilePatch>({
      query: (body) => ({ url: '/reseller/profile', method: 'PATCH', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['Session', 'Shop']),
    }),

    uploadProfileLogo: build.mutation<unknown, { formData: FormData }>({
      query: ({ formData }) => ({ url: '/reseller/profile/logo', method: 'POST', formData }),
      invalidatesTags: (_result, error) => (error ? [] : ['Session', 'Shop']),
    }),

    removeProfileLogo: build.mutation<unknown, void>({
      query: () => ({ url: '/reseller/profile/logo', method: 'DELETE' }),
      invalidatesTags: (_result, error) => (error ? [] : ['Session', 'Shop']),
    }),
  }),
});

export const {
  useGetResellerOrdersInfiniteQuery,
  useGetResellerDailyStatsQuery,
  useCreateResellerOrderMutation,
  useConfirmResellerOrderMutation,
  useGetCatalogQuery,
  useUpdateCatalogItemMutation,
  useGetResellerKycQuery,
  useSubmitKycMutation,
  useGetWalletQuery,
  useGetWalletLedgerInfiniteQuery,
  useGetMyDepositsInfiniteQuery,
  useCreateDepositMutation,
  useGetMyWithdrawalsInfiniteQuery,
  useCreateWithdrawalMutation,
  useGetSmsCreditsQuery,
  useBuySmsCreditsMutation,
  useUpdateProfileMutation,
  useUploadProfileLogoMutation,
  useRemoveProfileLogoMutation,
} = resellerApi;
