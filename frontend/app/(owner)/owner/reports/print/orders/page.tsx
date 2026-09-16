'use client';

/**
 * The order sheet: every order in a range, printed, with everything a person
 * needs in their hand to pack it and hand it to a courier.
 *
 * This is the document the whole print pipeline exists for. It is built for the
 * physical job, not as a screenshot of the orders table: the pick list comes
 * first because collecting is what happens first, each order is a block that is
 * never torn across two sheets, the full address is spelled out rather than
 * truncated, and the amount to collect on delivery is the largest thing in the
 * block, because getting that number wrong costs real money.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t, tStatus, tUnit } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatQuantity } from '@/lib/format';
import type { OrderSheet, PickList } from '@/lib/types';
import { formatRange, rangeParams, type DateRange } from '@/components/ui/date-range';
import {
  Figure,
  KeyFigures,
  PrintBar,
  ReportFooter,
  ReportSection,
  ReportSheet,
  ReportTable,
  RTd,
  RTh,
  useAutoPrint,
} from '@/components/report/sheet';
import { Alert, ErrorState } from '@/components/ui/layout';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function OrderSheetPrintPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <OrderSheetView />
    </Suspense>
  );
}

function OrderSheetView() {
  const params = useSearchParams();

  const from = params.get('from');
  const to = params.get('to');
  const status = params.get('status') ?? '';
  const range: DateRange = from && to ? { from, to } : null;
  const query = [rangeParams(range), status ? `status=${status}` : '']
    .filter(Boolean)
    .join('&');

  const sheet = useQuery({
    queryKey: ['owner', 'order-sheet', from, to, status],
    queryFn: () => api.get<OrderSheet>(`/owner/reports/order-sheet${query ? `?${query}` : ''}`),
  });

  /*
   * The collection totals for the same orders. A second request rather than a
   * sum over the sheet, because the pick list groups per source and the sheet
   * does not carry enough to reconstruct that grouping honestly.
   */
  const pick = useQuery({
    queryKey: ['owner', 'pick-list', from, to],
    queryFn: () =>
      api.get<PickList>(`/owner/reports/pick-list${range ? `?${rangeParams(range)}` : ''}`),
  });

  const orders = sheet.data?.orders ?? [];
  useAutoPrint(sheet.isSuccess && pick.isSuccess, params.get('auto') === '1');

  if (sheet.isError) {
    return (
      <>
        <PrintBar back="/owner/orders" />
        <ErrorState onRetry={() => sheet.refetch()} isRetrying={sheet.isFetching} error={sheet.error} />
      </>
    );
  }

  const codTotal = orders
    .filter((order) => order.paymentMode === 'cod')
    .reduce((sum, order) => sum + order.totals.customerTotal, 0);

  return (
    <>
      <PrintBar back="/owner/orders" />

      {sheet.isLoading && <ListSkeleton />}

      {sheet.isSuccess && (
        <ReportSheet
          title={t('report.orderSheet')}
          subtitle={t('report.orderSheetHint')}
          range={formatRange(range)}
          meta={
            <>
              {t('report.orderCount').replace('{n}', formatNumber(orders.length))}
              {status ? ` · ${tStatus(status)}` : ''}
            </>
          }
        >
          {/*
           * Said on screen and on paper both. A sheet that silently stopped at
           * five hundred orders would be worked through to the end and the rest
           * would simply never be packed.
           */}
          {sheet.data.truncated && (
            <Alert tone="warning">
              {t('report.truncated').replace('{n}', formatNumber(orders.length))}
            </Alert>
          )}

          <KeyFigures>
            <Figure label={t('nav.orders')} value={formatNumber(orders.length)} />
            <Figure
              label={t('order.cod')}
              value={formatMoney(codTotal)}
              hint={t('owner.codInFlightHint')}
            />
            <Figure
              label={t('app.total')}
              value={formatMoney(
                orders.reduce((sum, order) => sum + order.totals.customerTotal, 0)
              )}
            />
            <Figure
              label={t('order.walletDebit')}
              value={formatMoney(orders.reduce((sum, order) => sum + order.totals.walletDebit, 0))}
            />
          </KeyFigures>

          {/*
           * Collection first, because it happens first. Someone reads this,
           * drives to the orchards, and only then starts packing the blocks
           * below; a sheet that opened with order one would have them making
           * the trip twice.
           */}
          {(pick.data?.products.length ?? 0) > 0 && (
            <ReportSection title={t('report.pickList')} hint={t('report.pickListHint')}>
              <ReportTable
                head={
                  <>
                    <RTh>{t('nav.products')}</RTh>
                    <RTh>{t('nav.sources')}</RTh>
                    <RTh align="right">{t('order.quantity')}</RTh>
                  </>
                }
              >
                {pick.data?.products.map((product) => (
                  <tr key={product.product} className="print-block">
                    <RTd className="font-semibold">{product.name}</RTd>
                    <RTd>
                      {product.sources.map((source, index) => (
                        <span key={`${source.sourceName ?? 'none'}-${index}`} className="block text-xs">
                          {source.sourceName ?? (
                            <span className="text-muted-foreground">{t('owner.pickUndecided')}</span>
                          )}
                          {' · '}
                          {formatQuantity(source.quantity, product.unit)}
                        </span>
                      ))}
                    </RTd>
                    <RTd align="right" className="tabular font-bold">
                      {formatNumber(product.quantity)} {tUnit(product.unit)}
                    </RTd>
                  </tr>
                ))}
              </ReportTable>
            </ReportSection>
          )}

          <ReportSection title={t('nav.orders')} breakBefore={orders.length > 0}>
            {orders.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('report.noRows')}</p>
            )}

            <div className="space-y-3">
              {orders.map((order, index) => (
                <OrderBlock key={order.id} order={order} index={index + 1} />
              ))}
            </div>
          </ReportSection>

          <ReportFooter note={`${t('report.checkedBy')}: ______________________`} />
        </ReportSheet>
      )}
    </>
  );
}

/**
 * One order, as a block that is never split across two sheets.
 *
 * A courier handed the top half of an address is handed nothing, which is the
 * rule the whole layout is arranged around. The address is printed in full and
 * never truncated: this is the copy that has to be read by someone standing in
 * a lane looking for a house.
 */
function OrderBlock({
  order,
  index,
}: {
  order: OrderSheet['orders'][number];
  index: number;
}) {
  const shopName = typeof order.reseller === 'object' ? order.reseller.shopName : '';
  const isCod = order.paymentMode === 'cod';

  return (
    <div className="print-block rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0">
          <p className="tabular text-sm font-bold">
            {formatNumber(index)}. {order.orderCode}
          </p>
          <p className="text-xs text-muted-foreground">
            {tStatus(order.status)}
            {shopName ? ` · ${shopName}` : ''}
            {order.deliveryZoneName ? ` · ${order.deliveryZoneName}` : ''}
          </p>
        </div>

        {/*
         * What the courier collects, or a clear statement that they collect
         * nothing. "Prepaid" has to be as loud as an amount would be, or a
         * prepaid parcel gets charged twice on the doorstep.
         */}
        <div className="shrink-0 text-right">
          <p className="tabular text-lg font-bold leading-none">
            {isCod ? formatMoney(order.totals.customerTotal) : t('order.prepaid')}
          </p>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {isCod ? t('order.cod') : t('order.paid')}
          </p>
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <p className="font-semibold">{order.customer.name}</p>
          <p className="tabular text-sm">{order.customer.phoneE164}</p>
          {order.customer.altPhoneE164 && (
            <p className="tabular text-sm text-muted-foreground">{order.customer.altPhoneE164}</p>
          )}
          {/* Never truncated: somebody reads this standing in the lane. */}
          <p className="mt-0.5 text-sm leading-snug">{order.customer.address}</p>
          <p className="text-sm text-muted-foreground">{order.customer.district}</p>
          {order.customer.note && (
            <p className="mt-1 text-xs italic text-muted-foreground">{order.customer.note}</p>
          )}
        </div>

        <div>
          <ul className="space-y-0.5">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0">
                  {item.productName}
                  {item.sourceName && (
                    <span className="text-xs text-muted-foreground"> · {item.sourceName}</span>
                  )}
                </span>
                <span className="tabular shrink-0 font-semibold">
                  {formatQuantity(item.quantity, item.unit)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-1.5 border-t border-border pt-1.5 text-sm">
            <Line label={t('order.items')} value={formatMoney(order.totals.sellSubtotal)} />
            <Line label={t('order.deliveryCharge')} value={formatMoney(order.deliveryCharge)} />
            <Line
              label={t('app.total')}
              value={formatMoney(order.totals.customerTotal)}
              bold
            />
          </div>

          {order.courier?.trackingNumber && (
            <p className="tabular mt-1 text-xs text-muted-foreground">
              {order.courier.name} · {order.courier.trackingNumber}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
