import { api, LIST, listTags } from '../api';

/**
 * The signed-in owner's own account, beyond the session itself: the browsers
 * trusted to sign in without a code (docs/adr/0014). Resellers have none, and
 * the API refuses them.
 */

export type TrustedDevice = {
  id: string;
  /** "Chrome · Android", read from the browser's own description of itself. */
  label: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string;
  /** The browser asking. Forgetting it means the next sign-in here takes a code. */
  current: boolean;
};

export const shellApi = api.injectEndpoints({
  endpoints: (build) => ({
    getDevices: build.query<{ devices: TrustedDevice[] }, void>({
      query: () => '/auth/devices',
      providesTags: (result) => listTags('Device', result?.devices),
    }),

    // Forgets one device. Sessions already open there carry on; a password change ends those.
    revokeDevice: build.mutation<{ revoked: boolean; current: boolean }, { id: string }>({
      query: ({ id }) => ({ url: `/auth/devices/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Device', id: LIST }, { type: 'Device', id }],
    }),
  }),
});

export const { useGetDevicesQuery, useRevokeDeviceMutation } = shellApi;
