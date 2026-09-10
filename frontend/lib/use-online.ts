'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/**
 * Whether the browser thinks it has a connection.
 *
 * Optimistic by design: `navigator.onLine` reports the radio, not whether the
 * API is reachable, so it catches the tunnel and the dead SIM but not a captive
 * portal. It is the banner's trigger, never a reason to block a request.
 *
 * The server snapshot is `true`, because rendering an offline warning into HTML
 * that by definition arrived over the network would be a lie.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  );
}
