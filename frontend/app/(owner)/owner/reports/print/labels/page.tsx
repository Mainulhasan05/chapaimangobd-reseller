'use client';

/**
 * Parcel labels: one per order, four to a sheet of A4, to cut and tape on.
 *
 * The order sheet is what the packing table reads; this is what the courier
 * reads. So it carries only what someone holding the parcel needs — whose it
 * is, where it goes, the number to ring, and above all whether to collect money
 * and how much. "প্রিপেইড" is printed as loudly as an amount would be, or a
 * prepaid parcel gets charged twice on the doorstep.
 *
 * Opened two ways: from the orders list with the selected orders (`ids`), or
 * for everything packed and waiting for a courier (`status=packed`, with the
 * list's dates). A4 cut in four is A6, which is what courier label pouches take.
 */

import { useSearchParams } from 'next/navigation';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { Printer } from 'lucide-react';
import { t, tf } from '@/lib/i18n/bn';
import { districtLabel } from '@/lib/districts';
import { formatMoney, formatNumber } from '@/lib/format';
import { useGetOrderQuery } from '@/lib/store/endpoints/orders';
import { useGetOrderSheetQuery } from '@/lib/store/endpoints/reports';
import { useGetSettingsQuery } from '@/lib/store/endpoints/settings';
import type { Order } from '@/lib/types';
import { Alert, EmptyState, ErrorState } from '@/components/ui/layout';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Skeleton, ListSkeleton } from '@/components/ui/skeleton';
import { itemAmount, shopOf } from '@/components/orders-panel';

/*
 * Paper rules for this sheet only. The shared print rules lay out an A4 report
 * with a page number in the margin; labels want the whole sheet, in quarters,
 * with nothing in the margin to cut through. Layout only: the colours are the
 * print tokens every other sheet uses.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 5mm; @bottom-right { content: none; } }
  .label-sheet { display: grid !important; grid-template-columns: 1fr 1fr; gap: 0 !important; }
  .parcel-label { height: 143mm; margin: 0 !important; border-radius: 0 !important; overflow: hidden; }
  .parcel-label:nth-child(4n) { break-after: page; }
}
`;

export default function ParcelLabelsPage() {
  const params = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const from = params.get('from');
  const to = params.get('to');

  // Without ids, everything packed and not yet shipped, oldest first.
  const sheet = useGetOrderSheetQuery(
    ids.length ? skipToken : { status: params.get('status') || 'packed', ...(from && to ? { from, to } : {}) }
  );
  const settings = useGetSettingsQuery(undefined, { refetchOnMountOrArgChange: 600 });
  const brand = settings.data?.settings;

  const count = ids.length || sheet.data?.orders.length || 0;

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="print-hide mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-2">
        <BackLink fallback="/owner/orders?status=packed" className="mb-0" />
        <div className="flex-1" />
        <p className="hidden text-xs text-muted-foreground md:block">{t('report.downloadHint')}</p>
        <Button size="sm" onClick={() => window.print()} disabled={count === 0}>
          <Printer aria-hidden className="h-4 w-4" />
          {t('report.print')}
        </Button>
      </div>

      <div className="print-hide mx-auto mb-4 max-w-[210mm]">
        <h1 className="text-xl font-semibold">{t('orders.labelsTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {count ? tf('orders.labelsCount', { count: formatNumber(count) }) : null} {t('orders.labelsHint')}
        </p>
      </div>

      {!ids.length && sheet.isLoading && <ListSkeleton rows={3} />}
      {!ids.length && sheet.isError && (
        <ErrorState onRetry={() => sheet.refetch()} isRetrying={sheet.isFetching} error={sheet.error} />
      )}
      {!ids.length && sheet.data?.truncated && (
        <Alert tone="warning" className="print-hide mx-auto max-w-[210mm]">
          {t('report.truncated').replace('{n}', formatNumber(sheet.data.orders.length))}
        </Alert>
      )}
      {!ids.length && sheet.data && sheet.data.orders.length === 0 && (
        <EmptyState title={t('orders.labelsNone')} />
      )}

      <div className="label-sheet mx-auto grid max-w-[210mm] gap-3 sm:grid-cols-2">
        {ids.length
          ? ids.map((id) => (
              <LabelById key={id} id={id} brandName={brand?.businessName} supportPhone={brand?.supportPhone} />
            ))
          : sheet.data?.orders.map((order) => (
              <ParcelLabel
                key={order.id}
                order={order}
                brandName={brand?.businessName}
                supportPhone={brand?.supportPhone}
              />
            ))}
      </div>
    </>
  );
}

/** The number as a courier dials it: `01…`, not `+8801…`. */
function localPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('880') ? `0${digits.slice(3)}` : phone;
}

/** A selected order, read on its own. The list's own rows are not reachable from here. */
function LabelById({ id, brandName, supportPhone }: { id: string; brandName?: string; supportPhone?: string }) {
  const query = useGetOrderQuery({ role: 'owner', id });
  if (query.data) {
    return <ParcelLabel order={query.data.order} brandName={brandName} supportPhone={supportPhone} />;
  }
  if (query.isError) {
    return (
      <div className="parcel-label print-hide rounded-xl border border-dashed border-border p-4 text-sm text-danger">
        {t('orders.labelFailed')}
      </div>
    );
  }
  return <Skeleton className="parcel-label h-72 w-full rounded-xl" />;
}

/**
 * One label. The address is never truncated: somebody reads this standing in a
 * lane looking for a house. The amount to collect is the largest thing on it.
 */
function ParcelLabel({
  order,
  brandName,
  supportPhone,
}: {
  order: Order;
  brandName?: string;
  supportPhone?: string;
}) {
  const isCod = order.paymentMode === 'cod';
  const shop = shopOf(order);

  return (
    <article className="parcel-label print-block flex flex-col rounded-xl border-2 border-dashed border-border bg-surface p-4 text-foreground print:border">
      <header className="flex items-start justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0 text-xs">
          <p className="font-semibold">{brandName}</p>
          {supportPhone && <p className="tabular text-muted-foreground">{supportPhone}</p>}
        </div>
        <p className="tabular shrink-0 text-xl font-bold leading-none">{order.orderCode}</p>
      </header>

      <section className="mt-2 min-w-0 flex-1">
        <p className="text-[0.6875rem] font-semibold text-muted-foreground">{t('orders.labelTo')}</p>
        <p className="text-lg font-bold leading-snug [overflow-wrap:anywhere]">{order.customer.name}</p>
        <p className="tabular text-base font-semibold">
          {localPhone(order.customer.phoneE164)}
          {order.customer.altPhoneE164 && (
            <span className="font-normal text-muted-foreground">
              {' '}
              · {localPhone(order.customer.altPhoneE164)}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm leading-snug [overflow-wrap:anywhere]">{order.customer.address}</p>
        <p className="text-base font-bold">{districtLabel(order.customer.district)}</p>
        {order.customer.note && (
          <p className="mt-1 text-xs italic text-muted-foreground">{order.customer.note}</p>
        )}

        <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">{item.productName}</span>
              <span className="tabular shrink-0 font-semibold">{itemAmount(item)}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-2 border-t-2 border-foreground pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{isCod ? t('orders.courierCollects') : t('order.prepaid')}</p>
          <p className="tabular text-2xl font-bold leading-none">
            {isCod ? formatMoney(order.totals.customerTotal) : t('orders.labelNoCash')}
          </p>
        </div>
        <p className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {shop ? `${t('orders.reseller')}: ${shop.shopName}` : ''}
          </span>
          {order.courier?.name && (
            <span className="tabular shrink-0">
              {order.courier.name}
              {order.courier.trackingNumber ? ` · ${order.courier.trackingNumber}` : ''}
            </span>
          )}
        </p>
      </footer>
    </article>
  );
}
