'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ArrowLeft } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';

/**
 * The arrow at the top of a detail page.
 *
 * It used to be a plain link to the list, which opened the list fresh: the tab,
 * the search and every page loaded with "load more" were gone, so an owner
 * working down a queue started again from the top after every order. When the
 * page was reached from inside the app this goes back instead, which returns the
 * list exactly as it was (its filters are in the URL). Opened from a
 * notification or a shared link, there is nothing to go back to, so it falls
 * back to the list.
 */
export function BackLink({
  fallback,
  label,
  className,
}: {
  fallback: Route;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        const cameFromApp =
          typeof document !== 'undefined' &&
          document.referrer.startsWith(window.location.origin) &&
          window.history.length > 1;
        if (cameFromApp) {
          event.preventDefault();
          router.back();
        }
      }}
      className={cn(
        'tap -ml-2 mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className
      )}
    >
      <ArrowLeft aria-hidden className="h-4 w-4" />
      {label ?? t('app.back')}
    </Link>
  );
}
