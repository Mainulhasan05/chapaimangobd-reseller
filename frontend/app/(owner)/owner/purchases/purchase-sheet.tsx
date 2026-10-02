'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatDate, formatMoney } from '@/lib/format';
import type { Purchase, PurchaseLine } from '@/lib/types';
import { useGetPurchaseQuery } from '@/lib/store/endpoints/cost';
import { Badge, ErrorState } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ListSkeleton } from '@/components/ui/skeleton';
import { LandedCostWorking, PurchaseLines } from './purchase-lines';

/**
 * One purchase, opened by id from a link (`/owner/purchases?purchase=<id>`):
 * a supply's movement, a payee's খাতা. Read on its own rather than looked up in
 * the list, because the purchase is usually outside the range the list is on.
 *
 * The "কীভাবে?" working opens inside this sheet, not as a second one on top of
 * it, so Back and the ✕ always mean one step.
 */
export function PurchaseSheet({
  id,
  onClose,
  onCancel,
  onReenter,
}: {
  id: string;
  onClose: () => void;
  onCancel: (purchase: Purchase) => void;
  onReenter: (purchase: Purchase) => void;
}) {
  const query = useGetPurchaseQuery({ id });
  const [why, setWhy] = useState<PurchaseLine | null>(null);
  const purchase = query.data?.purchase;
  const cancelled = purchase?.status === 'cancelled';

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={why ? t('why.avgCost') : (purchase?.purchaseCode ?? t('nav.purchases'))}
      footer={
        why ? (
          <Button onClick={() => setWhy(null)}>{t('why.close')}</Button>
        ) : purchase ? (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('app.close')}
            </Button>
            {/* No edit, ever: a purchase is cancelled and re-entered. */}
            {cancelled ? (
              <Button variant="outline" onClick={() => onReenter(purchase)}>
                <RotateCcw className="h-4 w-4" />
                {t('purchase.reenter')}
              </Button>
            ) : (
              <Button variant="danger" onClick={() => onCancel(purchase)}>
                {t('purchase.cancel')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {query.isLoading && <ListSkeleton rows={2} />}

      {query.isError && !purchase && (
        <ErrorState onRetry={() => query.refetch()} isRetrying={query.isFetching} error={query.error} />
      )}

      {purchase && why && <LandedCostWorking purchase={purchase} line={why} />}

      {purchase && !why && (
        <>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/owner/payees/${purchase.payee}`}
                className="tap inline-flex items-center font-semibold text-primary-ink hover:underline"
              >
                {purchase.payeeNameBn}
              </Link>
              <p className="text-xs text-muted-foreground">
                {formatDate(purchase.businessDate)}
                {purchase.invoiceNo && ` · ${purchase.invoiceNo}`}
              </p>
            </div>
            <div className="text-right">
              {cancelled && (
                <Badge tone="danger" dot>
                  {t('purchase.cancelled')}
                </Badge>
              )}
              <p className="tabular mt-1 text-xl font-bold">{formatMoney(purchase.total)}</p>
              <p className="text-[0.6875rem] text-muted-foreground">{t('purchase.total')}</p>
            </div>
          </div>

          {cancelled && purchase.cancelReason && (
            <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs">
              {t('purchase.cancelledReasonLabel')}: {purchase.cancelReason}
            </p>
          )}

          <PurchaseLines purchase={purchase} onWhy={setWhy} />
        </>
      )}
    </Modal>
  );
}
