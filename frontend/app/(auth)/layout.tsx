import { Suspense } from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        {/* useSearchParams needs a suspense boundary during prerender. */}
        <Suspense fallback={null}>{children}</Suspense>
      </div>
    </main>
  );
}
