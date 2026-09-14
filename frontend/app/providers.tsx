'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, setUnauthorizedHandler } from '@/lib/api';

const PROTECTED = ['/owner', '/reseller'];
import { ToastProvider } from '@/components/ui/toast';

/**
 * Dashboards are client rendered and talk to the API through TanStack Query.
 * They are auth gated and mutation heavy, so Server Components would buy nothing
 * while creating the cookie forwarding problem. Public pages stay server
 * rendered. See docs/adr/0005.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // Retrying an authorization or validation failure just repeats it.
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      })
  );

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

      client.clear();
      const next = encodeURIComponent(`${pathname}${search}`);
      window.location.replace(`/login?next=${next}`);
      return true;
    });
    return () => setUnauthorizedHandler(null);
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
