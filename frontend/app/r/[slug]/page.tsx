import { notFound } from 'next/navigation';
import Image from 'next/image';
import type { Metadata } from 'next';
import type { PublicShop, DeliveryZone } from '@/lib/types';
import { OrderForm } from '@/components/order-form';
import { Logo } from '@/components/ui/logo';
import { t } from '@/lib/i18n/bn';
import { Globe, MapPin, MessageCircle, Phone } from 'lucide-react';

/**
 * Server rendered, unlike the dashboards. This page is unauthenticated, is the
 * first thing a customer sees after tapping a WhatsApp link, and is opened on a
 * slow connection, so the markup should arrive complete.
 *
 * It calls the API origin directly rather than through the browser rewrite,
 * because there is no cookie to forward and no proxy hop worth paying for.
 */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

async function loadShop(slug: string): Promise<PublicShop | null> {
  const res = await fetch(`${apiOrigin}/api/public/shop/${encodeURIComponent(slug)}`, {
    // Prices and availability change during the day; a stale shop takes orders
    // for mangoes that are gone.
    next: { revalidate: 30 },
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.ok ? (body.data as PublicShop) : null;
}

async function loadZones(): Promise<DeliveryZone[]> {
  const res = await fetch(`${apiOrigin}/api/public/delivery-zones`, { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const body = await res.json();
  return body.ok ? (body.data.zones as DeliveryZone[]) : [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  // params is a Promise in Next 16; synchronous access was removed, not deprecated.
  const { slug } = await params;
  const shop = await loadShop(slug);
  if (!shop) return { title: t('shop.metaTitle') };

  /*
   * This link's whole life is being pasted into a chat, so the preview card is
   * the shop's storefront. Without it WhatsApp renders a bare URL and the
   * reseller's name never appears.
   */
  return {
    title: shop.shop.name,
    openGraph: {
      title: shop.shop.name,
      description: t('shop.metaDescription'),
      images: shop.shop.logoUrl ? [{ url: shop.shop.logoUrl }] : undefined,
    },
  };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop, zones] = await Promise.all([loadShop(slug), loadZones()]);

  if (!shop) notFound();

  return (
    // `pb-nav` keeps the last field clear of the order bar pinned to the bottom.
    <main className="mx-auto max-w-2xl px-4 py-6 pb-nav">
      {/*
       * The storefront header. This is the first thing a customer sees after
       * tapping a link in a chat, so it carries the shop's own mark where there
       * is one and falls back to the brand rather than to an empty gap.
       */}
      <header className="card elev-2 mb-6 flex flex-col items-center gap-3 p-6 text-center">
        {shop.shop.logoUrl ? (
          <Image
            src={shop.shop.logoUrl}
            alt={shop.shop.name}
            width={72}
            height={72}
            className="elev-1 h-18 w-18 rounded-2xl object-cover"
          />
        ) : (
          <Logo size="lg" />
        )}
        <h1 className="text-2xl font-bold tracking-tight">{shop.shop.name}</h1>

        {shop.shop.about && (
          <p className="max-w-prose text-sm text-muted-foreground">{shop.shop.about}</p>
        )}

        {/*
         * A way to reach a person, before a price list.
         *
         * A customer who has just followed a link from a chat is deciding
         * whether to hand money to a stranger. A phone number they can tap is
         * the cheapest possible answer to that, and it costs the page nothing
         * when the reseller has not filled one in.
         */}
        {(shop.shop.phone || shop.shop.whatsapp || shop.shop.facebookUrl) && (
          <div className="flex flex-wrap justify-center gap-2">
            {shop.shop.phone && (
              <ContactLink href={`tel:${shop.shop.phone}`} icon={Phone} label={shop.shop.phone} />
            )}
            {shop.shop.whatsapp && (
              <ContactLink
                // wa.me wants digits only, and a Bangladeshi number is written
                // locally as 01... which the international form drops.
                href={`https://wa.me/${waNumber(shop.shop.whatsapp)}`}
                icon={MessageCircle}
                label="WhatsApp"
                external
              />
            )}
            {shop.shop.facebookUrl && (
              <ContactLink
                href={shop.shop.facebookUrl}
                // lucide dropped its brand glyphs, so the page link gets the
                // generic one rather than a wrong-looking lookalike.
                icon={Globe}
                label="Facebook"
                external
              />
            )}
          </div>
        )}

        {shop.shop.address && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {shop.shop.address}
          </p>
        )}
      </header>

      <OrderForm slug={slug} shop={shop} zones={zones} />

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        {shop.shop.poweredBy}
      </footer>
    </main>
  );
}

/**
 * A Bangladeshi mobile number as wa.me wants it.
 *
 * People write their number the way they say it, 01712..., and wa.me needs the
 * country code with no punctuation. A number already carrying 880 is left alone,
 * so a reseller who typed the international form does not end up with it twice.
 */
function waNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('880')) return digits;
  return `880${digits.replace(/^0/, '')}`;
}

/** One tappable way to reach the shop. Sized for a thumb, not a mouse. */
function ContactLink({
  href,
  icon: Icon,
  label,
  external,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="tap inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </a>
  );
}
