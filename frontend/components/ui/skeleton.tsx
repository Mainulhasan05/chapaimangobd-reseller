import { cn } from '@/lib/utils';

/*
 * Skeletons rather than a spinner, because the target device is a cheap Android
 * phone on a slow connection and a centred spinner says only "wait". A shape
 * that matches the content coming says how long, and stops the page jumping
 * when it lands.
 *
 * Each shape here mirrors the component it stands in for. When a card gains a
 * part, such as the icon chip a stat card now wears, its skeleton gains the same
 * part, or the page visibly reflows the moment the data arrives.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('shimmer rounded-md', className)} />;
}

/** The four figures at the top of a dashboard, icon chip and all. */
export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card p-4">
          <Skeleton className="mb-3 h-9 w-9 rounded-full" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-7 w-16" />
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
        <div key={index} className="card flex items-center gap-3 p-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Rows inside an already-drawn table.
 *
 * The header row stays real while these load, so the columns do not jump when
 * the data lands. Hidden below `sm` for the same reason the table is: phones get
 * `ListSkeleton` instead, matching the cards they will actually be shown.
 */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className="border-b border-border last:border-b-0">
          {Array.from({ length: cols }, (_, col) => (
            <td key={col} className="px-4 py-3.5">
              <Skeleton className={cn('h-4', col === 0 ? 'w-24' : 'w-16')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Product cards on the catalog and the public shop. */
export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card space-y-3 p-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
