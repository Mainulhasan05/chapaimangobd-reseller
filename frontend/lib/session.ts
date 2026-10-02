'use client';

import { useAppDispatch } from '@/lib/store/hooks';
import { api } from '@/lib/store/api';
import { useGetSessionQuery, useLogoutMutation } from '@/lib/store/endpoints/session';
import type { Session } from '@/lib/types';

/**
 * The signed-in user, read from the shared cache. Every screen and the shell
 * call this, and they share one request: RTK Query de-duplicates it.
 *
 * Fresh for a minute on remount, rather than the store's default 30 seconds,
 * because it changes only when the person signs in or out or the owner changes
 * their account, and those paths refresh it explicitly.
 */
export function useSession() {
  return useGetSessionQuery(undefined, { refetchOnMountOrArgChange: 60 });
}

export function useLogout() {
  const [logout, state] = useLogoutMutation();

  return {
    isPending: state.isLoading,
    mutate: () => {
      void logout()
        .unwrap()
        .catch(() => undefined)
        .finally(() => leaveToLogin());
    },
  };
}

/**
 * Leaves for the login form with nothing of this session left in memory.
 *
 * A full page load rather than a reset-and-navigate. Resetting the cache while
 * the protected page was still mounted made every query on it refetch at once,
 * collect a 401 each, and race the redirect, sometimes landing on
 * `/login?next=<the previous user's page>`. A new document has no cache, no
 * mounted screens and no queued requests.
 */
export function leaveToLogin(path = '/login'): void {
  window.location.replace(path);
}

/** Re-reads the session, for the screens that just changed it (login, password). */
export function useRefreshSession() {
  const dispatch = useAppDispatch();
  return () => dispatch(api.util.invalidateTags(['Session']));
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
