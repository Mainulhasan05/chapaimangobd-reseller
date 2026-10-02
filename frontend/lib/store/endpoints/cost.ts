import type {
  Expense,
  ExpenseCategory,
  Paged,
  Payee,
  PayeeDetail,
  PayeeLedgerEntry,
  Purchase,
} from '@/lib/types';
import { api, EFFECTS, LIST, listTags, type Tag } from '../api';
import { qs } from '../base-query';
import { byQueryString, pageNumbers } from './shared';

/**
 * The cost side (PLAN-3): purchases, payees and what the owner owes them,
 * expenses and their categories.
 *
 * A purchase moves the shelf and a payee's due at once; an expense filed
 * against an order changes that order's cost block; an unpaid one raises the
 * payee's due. The tags below say exactly that.
 */

/* ---------------------------------------------------------------- types */

export type PurchasesArgs = {
  payeeId?: string;
  supplyId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
};

/** `totals` are summed over every row the filter matches, not the page in hand. */
export type PurchasePage = Paged<'purchases', Purchase> & {
  totals: { goodsCost: number; chargeTotal: number; spent: number; billedByPayees: number };
};

export type PurchaseInput = {
  payeeId: string;
  lines: { supplyId: string; quantity: number; unitCost: number }[];
  charges?: {
    kind: string;
    amount: number;
    paidTo: string;
    payeeName?: string;
    allocate: boolean;
    note?: string;
  }[];
  allocationBasis: 'value' | 'quantity';
  date: string;
  invoiceNo?: string;
  note?: string;
};

/** `includeArchived` lists the payees taken off the list too; the totals count them either way. */
export type PayeesArgs = {
  kind?: Payee['kind'];
  owingOnly?: boolean;
  q?: string;
  includeArchived?: boolean;
};

export type PayeeList = {
  payees: Payee[];
  totals: {
    count: number;
    /** Every matching payee's due, archived ones included whether listed or not. */
    due: number;
    advance: number;
    owingCount: number;
    /** The archived share of `due`, so the screen can say where it sits. */
    archivedDue?: number;
    archivedAdvance?: number;
    archivedOwingCount?: number;
    archivedCount?: number;
  };
};

export type PayeeInput = {
  nameBn: string;
  kind: Payee['kind'];
  phone?: string;
  address?: string;
  note?: string;
};

/**
 * A ledger row as the detail endpoints send it (PLAN-4 §4.2.5): the business
 * day it belongs to, what it points at in words, and whether it may still be
 * reversed. The `entry` a payment returns carries `reference: null`.
 */
export type PayeeLedgerRow = PayeeLedgerEntry & {
  businessDate?: string;
  reference?: {
    type: 'purchase' | 'expense';
    id: string;
    label: string;
    cancelled: boolean;
  } | null;
  reversedBy?: string | null;
  reversible?: boolean;
};

export type PayeeDetailView = Omit<PayeeDetail, 'ledger'> & {
  ledger: PayeeLedgerRow[];
  /** Every purchase from this payee, cancelled included; `purchases` is only the latest few. */
  purchaseCount?: number;
  expenseCount?: number;
};

export type PayeeReverseResult = {
  payee: Payee;
  entry: PayeeLedgerRow;
  reversed: PayeeLedgerRow;
  /** A reversed payment that had settled an expense puts that expense back to unpaid. */
  reopenedExpenseId: string | null;
  /** The order that reopened expense was filed against, whose cost block shows it. */
  reopenedExpenseOrderId?: string | null;
};

export type ExpensesArgs = {
  categoryId?: string;
  payeeId?: string;
  orderId?: string;
  scope?: string;
  paymentStatus?: string;
  includeVoided?: boolean;
  from?: string;
  to?: string;
  limit?: number;
};

/** An expense as the API now sends it: when an unpaid one was marked paid, and by which entry. */
export type ExpenseRow = Expense & { paidAt?: string | null; paymentEntry?: string | null };

/** `totals` are summed over every row the filter matches and never count a voided one. */
export type ExpensePage = Paged<'expenses', ExpenseRow> & {
  totals: { all: number; order: number; period: number; unpaid: number };
};

export type ExpenseInput = {
  categoryId: string;
  amount: number;
  orderId?: string;
  payeeId?: string;
  paymentStatus: 'paid' | 'unpaid';
  paidFrom?: string;
  /** Business date. Omitted: today. */
  date?: string;
  note?: string;
};

/** What an expense touches: the list, the order it was filed against, and the payee it is owed to. */
const expenseMoved = (expense: Pick<Expense, 'id' | 'order' | 'payee'> | undefined): Tag[] => [
  { type: 'Expense', id: LIST },
  ...(expense ? [{ type: 'Expense' as const, id: expense.id }] : []),
  ...(expense?.order ? [{ type: 'Order' as const, id: expense.order }] : []),
  ...EFFECTS.payee(expense?.payee ?? undefined),
];

/** A purchase moves the shelf, the seller's due and possibly another payee's (a charge paid to someone else). */
const purchaseMoved = (id?: string): Tag[] => [
  { type: 'Purchase', id: LIST },
  ...(id ? [{ type: 'Purchase' as const, id }] : []),
  ...EFFECTS.supplies(),
  'Payee',
];

export const costApi = api.injectEndpoints({
  endpoints: (build) => ({
    /* ----------------------------------------------------------- purchases */

    getPurchases: build.infiniteQuery<PurchasePage, PurchasesArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/purchases${qs({ ...queryArg, limit: queryArg.limit ?? 20, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<PurchasePage>((page) => page.purchases),
      serializeQueryArgs: byQueryString,
      providesTags: (result) =>
        listTags('Purchase', result?.pages.flatMap((page) => page.purchases)),
    }),

    // One purchase by id, for a link from a supply movement or a payee's খাতা,
    // whatever range the list happens to be on.
    getPurchase: build.query<{ purchase: Purchase }, { id: string }>({
      query: ({ id }) => `/owner/purchases/${id}`,
      providesTags: (_result, _error, { id }) => [{ type: 'Purchase', id }],
    }),

    createPurchase: build.mutation<{ purchase: Purchase }, PurchaseInput>({
      query: (body) => ({ url: '/owner/purchases', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : purchaseMoved()),
    }),

    // Reverses the stock and the dues it posted.
    cancelPurchase: build.mutation<{ purchase: Purchase }, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/owner/purchases/${id}/cancel`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : purchaseMoved(id)),
    }),

    /* -------------------------------------------------------------- payees */

    // No argument is the whole book, which the purchase, expense and order-expense forms pick from.
    getPayees: build.query<PayeeList, PayeesArgs | void>({
      query: (arg) => `/owner/payees${qs(arg ?? undefined)}`,
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Payee', result?.payees),
    }),

    getPayee: build.query<PayeeDetailView, { id: string }>({
      query: ({ id }) => `/owner/payees/${id}`,
      providesTags: (_result, _error, { id }) => [{ type: 'Payee', id }],
    }),

    // Read twice on the detail page (the খাতা and the working behind the due), so one entry serves both.
    getPayeeLedger: build.infiniteQuery<
      Paged<'ledger', PayeeLedgerRow>,
      { id: string; limit?: number },
      number
    >({
      query: ({ queryArg: { id, limit }, pageParam }) =>
        `/owner/payees/${id}/ledger${qs({ limit: limit ?? 20, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<Paged<'ledger', PayeeLedgerRow>>((page) => page.ledger),
      serializeQueryArgs: byQueryString,
      providesTags: (_result, _error, { id }) => [{ type: 'Payee', id }],
    }),

    createPayee: build.mutation<{ payee: Payee }, PayeeInput>({
      query: (body) => ({ url: '/owner/payees', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'Payee', id: LIST }]),
    }),

    updatePayee: build.mutation<{ payee: Payee }, PayeeInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/owner/payees/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Payee', id: LIST }, { type: 'Payee', id }],
    }),

    // Archived dues still count in the totals and the payables report.
    archivePayee: build.mutation<unknown, { id: string }>({
      query: ({ id }) => ({ url: `/owner/payees/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : EFFECTS.payee(id)),
    }),

    // Back on the list: the edit form's PATCH with only the flag.
    restorePayee: build.mutation<{ payee: Payee }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/payees/${id}`, method: 'PATCH', body: { isArchived: false } }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : EFFECTS.payee(id)),
    }),

    // `nonce` is held per open sheet, so a retry cannot pay twice. `date` is the
    // business day the money was handed over; today when left out.
    payPayee: build.mutation<
      { payee: Payee; entry: PayeeLedgerRow },
      { id: string; amount: number; nonce: string; paidFrom: string; note?: string; date?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/owner/payees/${id}/payments`, method: 'POST', body }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : EFFECTS.payee(id)),
    }),

    // An opening balance, an adjustment or a discount, signed by the caller.
    postPayeeLedgerEntry: build.mutation<
      unknown,
      { id: string; kind: string; amount: number; nonce: string; note?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/owner/payees/${id}/ledger`, method: 'POST', body }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : EFFECTS.payee(id)),
    }),

    /*
     * Takes back a wrong payment or hand entry with an opposite one; the
     * original is never edited. A payment that had settled an expense puts that
     * expense back to unpaid, so the expense lists move as well.
     */
    reversePayeeEntry: build.mutation<
      PayeeReverseResult,
      { id: string; entryId: string; reason: string }
    >({
      query: ({ id, entryId, reason }) => ({
        url: `/owner/payees/${id}/ledger/${entryId}/reverse`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: (result, error, { id }) => {
        if (error) return [];
        const reopened = result?.reopenedExpenseId;
        const order = result?.reopenedExpenseOrderId;
        return [
          ...EFFECTS.payee(id),
          ...(reopened
            ? [{ type: 'Expense' as const, id: LIST }, { type: 'Expense' as const, id: reopened }]
            : []),
          ...(order ? [{ type: 'Order' as const, id: order }] : []),
        ];
      },
    }),

    /* -------------------------------------------------- expense categories */

    // No argument is the live set the forms pick from; `includeArchived` adds
    // the ones put away, for the manage sheet's restore list.
    getExpenseCategories: build.query<
      { categories: ExpenseCategory[] },
      { includeArchived?: boolean } | void
    >({
      query: (arg) => `/owner/expense-categories${qs(arg ?? undefined)}`,
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('ExpenseCategory', result?.categories),
    }),

    createExpenseCategory: build.mutation<
      { category: ExpenseCategory },
      { nameBn: string; scope: ExpenseCategory['scope'] }
    >({
      query: (body) => ({ url: '/owner/expense-categories', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'ExpenseCategory', id: LIST }]),
    }),

    archiveExpenseCategory: build.mutation<unknown, { id: string }>({
      query: ({ id }) => ({ url: `/owner/expense-categories/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'ExpenseCategory', id: LIST }, { type: 'ExpenseCategory', id }],
    }),

    restoreExpenseCategory: build.mutation<{ category: ExpenseCategory }, { id: string }>({
      query: ({ id }) => ({
        url: `/owner/expense-categories/${id}`,
        method: 'PATCH',
        body: { isArchived: false },
      }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'ExpenseCategory', id: LIST }, { type: 'ExpenseCategory', id }],
    }),

    // The six defaults, one tap from an empty account.
    seedExpenseCategories: build.mutation<{ created: number; categories: ExpenseCategory[] }, void>({
      query: () => ({ url: '/owner/expense-categories/seed', method: 'POST' }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'ExpenseCategory', id: LIST }]),
    }),

    /* ------------------------------------------------------------ expenses */

    getExpenses: build.infiniteQuery<ExpensePage, ExpensesArgs, number>({
      query: ({ queryArg, pageParam }) =>
        `/owner/expenses${qs({ ...queryArg, limit: queryArg.limit ?? 20, page: pageParam })}`,
      infiniteQueryOptions: pageNumbers<ExpensePage>((page) => page.expenses),
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Expense', result?.pages.flatMap((page) => page.expenses)),
    }),

    // Also how the order page files an order-scope expense (courier fee, a replacement box).
    createExpense: build.mutation<{ expense: ExpenseRow }, ExpenseInput>({
      query: (body) => ({ url: '/owner/expenses', method: 'POST', body }),
      invalidatesTags: (result, error) => (error ? [] : expenseMoved(result?.expense)),
    }),

    voidExpense: build.mutation<{ expense: ExpenseRow }, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/owner/expenses/${id}/void`, method: 'POST', body: { reason } }),
      invalidatesTags: (result, error, { id }) =>
        error ? [] : expenseMoved(result?.expense ?? { id, order: null, payee: null }),
    }),

    // "দিয়ে দিয়েছি": posts the payment to the payee and flips the status in one go.
    markExpensePaid: build.mutation<
      { expense: ExpenseRow },
      { id: string; paidFrom: string; date?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/owner/expenses/${id}/mark-paid`, method: 'POST', body }),
      invalidatesTags: (result, error, { id }) =>
        error ? [] : expenseMoved(result?.expense ?? { id, order: null, payee: null }),
    }),
  }),
});

export const {
  useGetPurchasesInfiniteQuery,
  useGetPurchaseQuery,
  useCreatePurchaseMutation,
  useCancelPurchaseMutation,
  useGetPayeesQuery,
  useGetPayeeQuery,
  useGetPayeeLedgerInfiniteQuery,
  useCreatePayeeMutation,
  useUpdatePayeeMutation,
  useArchivePayeeMutation,
  useRestorePayeeMutation,
  usePayPayeeMutation,
  usePostPayeeLedgerEntryMutation,
  useReversePayeeEntryMutation,
  useGetExpenseCategoriesQuery,
  useCreateExpenseCategoryMutation,
  useArchiveExpenseCategoryMutation,
  useRestoreExpenseCategoryMutation,
  useSeedExpenseCategoriesMutation,
  useGetExpensesInfiniteQuery,
  useCreateExpenseMutation,
  useVoidExpenseMutation,
  useMarkExpensePaidMutation,
} = costApi;
