import type {
  DeliveryZone,
  LoginResult,
  OtpSent,
  PaymentMode,
  PublicOrder,
  Session,
  User,
} from '@/lib/types';
import { api, LIST } from '../api';
import { qs } from '../base-query';

/**
 * The calls made before, or around, being signed in: the auth forms, the
 * account screen's password and phone changes, order tracking, the public
 * shop's order form, and the public delivery-zone list.
 *
 * `/auth/me` itself is `getSession` in session.ts. The login and register
 * responses lack the features block, so they invalidate the session rather
 * than seed it; read the fresh one with
 * `dispatch(sessionApi.endpoints.getSession.initiate(undefined, { forceRefetch: true }))`.
 */

export type RegisterInput = {
  name: string;
  phone: string;
  password: string;
  otp: string;
  shopName?: string;
};

export type ShopOrderInput = {
  slug: string;
  /** Made once per form, so a double submit is answered with the same order. */
  submissionId: string;
  paymentMode: PaymentMode;
  customer: { name: string; phone: string; address: string; district: string; note?: string };
  items: { product: string; variant: string; quantity: number }[];
};

export const publicApi = api.injectEndpoints({
  endpoints: (build) => ({
    /* ---------------------------------------------------------------- auth */

    // A device that needs a second factor answers with a challenge, and nothing is signed in yet.
    login: build.mutation<LoginResult, { phone: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      invalidatesTags: (result) => (result && !result.requiresOtp ? ['Session'] : []),
    }),

    verifyLogin: build.mutation<LoginResult, { challengeId: string; otp: string }>({
      query: (body) => ({ url: '/auth/login/verify', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['Session']),
    }),

    sendRegisterOtp: build.mutation<OtpSent, { phone: string }>({
      query: (body) => ({ url: '/auth/register/otp', method: 'POST', body }),
    }),

    register: build.mutation<Session, RegisterInput>({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['Session']),
    }),

    forgotPassword: build.mutation<OtpSent, { phone: string }>({
      query: (body) => ({ url: '/auth/password/forgot', method: 'POST', body }),
    }),

    resetPassword: build.mutation<unknown, { phone: string; otp: string; newPassword: string }>({
      query: (body) => ({ url: '/auth/password/reset', method: 'POST', body }),
    }),

    // Clears mustChangePassword, which is what lets the shell stop redirecting to the account page.
    changePassword: build.mutation<{ user: User }, { currentPassword: string; newPassword: string }>({
      query: (body) => ({ url: '/auth/password/change', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : ['Session']),
    }),

    sendPhoneChangeOtp: build.mutation<OtpSent, { newPhone: string }>({
      query: (body) => ({ url: '/auth/phone/otp', method: 'POST', body }),
    }),

    /*
     * Signs the person out on the server. The caller clears the whole cache
     * (`api.util.resetApiState()`) and goes to /login, as logout does: nothing
     * from this session may linger.
     */
    changePhone: build.mutation<unknown, { newPhone: string; otp: string; password: string }>({
      query: (body) => ({ url: '/auth/phone/change', method: 'POST', body }),
    }),

    /* -------------------------------------------------------------- public */

    // Code and phone together, so the page is not an oracle over other people's orders. Lazy hook.
    getTrackedOrder: build.query<{ order: PublicOrder }, { code: string; phone: string }>({
      query: ({ code, phone }) => `/public/track/${encodeURIComponent(code)}${qs({ phone })}`,
      keepUnusedDataFor: 0,
    }),

    // Nothing on the client caches a public shop's orders.
    placeShopOrder: build.mutation<{ orderCode: string; duplicate: boolean }, ShopOrderInput>({
      query: ({ slug, ...body }) => ({ url: `/public/shop/${slug}/orders`, method: 'POST', body }),
    }),

    // The active zones, for district pickers. The owner's zone edits refresh it.
    getDeliveryZones: build.query<{ zones: DeliveryZone[] }, void>({
      query: () => '/public/delivery-zones',
      providesTags: [{ type: 'Zone', id: LIST }],
      keepUnusedDataFor: 300,
    }),
  }),
});

export const {
  useLoginMutation,
  useVerifyLoginMutation,
  useSendRegisterOtpMutation,
  useRegisterMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useChangePasswordMutation,
  useSendPhoneChangeOtpMutation,
  useChangePhoneMutation,
  useGetTrackedOrderQuery,
  useLazyGetTrackedOrderQuery,
  usePlaceShopOrderMutation,
  useGetDeliveryZonesQuery,
} = publicApi;
