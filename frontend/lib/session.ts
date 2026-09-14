'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Session } from '@/lib/types';

export const sessionKey = ['session'] as const;

/**
 * The signed-in user. A 401 here is an answer, not a failure, so it resolves to
 * null rather than throwing and is never retried.
 */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        return await api.get<Session>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      // Clear every cached query, not just the session: the next user on this
      // device must not see the previous one orders.
      queryClient.clear();
      router.replace('/login');
    },
  });
}

/**
 * A deactivated reseller: signed in, able to read everything and to ask for a
 * withdrawal, and nothing else. Screens hide their other writes when this is
 * true; the API refuses them with 403 RESELLER_INACTIVE regardless.
 * See docs/adr/0011.
 */
export function useReadOnlyAccount(): boolean {
  const { data } = useSession();
  return Boolean(data && data.user.role === 'reseller' && data.user.isActive === false);
}

/** Where a role belongs after signing in. */
export function homeFor(session: Session | null | undefined): '/owner' | '/reseller' | '/login' {
  if (!session) return '/login';
  return session.user.role === 'owner' ? '/owner' : '/reseller';
}
