import { ApiError, apiRequest } from '@/lib/api';
import type { Session } from '@/lib/types';
import { api } from '../api';

/**
 * The signed-in user. A 401 here is an answer, not a failure, so it resolves to
 * null rather than an error and is never retried.
 */
export const sessionApi = api.injectEndpoints({
  endpoints: (build) => ({
    getSession: build.query<Session | null, void>({
      queryFn: async (_arg, { signal }) => {
        try {
          return { data: await apiRequest<Session>('/auth/me', { signal }) };
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) return { data: null };
          return {
            error:
              error instanceof ApiError
                ? error
                : new ApiError(0, { code: 'UNKNOWN', message: String(error) }),
          };
        }
      },
      providesTags: ['Session'],
      keepUnusedDataFor: 300,
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
    }),
  }),
});

export const { useGetSessionQuery, useLogoutMutation } = sessionApi;
