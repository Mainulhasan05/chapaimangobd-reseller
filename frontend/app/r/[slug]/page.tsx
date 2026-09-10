import { notFound } from 'next/navigation';
import Image from 'next/image';
import type { Metadata } from 'next';
import type { PublicShop, DeliveryZone } from '@/lib/types';
import { OrderForm } from '@/components/order-form';

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
  if (!shop) return { title: 'দোকান' };

  /*
   * This link's whole life is being pasted into a chat, so the preview card is
   * the shop's storefront. Without it WhatsApp renders a bare URL and the
   * reseller's name never appears.
   */
  return {
    title: shop.shop.name,
    openGraph: {
      title: shop.shop.name,
      description: 'সরাসরি অর্ডার করুন',
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
      <header className="mb-6 flex flex-col items-center gap-3 text-center">
        {shop.shop.logoUrl && (
          <Image
            src={shop.shop.logoUrl}
            alt={shop.shop.name}
            width={64}
            height={64}
            className="h-16 w-16 rounded-full object-cover"
          />
        )}
        <h1 className="text-2xl font-semibold">{shop.shop.name}</h1>
      </header>

      <OrderForm slug={slug} shop={shop} zones={zones} />

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        {shop.shop.poweredBy}
      </footer>
    </main>
  );
}
