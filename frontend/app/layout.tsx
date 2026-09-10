import type { Metadata } from 'next';
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
