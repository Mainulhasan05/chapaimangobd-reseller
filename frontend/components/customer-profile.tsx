'use client';

import { TriangleAlert } from 'lucide-react';
import { t, tf } from '@/lib/i18n/bn';
import { formatMoney, formatNumber, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, Badge, Card, CardHeader, PhoneLink } from '@/components/ui/layout';
import type { Customer, CustomerVariant } from '@/lib/types';

/**
 * What one buyer has done, shown the same way to the owner and the reseller.
 *
 * The numbers behind it are not the same for both: the owner's come from the
 * shared customer record and span every shop, while the reseller's are computed
 * from their own orders alone. The shape is identical, which is why this is one
 * component, but a reseller is never shown another shop's totals.
 */

/** The two list shapes the API returns, flattened to something renderable. */
type Variant = CustomerVariant | string;

const valueOf = (v: Variant) => (typeof v === 'string' ? v : v.value);
const countOf = (v: Variant) => (typeof v === 'string' ? null : v.count);

/**
 * When a buyer's history is worth a warning.
 *
 * Cancelled and returned orders both cost the owner a courier run, and on cash
 * on delivery that is real money spent on a parcel that came back. Three is the
 * floor because one refusal is life and two is bad luck; a third alongside a
 * rate above a third is a pattern worth seeing before packing the next one.
 *
 * Exported for the list, which shows the same verdict as a chip on the card.
 */
export function isRisky(customer: Customer): boolean {
  const bad = customer.cancelledCount + customer.returnedCount;
  return bad >= 3 && bad / Math.max(customer.orderCount, 1) > 0.34;
}

export function CustomerProfile({ customer }: { customer: Customer }) {
  const bad = customer.cancelledCount + customer.returnedCount;

  return (
    <>
      {isRisky(customer) && (
        <Alert tone="danger" title={t('cust.riskyTitle')} icon={TriangleAlert}>
          <p className="mt-1">{t('cust.riskyHelp')}</p>
        </Alert>
      )}

      <Card className="mb-4">
        <CardHeader
          title={customer.name ?? customer.phone}
          subtitle={<PhoneLink phone={customer.phone} />}
          action={
            <Badge tone={customer.orderCount > 1 ? 'success' : 'neutral'} dot>
              {customer.orderCount > 1 ? t('cust.repeat') : t('cust.firstTime')}
            </Badge>
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label={t('cust.orders')} value={formatNumber(customer.orderCount)} />
          <Figure
            label={t('cust.delivered')}
            value={formatNumber(customer.deliveredCount)}
            tone="success"
          />
          {/*
           * Cancelled and returned side by side, each counted, because both cost
           * a courier run. The label says both, where it used to say only
           * "cancelled" while its colour counted the returns too.
           */}
          <Figure
            label={t('customers.badFigure')}
            value={`${formatNumber(customer.cancelledCount)} / ${formatNumber(customer.returnedCount)}`}
            tone={bad > 0 ? 'danger' : undefined}
          />
          <Figure label={t('cust.spend')} value={formatMoney(customer.totalSpend)} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Detail label={t('cust.firstOrder')} value={formatDate(customer.firstOrderAt)} />
          <Detail label={t('cust.lastOrder')} value={formatDate(customer.lastOrderAt)} />
          {customer.shopCount !== undefined && (
            <Detail label={t('cust.shops')} value={formatNumber(customer.shopCount)} />
          )}
        </dl>
      </Card>

      {/*
       * The names, which is the whole reason this screen exists.
       *
       * One person orders for themselves, then for a relative, then for a
       * neighbour, all from the same phone. Every one of those is this buyer,
       * and a list of orders keyed on the name would have shown three unrelated
       * strangers who each ordered once.
       */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <VariantCard title={t('cust.namesUsed')} items={customer.names} />
        <VariantCard title={t('cust.addressesUsed')} items={customer.addresses} />
      </div>

      {customer.altPhones && customer.altPhones.length > 0 && (
        <Card className="mb-4">
          <CardHeader title={t('cust.altPhones')} />
          <ul className="flex flex-wrap gap-2">
            {customer.altPhones.map((phone) => (
              <li key={phone}>
                <PhoneLink phone={phone} className="rounded-lg bg-subtle px-2.5 text-sm" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function VariantCard({ title, items }: { title: string; items: Variant[] }) {
  if (!items || items.length === 0) return null;

  return (
    <Card>
      <CardHeader title={title} />
      <ul className="-my-1 divide-y divide-border">
        {items.map((item) => {
          const count = countOf(item);
          return (
            <li key={valueOf(item)} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0 flex-1 break-words text-sm">{valueOf(item)}</span>
              {/*
               * How often, when the API counted it. The reseller's aggregation
               * returns bare values, so the chip simply does not appear there.
               */}
              {count !== null && count > 1 && (
                <span className="tabular shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
                  {tf('cust.timesUsed', { n: formatNumber(count) })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular text-lg font-bold',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger'
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}
