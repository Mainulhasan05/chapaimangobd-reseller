'use client';
import { MapPin } from 'lucide-react';

import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney, formatQuantity, formatDateTime } from '@/lib/format';
import type { Order } from '@/lib/types';
import { Badge, statusTone } from '@/components/ui/layout';

/**
 * Read-only view of one order, without a frame. Rendered by the order pages at
 * `/owner/orders/[id]` and `/reseller/orders/[id]`, which is where list rows,
 * customer histories and notifications all lead. `showCost` is what separates
 * the reseller and owner view from anything a customer could ever be shown.
 */
export function OrderDetailBody({ order, showCost }: { order: Order; showCost?: boolean }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(order.status)} dot>
          {tStatus(order.status)}
        </Badge>
        <Badge>{order.paymentMode === 'cod' ? t('order.cod') : t('order.prepaid')}</Badge>
        <span className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</span>
      </div>

      <section className="mb-4 rounded-lg bg-muted p-3 text-sm">
        <h3 className="mb-1 font-medium">{t('order.customer')}</h3>
        <p>{order.customer.name}</p>
        <p className="tabular text-muted-foreground">{order.customer.phoneE164}</p>
        <p className="text-muted-foreground">
          {order.customer.address}, {order.customer.district}
        </p>
        {order.customer.note && <p className="mt-1 italic text-muted-foreground">{order.customer.note}</p>}
      </section>

      <section className="mb-4">
        <h3 className="mb-2 text-sm font-medium">{t('order.items')}</h3>
        <div className="scroll-x">
          <table className="w-full min-w-[24rem] text-sm">
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="py-2">
                    <div>{item.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatQuantity(item.quantity, item.unit)} ×{' '}
                      {formatMoney(item.sellPrice)}
                      {showCost && ` · ${t('catalog.costPrice')} ${formatMoney(item.costPrice)}`}
                    </div>
                    {/*
                     * The orchard this line is collected from, named from the
                     * order's own snapshot. It appears once the owner has
                     * accepted; before that nobody has decided.
                     */}
                    {showCost && item.sourceName && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                        {item.sourceName}
                      </div>
                    )}
                  </td>
                  <td className="tabular py-2 text-right">{formatMoney(item.lineSell)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <dl className="space-y-1 rounded-lg bg-muted p-3 text-sm">
        <Row label={t('order.deliveryCharge')} value={formatMoney(order.deliveryCharge)} />
        <Row label={t('order.customerTotal')} value={formatMoney(order.totals.customerTotal)} strong />
        {showCost && (
          <>
            <Row label={t('order.walletDebit')} value={formatMoney(order.totals.walletDebit)} />
            <Row label={t('order.yourProfit')} value={formatMoney(order.totals.resellerMargin)} />
          </>
        )}
      </dl>

      {order.courier?.name && (
        <p className="mt-4 text-sm text-muted-foreground">
          {t('order.courier')}: {order.courier.name}
          {order.courier.trackingNumber && ` · ${order.courier.trackingNumber}`}
        </p>
      )}

      {order.cancelReason && (
        <p className="mt-4 text-sm text-danger">
          {t('order.cancelReason')}: {order.cancelReason}
        </p>
      )}

      <section className="mt-5">
        <h3 className="mb-2 text-sm font-medium">{t('app.status')}</h3>
        <ol className="space-y-1 text-xs text-muted-foreground">
          {order.statusHistory.map((entry, index) => (
            <li key={`${entry.status}-${index}`} className="flex justify-between gap-3">
              <span>{tStatus(entry.status)}</span>
              <span>{formatDateTime(entry.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}
