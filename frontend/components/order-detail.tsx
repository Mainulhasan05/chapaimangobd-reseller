'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { MapPin, PackageCheck, Pencil, Store, Truck, UserPen } from 'lucide-react';

import { t, tStatus, type DictKey } from '@/lib/i18n/bn';
import { districtLabel } from '@/lib/districts';
import { formatMoney, formatNumber, formatQuantity, formatDateTime } from '@/lib/format';
import type { Order, OrderCost, PaymentMode, StatusHistoryEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge, CopyButton, PhoneLink, statusTone } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';
import { ownerStatusLabel, shopOf } from '@/components/orders-panel';

/**
 * Read-only view of one order, without a frame. Rendered by the order pages at
 * `/owner/orders/[id]` and `/reseller/orders/[id]`, which is where list rows,
 * customer histories and notifications all lead.
 *
 * `scope` decides whose money is whose. The owner's copy used to label the
 * reseller's margin "আপনার লাভ", which on the owner's screen claimed the
 * reseller's earnings as the owner's. On the owner's copy it is "রিসেলারের
 * লাভ", the owner's own margin comes from `cost`, and the reseller is named.
 *
 * The `onEdit…` callbacks put an edit button beside the field they change. The
 * pages pass them only while the order's `actions` allow the change.
 */
export function OrderDetailBody({
  order,
  scope,
  cost,
  onEditDeliveryCharge,
  onEditCustomer,
  onEditCourier,
}: {
  order: Order;
  scope: 'owner' | 'reseller';
  /** The owner's side of the books, when the owner's detail carried it. */
  cost?: OrderCost;
  onEditDeliveryCharge?: () => void;
  onEditCustomer?: () => void;
  onEditCourier?: () => void;
}) {
  const toast = useToast();
  const owner = scope === 'owner';
  const isCod = order.paymentMode === 'cod';
  const shop = owner ? shopOf(order) : null;
  const shopId = shop?.id ?? shop?._id;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(order.status)} dot>
          {owner ? ownerStatusLabel(order.status) : tStatus(order.status)}
        </Badge>
        <Badge tone={isCod ? 'warning' : 'success'}>
          {isCod ? t('order.cod') : t('order.prepaid')}
        </Badge>
        <span className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</span>
      </div>

      <section className="mb-4 rounded-lg bg-muted p-3 text-sm">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="font-medium">{t('order.customer')}</h3>
          {onEditCustomer && (
            <button
              type="button"
              onClick={onEditCustomer}
              className="tap -my-1 inline-flex items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-primary-ink hover:bg-primary-softer"
            >
              <UserPen aria-hidden className="h-3.5 w-3.5" />
              {t('customerEdit.action')}
            </button>
          )}
        </div>
        <p className="font-semibold">{order.customer.name}</p>
        <p className="flex flex-wrap gap-x-4">
          <PhoneLink phone={order.customer.phoneE164} />
          <PhoneLink phone={order.customer.altPhoneE164} className="text-muted-foreground" />
        </p>
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {order.customer.address}, {districtLabel(order.customer.district)}
        </p>
        {order.customer.note && <p className="mt-1 italic text-muted-foreground">{order.customer.note}</p>}
      </section>

      {/*
       * Who sold it, and how to reach them. The order screen is where a
       * customer's call about a parcel lands, and the next call is often to the
       * reseller who took the order.
       */}
      {owner && shop && (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Store aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">{t('orders.reseller')}</span>
            {shopId ? (
              <Link
                href={`/owner/resellers/${shopId}` as Route}
                className="tap inline-flex min-w-0 items-center truncate font-semibold text-primary-ink hover:underline"
              >
                {shop.shopName}
              </Link>
            ) : (
              <span className="truncate font-semibold">{shop.shopName}</span>
            )}
          </span>
          <PhoneLink phone={shop.phone} className="text-sm" />
        </section>
      )}

      <section className="mb-4">
        <h3 className="mb-2 text-sm font-medium">{t('order.items')}</h3>
        {/*
         * Stacked rows, not a table: on a phone the table scrolled sideways and
         * the line totals were the column that fell off the edge.
         */}
        <ul className="divide-y divide-border text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {item.productName}
                  {item.variantLabel && (
                    <span className="font-normal text-muted-foreground"> · {item.variantLabel}</span>
                  )}
                </div>
                {/*
                 * Boxes at a price per box, with the weight in brackets so
                 * the packing table still knows what it is carrying. A line
                 * from before boxes existed has no count and reads as it
                 * always did. See docs/adr/0021.
                 */}
                <div className="tabular text-xs text-muted-foreground">
                  {item.boxes == null
                    ? formatQuantity(item.quantity, item.unit)
                    : `${t('catalog.boxCount').replace('{n}', formatNumber(item.boxes))} (${formatQuantity(item.quantity, item.unit)})`}{' '}
                  × {formatMoney(item.sellPrice)}
                  {` · ${t('catalog.costPrice')} ${formatMoney(item.costPrice)}`}
                </div>
                {/*
                 * The orchard this line is collected from, named from the
                 * order's own snapshot. It appears once the owner has
                 * accepted; before that nobody has decided.
                 */}
                {item.sourceName && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                    {item.sourceName}
                  </div>
                )}
              </div>
              <span className="tabular shrink-0">{formatMoney(item.lineSell)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/*
       * The money, as one block in the order it is asked about: what the
       * customer pays and who collects it, then what the reseller is billed and
       * keeps, then — on the owner's copy — what the owner keeps.
       */}
      <dl className="space-y-1 rounded-lg bg-muted p-3 text-sm">
        <Row label={t('orders.goodsSubtotal')} value={formatMoney(order.totals.sellSubtotal)} />
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{t('order.deliveryCharge')}</dt>
          <dd className="flex items-center gap-1.5">
            <span className="tabular">{formatMoney(order.deliveryCharge)}</span>
            {onEditDeliveryCharge && (
              <button
                type="button"
                onClick={onEditDeliveryCharge}
                aria-label={t('order.deliveryChargeEdit')}
                title={t('order.deliveryChargeEdit')}
                className="-my-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-primary-ink hover:bg-primary-softer sm:h-8 sm:w-8"
              >
                <Pencil aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </dd>
        </div>
        <Row label={t('orders.customerPays')} value={formatMoney(order.totals.customerTotal)} strong />
        {/*
         * Cash on delivery is what the courier must bring back; prepaid is said
         * just as loudly, or a prepaid parcel gets charged twice on the doorstep.
         */}
        {isCod ? (
          <Row
            label={t('orders.courierCollects')}
            value={formatMoney(order.totals.customerTotal)}
            tone="warning"
            strong
          />
        ) : (
          <p className="text-xs font-medium text-success">{t('orders.prepaidNothing')}</p>
        )}

        <div className="!mt-2 border-t border-border pt-2" />
        {owner ? (
          <>
            <Row
              label={t('orders.resellerBilled')}
              hint={t('orders.resellerBilledHint')}
              value={formatMoney(order.totals.walletDebit)}
            />
            <Row label={t('orders.resellerProfit')} value={formatMoney(order.totals.resellerMargin)} />
            {cost && (
              <Row
                label={cost.margin < 0 ? t('cost.loss') : t('orders.ownerMargin')}
                hint={t('orders.ownerMarginHint')}
                value={formatMoney(cost.margin)}
                tone={cost.margin < 0 ? 'danger' : 'success'}
                strong
              />
            )}
          </>
        ) : (
          <>
            <Row label={t('order.walletDebit')} value={formatMoney(order.totals.walletDebit)} />
            <Row label={t('order.yourProfit')} value={formatMoney(order.totals.resellerMargin)} strong />
          </>
        )}
      </dl>

      {order.courier?.name && (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Truck aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">{t('order.courier')}:</span>
          <span className="font-medium">{order.courier.name}</span>
          {order.courier.trackingNumber && (
            <span className="inline-flex items-center">
              <span className="tabular">· {order.courier.trackingNumber}</span>
              <CopyButton
                value={order.courier.trackingNumber}
                label={t('orders.copyTracking')}
                onCopied={() => toast(t('orders.trackingCopied'), 'neutral')}
              />
            </span>
          )}
          {onEditCourier && (
            <button
              type="button"
              onClick={onEditCourier}
              className="tap inline-flex items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-primary-ink hover:bg-primary-softer"
            >
              <Pencil aria-hidden className="h-3.5 w-3.5" />
              {t('orders.courierEdit')}
            </button>
          )}
        </div>
      )}

      {/*
       * Whether a returned parcel went back on the shelf. Shown either way to the
       * owner and the reseller, because "the stock did not come back" is as much
       * a decision as "it did", and both get asked about later.
       */}
      {order.status === 'returned' && (
        <p
          className={cn(
            'mt-4 flex items-center gap-1.5 text-sm',
            order.restockedOnReturn ? 'text-success' : 'text-muted-foreground'
          )}
        >
          <PackageCheck aria-hidden className="h-4 w-4 shrink-0" />
          {order.restockedOnReturn ? t('order.restocked') : t('order.notRestocked')}
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
          {order.statusHistory.map((entry, index) => {
            const detail = historyDetail(entry);
            // A correction to the delivery details carries the status the order
            // was already in. Labelled by what happened, not as that status again.
            const edited = entry.event === 'customer_edited';
            const courierEdited = entry.event === 'courier_edited';
            return (
              <li key={`${entry.status}-${index}`}>
                <div className="flex justify-between gap-3">
                  <span className={edited || courierEdited ? 'inline-flex items-center gap-1' : undefined}>
                    {edited && <UserPen aria-hidden className="h-3 w-3 shrink-0" />}
                    {courierEdited && <Truck aria-hidden className="h-3 w-3 shrink-0" />}
                    {edited
                      ? t('customerEdit.historyRow')
                      : courierEdited
                        ? t('orders.courierEditedRow')
                        : owner
                        ? ownerStatusLabel(entry.status)
                        : tStatus(entry.status)}
                  </span>
                  <span className="shrink-0">{formatDateTime(entry.at)}</span>
                </div>
                {detail && <p className="mt-0.5 text-foreground/80">{detail}</p>}
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

const modeLabel = (mode: PaymentMode): string =>
  mode === 'cod' ? t('order.cod') : t('order.prepaid');

/**
 * The line under a timeline step, if it has one.
 *
 * A payment mode change is rendered from its structured fields: the `note`
 * the server writes beside them is English. Any other note was typed by a
 * person, such as a return reason, and is shown as it was written. A cancel
 * reason is skipped here because the order already shows it above.
 */
function historyDetail(entry: StatusHistoryEntry): string | null {
  if (entry.event === 'customer_edited') return editedFields(entry.note);
  // The server's note on a courier correction is English; the row's label says it all.
  if (entry.event === 'courier_edited') return null;
  if (entry.paymentModeFrom && entry.paymentModeTo) {
    return t('order.paymentModeChanged')
      .replace('{from}', modeLabel(entry.paymentModeFrom))
      .replace('{to}', modeLabel(entry.paymentModeTo));
  }
  if (entry.status === 'cancelled') return null;
  return entry.note?.trim() || null;
}

/**
 * Which details a correction changed, in Bengali.
 *
 * The server's note is an English sentence ending in the field names
 * ("Customer details changed: address, phoneE164"). The names are stable
 * identifiers, so they are translated; the sentence around them is not shown.
 */
const EDITED_FIELD: Record<string, DictKey> = {
  name: 'customerEdit.fieldName',
  phoneE164: 'customerEdit.fieldPhone',
  phone: 'customerEdit.fieldPhone',
  address: 'customerEdit.fieldAddress',
  district: 'customerEdit.fieldDistrict',
};

function editedFields(note: string | undefined): string | null {
  const list = note?.split(':').pop();
  if (!list) return null;
  const names = list
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field in EDITED_FIELD)
    .map((field) => t(EDITED_FIELD[field]));
  return names.length > 0 ? t('customerEdit.changedFields').replace('{fields}', names.join(', ')) : null;
}

function Row({
  label,
  value,
  hint,
  strong,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  tone?: 'warning' | 'success' | 'danger';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0 text-muted-foreground">
        {label}
        {hint && <span className="block text-[0.6875rem]">{hint}</span>}
      </dt>
      <dd
        className={cn(
          'tabular shrink-0',
          strong && 'font-semibold',
          tone === 'warning' && 'text-warning-ink',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger'
        )}
      >
        {value}
      </dd>
    </div>
  );
}
