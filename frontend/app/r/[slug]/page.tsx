import { notFound } from 'next/navigation';
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
  return { title: shop ? shop.shop.name : 'দোকান' };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop, zones] = await Promise.all([loadShop(slug), loadZones()]);

  if (!shop) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-semibold">{shop.shop.name}</h1>
      </header>

      <OrderForm slug={slug} shop={shop} zones={zones} />

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        {shop.shop.poweredBy}
      </footer>
    </main>
  );
}
