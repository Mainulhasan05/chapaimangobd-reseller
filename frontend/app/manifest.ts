import type { MetadataRoute } from 'next';
import { t } from '@/lib/i18n/bn';

/**
 * The manifest that makes this installable.
 *
 * There was a push service worker in `public/sw.js` and a notifications screen
 * that detects the iOS "you must install first" case, but nothing to install:
 * without a manifest, Safari never offers Add to Home Screen as an app, so web
 * push on iOS could not fire at all. On Android it is the difference between a
 * browser tab and an icon a reseller taps every morning.
 *
 * `standalone` hides the browser chrome, which buys back roughly sixty pixels of
 * vertical space on a small phone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t('app.name'),
    short_name: t('app.name'),
    description: t('app.description'),
    lang: 'bn',
    dir: 'ltr',
    // Role neutral: the owner installs this too. `/` sends a signed-in person to
    // their own dashboard (see proxy.ts) and anyone else to the landing page.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fdfcfa',
    // The mango, matching --primary. Tints the Android task switcher and splash.
    theme_color: '#e0a34a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Maskable, so Android can crop to whatever shape the launcher uses
      // instead of putting a white box behind the icon.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
