import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Bengali } from 'next/font/google';
import { t } from '@/lib/i18n/bn';
import { Providers } from './providers';
import './globals.css';

/**
 * Bengali conjuncts render broken under system fallbacks on Windows and older
 * Android, so the face is loaded rather than assumed. Only the weights actually
 * used are requested, because Bengali subsets are large.
 *
 * Noto Sans Bengali rather than Hind Siliguri: Hind Siliguri draws ১ badly at UI
 * sizes, and every price, quantity and ledger amount in this app is rendered in
 * Bengali numerals by `lib/format.ts`, so a bad digit is not a cosmetic problem.
 * Noto is the reference implementation of the script and its digits are drawn
 * for exactly this, with a full ০-৯ set at every weight used here.
 */
const bengali = Noto_Sans_Bengali({
  variable: '--font-bengali',
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: t('app.name'),
  description: t('app.description'),
  applicationName: t('app.name'),
  // Apple ignores the manifest for the home screen icon and the standalone hint.
  appleWebApp: { capable: true, title: t('app.name'), statusBarStyle: 'default' },
  // Telephone numbers are already rendered as tel: links where they should be;
  // left to itself Safari also linkifies order codes and amounts.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * Without `cover` every `env(safe-area-inset-*)` resolves to zero, which puts
   * the bottom navigation and the sticky order bar underneath the home
   * indicator. Zooming stays enabled: pinching a price list is a real need, and
   * disabling it is an accessibility failure, not a polish detail.
   */
  viewportFit: 'cover',
  themeColor: '#e0a34a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <body className={`${bengali.variable} min-h-screen antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
