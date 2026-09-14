import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { PublicShop, DeliveryZone } from '@/lib/types';
import { t } from '@/lib/i18n/bn';
import { isLandingTemplate } from '@/lib/landing';
import { LandingPage } from '@/components/landing/templates';
import { PreviewBanner } from '@/components/landing/parts';

/**
 * Server rendered, unlike the dashboards. This page is unauthenticated, is the
 * first thing a customer sees after tapping a WhatsApp link, and is opened on a
 * slow connection, so the markup should arrive complete.
 *
 * It calls the API origin directly rather than through the browser rewrite,
 * because there is no cookie to forward and no proxy hop worth paying for.
 *
 * What it renders is a landing page in the design the reseller chose, built
 * from content the owner wrote once for every shop. See components/landing.
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
  if (!body.ok) return null;
  /*
   * A response cached before the API carried landing content has neither field,
   * and the data cache outlives a deploy by up to the revalidate window. Such a
   * shop renders the default design with nothing but its products.
   */
  const data = body.data as PublicShop;
  return { ...data, template: data.template ?? 'bagan', landing: data.landing ?? EMPTY_LANDING };
}

const EMPTY_LANDING: PublicShop['landing'] = {
  headline: '',
  subtitle: '',
  heroImages: [],
  videoUrl: '',
  rating: null,
  customerCount: '',
  deliveryNote: '',
  guaranteeNote: '',
  badges: [],
  whyUs: [],
  features: [],
  tips: [],
  reviews: [],
  faqs: [],
};

async function loadZones(): Promise<DeliveryZone[]> {
  const res = await fetch(`${apiOrigin}/api/public/delivery-zones`, { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const body = await res.json();
  return body.ok ? (body.data.zones as DeliveryZone[]) : [];
}

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ template?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // params is a Promise in Next 16; synchronous access was removed, not deprecated.
  const { slug } = await params;
  const shop = await loadShop(slug);
  if (!shop) return { title: t('shop.metaTitle') };

  /*
   * This link's whole life is being pasted into a chat, so the preview card is
   * the shop's storefront. Without it WhatsApp renders a bare URL and the
   * reseller's name never appears. The owner's first photograph sells better
   * than a logo, so it leads when there is one.
   */
  const image = shop.landing.heroImages[0]?.url ?? shop.shop.logoUrl;
  const description = shop.landing.subtitle || t('shop.metaDescription');
  return {
    title: shop.landing.headline ? `${shop.shop.name} · ${shop.landing.headline}` : shop.shop.name,
    description,
    openGraph: {
      title: shop.shop.name,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function ShopPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [shop, zones] = await Promise.all([loadShop(slug), loadZones()]);

  if (!shop) notFound();

  /*
   * `?template=` lets a reseller look at a design before choosing it. It only
   * changes what this one visit renders; the design customers get is the saved
   * one, and the banner says so, so a shared preview link cannot pass for it.
   */
  const preview = isLandingTemplate(query.template) && query.template !== shop.template;
  const template = preview && isLandingTemplate(query.template) ? query.template : shop.template;

  return (
    <>
      {preview && <PreviewBanner />}
      <LandingPage template={template} slug={slug} shop={shop} zones={zones} />
    </>
  );
}
