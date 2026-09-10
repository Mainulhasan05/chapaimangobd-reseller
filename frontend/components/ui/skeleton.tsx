import { cn } from '@/lib/utils';

/*
 * Skeletons rather than a spinner, because the target device is a cheap Android
 * phone on a slow connection and a centred spinner says only "wait". A shape
 * that matches the content coming says how long, and stops the page jumping
 * when it lands.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('shimmer rounded-md', className)} />;
}

/** The three or four figures at the top of a dashboard. */
export function StatSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card p-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-2 h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A list of orders, deposits or notifications. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="লোড হচ্ছে">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="card flex items-center justify-between gap-3 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Product cards on the catalog and the public shop. */
export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card space-y-3 p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}
