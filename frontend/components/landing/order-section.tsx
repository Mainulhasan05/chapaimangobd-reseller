import { t } from '@/lib/i18n/bn';
import type { DeliveryZone, PublicShop } from '@/lib/types';
import { OrderForm } from '@/components/order-form';
import { ClosedNotice, PriceTag, Section, SectionTitle } from './parts';

/**
 * Where every design sends its buttons. `#order` is the one anchor they all
 * link to, so a design can put its call to action anywhere without knowing how
 * far down the form ended up.
 *
 * A closed shop keeps its page and loses only the form: the reseller's contact
 * details are still what a customer who followed the link came for. See
 * docs/adr/0011.
 */
export function OrderSection({
  slug,
  shop,
  zones,
  className,
  title = t('landing.orderTitle'),
  preview,
}: {
  slug: string;
  shop: PublicShop;
  zones: DeliveryZone[];
  className?: string;
  title?: string;
  /**
   * The owner's editor preview. There is no shop behind it to order from, so
   * the packages and their prices are shown as they will read, and the form
   * itself is a placeholder rather than one that could place a real order.
   */
  preview?: boolean;
}) {
  return (
    <Section id="order" className={className}>
      <SectionTitle sub={shop.acceptingOrders === false ? undefined : t('landing.orderHelp')}>
        {title}
      </SectionTitle>
      {preview ? (
        <div className="space-y-3">
          {shop.products.map((product) => (
            <div key={product.id} className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-border">
              <p className="mb-1 font-bold text-(--lp-ink)">{product.name}</p>
              {product.variants.map((variant) => (
                <PriceTag key={variant.id} price={variant.price ?? 0} label={variant.label} />
              ))}
            </div>
          ))}
          <p className="rounded-2xl border-2 border-dashed border-border px-6 py-8 text-center text-sm font-semibold text-muted-foreground">
            {t('landingEditor.orderPlaceholder')}
          </p>
        </div>
      ) : shop.acceptingOrders === false ? (
        <ClosedNotice />
      ) : (
        <OrderForm slug={slug} shop={shop} zones={zones} />
      )}
    </Section>
  );
}
