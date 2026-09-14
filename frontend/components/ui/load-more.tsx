'use client';

import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * The foot of a paged list: a full-width "load more" on a phone, or a quiet
 * line saying everything is already on screen.
 *
 * Every paged list in the app ends the same way, whether the API pages by
 * number or by cursor, so the list only has to say whether there is more.
 * `shown` and `total` add the "20 / 57" line where the API knows a total.
 */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  error,
  shown,
  total,
  compact,
  className,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** A failed next page. The rows already loaded stay; this says the rest did not come. */
  error?: unknown;
  shown?: number;
  total?: number;
  /** Tighter spacing, for a list inside a sheet. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2', compact ? 'mt-3' : 'mt-4', className)}>
      {error ? <p className="text-center text-xs text-danger">{errorMessage(error)}</p> : null}

      {hasMore ? (
        <Button
          variant="outline"
          full
          size={compact ? 'sm' : 'md'}
          loading={loading}
          onClick={onLoadMore}
          className="sm:w-auto"
        >
          {error ? t('app.retry') : t('app.loadMore')}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t('app.allLoaded')}</p>
      )}

      {shown != null && total != null && (
        <p className="tabular text-xs text-muted-foreground">
          {formatNumber(shown)} / {formatNumber(total)}
        </p>
      )}
    </div>
  );
}
