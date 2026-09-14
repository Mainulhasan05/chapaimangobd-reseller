import type { Role } from './types';

/**
 * Tells the push service worker which role is signed in on this browser.
 *
 * `public/sw.js` serves the owner and resellers alike, so it cannot hard-code
 * where a tapped notification opens or which endpoint a rotated subscription
 * re-registers with. It stores the role this sends. Only an already registered
 * worker is told: nobody is registered for push just by opening a dashboard.
 */
export async function syncPushRole(role: Role): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;
    const worker = registration.active ?? (await navigator.serviceWorker.ready).active;
    worker?.postMessage({ type: 'set-role', role });
  } catch {
    // Best effort, like push itself. The in-app inbox is the source of truth.
  }
}
