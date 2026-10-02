import type { CustomerSmsAction, Features } from '@/lib/types';
import { api, LIST, type Tag } from '../api';

/**
 * The owner's settings, the brand logo and the SMS gateway balance.
 *
 * One `PATCH /owner/settings` serves both the settings form and the customer
 * SMS templates card, each sending only its own fields; what it invalidates
 * follows the fields sent, so saving a template does not refetch the orders.
 */

export type CustomerSmsSettings = {
  customerSmsTemplates: Record<CustomerSmsAction, string>;
  customerSms: {
    available: boolean;
    placeholders: string[];
    maxSegments: number;
    trackUrlConfigured: boolean;
  };
};

export type Settings = {
  businessName: string;
  supportPhone?: string;
  poweredByText: string;
  defaultCreditLimit: number;
  orderAgingHours: number;
  reverseDeliveryChargeOnReturn: boolean;
  smsPricePerCredit: number;
  features: Features;
  /** The public brand mark. Uploaded on its own, not through the form. */
  brandLogoUrl?: string | null;
} & CustomerSmsSettings;

/** What either form may send. Undefined fields are left as they are. */
export type SettingsUpdate = Partial<
  Omit<Settings, 'customerSms' | 'brandLogoUrl' | 'customerSmsTemplates'> & {
    customerSmsTemplates: Record<CustomerSmsAction, string>;
  }
>;

export type SmsBalance = { configured: boolean; balance: number | null };

/** What else reads a settings field, so a save refreshes exactly that. */
function settingsEffects(update: SettingsUpdate): Tag[] {
  const tags: Tag[] = ['Settings'];
  // The session carries the feature switches every screen reads.
  if (update.features) tags.push('Session', 'Dashboard');
  // The aging threshold decides which orders count as stale.
  if (update.orderAgingHours !== undefined) {
    tags.push({ type: 'Order', id: LIST }, 'OrderSummary', 'Dashboard');
  }
  return tags;
}

export const settingsApi = api.injectEndpoints({
  endpoints: (build) => ({
    // The report sheets read the letterhead (name, phone, logo) from here too.
    getSettings: build.query<{ settings: Settings }, void>({
      query: () => '/owner/settings',
      providesTags: ['Settings'],
    }),

    updateSettings: build.mutation<unknown, SettingsUpdate>({
      query: (body) => ({ url: '/owner/settings', method: 'PATCH', body }),
      invalidatesTags: (_result, error, update) => (error ? [] : settingsEffects(update)),
    }),

    uploadBrandLogo: build.mutation<unknown, { formData: FormData }>({
      query: ({ formData }) => ({ url: '/owner/settings/brand-logo', method: 'POST', formData }),
      invalidatesTags: (_result, error) => (error ? [] : ['Settings']),
    }),

    removeBrandLogo: build.mutation<unknown, void>({
      query: () => ({ url: '/owner/settings/brand-logo', method: 'DELETE' }),
      invalidatesTags: (_result, error) => (error ? [] : ['Settings']),
    }),

    // Asks the gateway, so it moves when messages go out.
    getSmsBalance: build.query<SmsBalance, void>({
      query: () => '/owner/settings/sms-balance',
      providesTags: ['Sms'],
    }),
  }),
});

export const {
  useGetSettingsQuery,
  useUpdateSettingsMutation,
  useUploadBrandLogoMutation,
  useRemoveBrandLogoMutation,
  useGetSmsBalanceQuery,
} = settingsApi;
