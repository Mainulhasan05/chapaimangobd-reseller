import type { MetadataRoute } from 'next';

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
    name: 'চাঁপাই ম্যাঙ্গো',
    short_name: 'চাঁপাই ম্যাঙ্গো',
    description: 'রিসেলার অর্ডার ম্যানেজমেন্ট সিস্টেম',
    lang: 'bn',
    dir: 'ltr',
    start_url: '/reseller',
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
