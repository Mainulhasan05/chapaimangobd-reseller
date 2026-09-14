import { t } from '@/lib/i18n/bn';
import type { DeliveryZone, PublicShop } from '@/lib/types';
import { OrderForm } from '@/components/order-form';
import { ClosedNotice, Section, SectionTitle } from './parts';

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
}: {
  slug: string;
  shop: PublicShop;
  zones: DeliveryZone[];
  className?: string;
  title?: string;
}) {
  return (
    <Section id="order" className={className}>
      <SectionTitle sub={shop.acceptingOrders === false ? undefined : t('landing.orderHelp')}>
        {title}
      </SectionTitle>
      {shop.acceptingOrders === false ? (
        <ClosedNotice />
      ) : (
        <OrderForm slug={slug} shop={shop} zones={zones} />
      )}
    </Section>
  );
}
