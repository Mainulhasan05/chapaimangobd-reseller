import { Suspense } from 'react';
import { t } from '@/lib/i18n/bn';
import { Logo } from '@/components/ui/logo';

/**
 * The frame around signing in and registering.
 *
 * The card used to sit alone on an empty page with no mark on it at all, which
 * on a phone is indistinguishable from any other login form on the internet.
 * The brand now sits above it, and a soft mango wash behind it keeps the two
 * screens that are not the app from looking like a different product.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      {/*
       * Two blurred discs rather than an image. No request, no layout shift, and
       * it degrades to a plain background wherever filters are unsupported.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size="lg" />
          <p className="text-lg font-bold tracking-tight">{t('app.name')}</p>
        </div>

        <div className="card elev-2 p-6 sm:p-8">
          {/* useSearchParams needs a suspense boundary during prerender. */}
          <Suspense fallback={null}>{children}</Suspense>
        </div>
      </div>
    </main>
  );
}
