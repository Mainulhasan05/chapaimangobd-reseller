'use client';

import { useEffect, useState } from 'react';
import { Provider } from 'react-redux';
import { setupListeners } from '@reduxjs/toolkit/query/react';
import { setUnauthorizedHandler } from '@/lib/api';
import { api } from './api';
import { makeStore, type AppStore } from './store';

const PROTECTED = ['/owner', '/reseller'];

/**
 * The store for this tab.
 *
 * Made once per mount with lazy state, never at module scope, so a server render
 * cannot hand one person's cache to the next. `setupListeners` is what makes
 * `refetchOnFocus` and `refetchOnReconnect` work.
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState<AppStore>(() => makeStore());

  useEffect(() => setupListeners(store.dispatch), [store]);

  /*
   * A session that cannot be refreshed ends here, once. The cache is cleared
   * so the next person on this phone never sees the previous one's orders, and
   * the navigation is a full load so nothing held in memory survives either.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const { pathname, search } = window.location;
      const isProtected = PROTECTED.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
      );
      if (!isProtected) return false;

      store.dispatch(api.util.resetApiState());
      const next = encodeURIComponent(`${pathname}${search}`);
      window.location.replace(`/login?next=${next}`);
      return true;
    });
    return () => setUnauthorizedHandler(null);
  }, [store]);

  return <Provider store={store}>{children}</Provider>;
}
