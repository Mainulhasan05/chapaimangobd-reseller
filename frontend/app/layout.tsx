import type { Metadata, Viewport } from 'next';
import { Hind_Siliguri } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

/**
 * Bengali conjuncts render broken under system fallbacks on Windows and older
 * Android, so the face is loaded rather than assumed. Only the weights actually
 * used are requested, because Bengali subsets are large.
 */
const bengali = Hind_Siliguri({
  variable: '--font-bengali',
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'চাঁপাই ম্যাঙ্গো',
  description: 'রিসেলার অর্ডার ম্যানেজমেন্ট সিস্টেম',
  applicationName: 'চাঁপাই ম্যাঙ্গো',
  // Apple ignores the manifest for the home screen icon and the standalone hint.
  appleWebApp: { capable: true, title: 'চাঁপাই ম্যাঙ্গো', statusBarStyle: 'default' },
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
