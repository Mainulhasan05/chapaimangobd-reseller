'use client';

import { StoreProvider } from '@/lib/store/provider';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Dashboards are client rendered and talk to the API through RTK Query, which
 * caches each response once, shares it between every screen that asks for it,
 * and refreshes it when a mutation changes the records under it. They are auth
 * gated and mutation heavy, so Server Components would buy nothing while
 * creating the cookie forwarding problem. Public pages stay server rendered.
 * See docs/adr/0005 and docs/adr/0028.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <ToastProvider>{children}</ToastProvider>
    </StoreProvider>
  );
}
