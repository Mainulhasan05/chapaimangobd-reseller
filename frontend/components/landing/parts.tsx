import Image from 'next/image';
import {
  CircleCheck,
  Clock,
  Gift,
  Globe,
  Heart,
  Leaf,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Shield,
  Snowflake,
  Star,
  Store,
  Sun,
  Truck,
  Wallet,
} from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { percentOff, videoEmbed, waNumber } from '@/lib/landing';
import { externalHref } from '@/lib/url';
import { cn } from '@/lib/utils';
import type { LandingContent, LandingIcon, ProductImage, PublicShop } from '@/lib/types';

/**
 * The building blocks every landing design is assembled from.
 *
 * Server components, no state: the page has to arrive complete on a slow
 * connection, and nothing here needs a script to be read. Colour comes from
 * CSS variables the design sets on its root (`--lp-*`), so one block serves all
 * three designs and a design is a layout plus a palette rather than a fork.
 */

export type Shop = PublicShop['shop'];

const ICONS: Record<LandingIcon, React.ComponentType<{ className?: string }>> = {
  leaf: Leaf,
  shield: Shield,
  truck: Truck,
  star: Star,
  heart: Heart,
  package: Package,
  clock: Clock,
  sun: Sun,
  check: CircleCheck,
  gift: Gift,
  snowflake: Snowflake,
  wallet: Wallet,
};

export function LandingGlyph({ name, className }: { name: LandingIcon; className?: string }) {
  const Icon = ICONS[name] ?? CircleCheck;
  return <Icon aria-hidden className={className} />;
}

/** The big button that takes a customer to the form, in the design's accent. */
export function Cta({
  children,
  href = '#order',
  tone = 'accent',
  className,
  external,
}: {
  children: React.ReactNode;
  href?: string;
  tone?: 'accent' | 'primary' | 'light' | 'outline';
  className?: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={cn(
        'tap inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 text-base font-bold transition-[filter,transform] hover:brightness-110 active:scale-[0.98]',
        tone === 'accent' && 'bg-(--lp-accent) text-(--lp-accent-fg) shadow-lg shadow-black/10',
        tone === 'primary' && 'bg-(--lp-primary) text-(--lp-primary-fg) shadow-lg shadow-black/10',
        tone === 'light' && 'bg-white text-(--lp-ink) shadow-lg shadow-black/10',
        tone === 'outline' && 'border-2 border-current bg-transparent',
        className
      )}
    >
      {children}
    </a>
  );
}

export function SectionTitle({
  children,
  sub,
  className,
}: {
  children: React.ReactNode;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 text-center', className)}>
      <h2 className="font-(family-name:--lp-heading) text-2xl leading-snug font-bold text-(--lp-ink) sm:text-3xl">
        {children}
      </h2>
      {sub && <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Mobile first: full width with a gutter, capped for a desktop reader. */
export function Section({
  id,
  className,
  children,
  wide,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section id={id} className={cn('scroll-mt-20 px-4 py-10 sm:py-14', className)}>
      <div className={cn('mx-auto', wide ? 'max-w-5xl' : 'max-w-2xl')}>{children}</div>
    </section>
  );
}

/** The shop's mark: its logo, or its initial on the design's colour. */
export function ShopMark({ shop, size = 44 }: { shop: Shop; size?: number }) {
  if (shop.logoUrl) {
    return (
      <Image
        src={shop.logoUrl}
        alt={shop.name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-2 ring-white/70"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-(--lp-primary) font-bold text-(--lp-primary-fg)"
      style={{ width: size, height: size }}
    >
      <Store className="h-1/2 w-1/2" />
    </span>
  );
}

/**
 * The photographs at the top of a page, swiped rather than auto-played. CSS
 * scroll snapping only: a carousel script is weight a cheap phone pays for on a
 * page whose job is to load fast.
 */
export function HeroGallery({
  images,
  alt,
  className,
  rounded = 'rounded-2xl',
}: {
  images: ProductImage[];
  alt: string;
  className?: string;
  rounded?: string;
}) {
  if (images.length === 0) return null;
  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          rounded
        )}
      >
        {images.map((image, index) => (
          <div key={image.id} className="relative aspect-[4/3] w-full shrink-0 snap-center">
            <Image
              src={image.url}
              alt={`${alt} ${formatNumber(index + 1)}`}
              fill
              sizes="(min-width: 768px) 560px, 100vw"
              className="object-cover"
              priority={index === 0}
            />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <span className="tabular pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
          ⇆ {formatNumber(images.length)}
        </span>
      )}
    </div>
  );
}

/** The photographs a page opens with: the owner's, else the products' own. */
export function heroImagesFor(shop: PublicShop): ProductImage[] {
  if (shop.landing.heroImages.length > 0) return shop.landing.heroImages;
  return shop.products.flatMap((product) => product.images).slice(0, 6);
}

/** Rating and customer count, shown only when the owner stated them. */
export function TrustStats({
  landing,
  className,
}: {
  landing: LandingContent;
  className?: string;
}) {
  if (landing.rating == null && !landing.customerCount) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {landing.rating != null && (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-neutral-900">
          <Star aria-hidden className="h-4 w-4 fill-amber-400 text-amber-400" />
          <span className="tabular">{formatNumber(landing.rating)}</span>
          <span className="font-normal text-neutral-600">{t('landing.rating')}</span>
        </span>
      )}
      {landing.customerCount && (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-neutral-900">
          <Heart aria-hidden className="h-4 w-4 fill-rose-500 text-rose-500" />
          {landing.customerCount}
          <span className="font-normal text-neutral-600">{t('landing.customers')}</span>
        </span>
      )}
    </div>
  );
}

export function BadgeRow({
  badges,
  className,
}: {
  badges: LandingContent['badges'];
  className?: string;
}) {
  if (badges.length === 0) return null;
  return (
    <ul
      className={cn(
        'grid gap-3',
        badges.length >= 3 ? 'grid-cols-3' : 'grid-cols-2',
        badges.length === 4 && 'grid-cols-2 sm:grid-cols-4',
        className
      )}
    >
      {badges.map((badge) => (
        <li
          key={badge.label}
          className="flex flex-col items-center gap-2 rounded-2xl bg-surface p-3 text-center shadow-sm ring-1 ring-black/5"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-(--lp-soft) text-(--lp-primary)">
            <LandingGlyph name={badge.icon} className="h-5 w-5" />
          </span>
          <span className="text-xs leading-snug font-semibold text-(--lp-ink) sm:text-sm">
            {badge.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CheckList({ items, className }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('space-y-3', className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <CircleCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-(--lp-primary)" />
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function VideoBlock({ url, className }: { url: string; className?: string }) {
  const embed = videoEmbed(url);
  if (!embed) return null;
  return (
    <div className={cn('overflow-hidden rounded-2xl bg-black shadow-lg', className)}>
      {embed.kind === 'youtube' ? (
        <iframe
          src={embed.src}
          title={t('landing.video')}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full"
        />
      ) : (
        <video src={embed.src} controls preload="metadata" playsInline className="aspect-video w-full" />
      )}
    </div>
  );
}

export function TipsGrid({ tips }: { tips: LandingContent['tips'] }) {
  if (tips.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {tips.map((tip) => (
        <li key={tip.title} className="flex gap-3 rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-black/5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--lp-soft) text-(--lp-primary)">
            <LandingGlyph name={tip.icon} className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-(--lp-ink)">{tip.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{tip.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Customer reviews. Screenshots of real chats are what buyers here trust, so
 * they get the room; a written quote without one is a card beside them.
 */
export function ReviewsGrid({ reviews }: { reviews: LandingContent['reviews'] }) {
  if (reviews.length === 0) return null;
  return (
    <ul className="columns-1 gap-3 sm:columns-2 [&>li]:mb-3">
      {reviews.map((review) => (
        <li
          key={review.id}
          className="break-inside-avoid overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5"
        >
          {review.image && (
            <Image
              src={review.image.url}
              alt={review.name || t('landing.reviews')}
              width={600}
              height={800}
              sizes="(min-width: 640px) 320px, 100vw"
              className="h-auto w-full"
              loading="lazy"
            />
          )}
          {(review.text || review.name) && (
            <div className="p-4">
              <div className="mb-1 flex gap-0.5" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                ))}
              </div>
              {review.text && <p className="text-sm leading-relaxed">“{review.text}”</p>}
              {review.name && (
                <p className="mt-2 text-sm font-semibold text-(--lp-ink)">— {review.name}</p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Native disclosure: opens with no script, and is read out correctly as such. */
export function FaqList({ faqs }: { faqs: LandingContent['faqs'] }) {
  if (faqs.length === 0) return null;
  return (
    <div className="space-y-2">
      {faqs.map((faq) => (
        <details
          key={faq.q}
          className="group rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 open:ring-(--lp-primary)/40"
        >
          <summary className="tap flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold text-(--lp-ink) [&::-webkit-details-marker]:hidden">
            {faq.q}
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--lp-soft) text-lg leading-none text-(--lp-primary) transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
        </details>
      ))}
    </div>
  );
}

/**
 * The reseller's way to be reached. Every one of these is the reseller's own
 * number, never the owner's: the customer bought from this shop.
 */
export function ContactButtons({
  shop,
  className,
  size = 'lg',
}: {
  shop: Shop;
  className?: string;
  size?: 'md' | 'lg';
}) {
  if (!shop.phone && !shop.whatsapp) return null;
  const base = cn(
    'tap inline-flex flex-1 items-center justify-center gap-2 rounded-xl font-bold text-white transition-[filter] hover:brightness-110',
    size === 'lg' ? 'min-h-12 px-5 text-base' : 'min-h-11 px-4 text-sm'
  );
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {shop.phone && (
        <a href={`tel:${shop.phone}`} className={cn(base, 'bg-sky-700')}>
          <Phone aria-hidden className="h-5 w-5" />
          {t('landing.callNow')}
        </a>
      )}
      {shop.whatsapp && (
        <a
          href={`https://wa.me/${waNumber(shop.whatsapp)}`}
          target="_blank"
          rel="noreferrer"
          className={cn(base, 'bg-[#128c4a]')}
        >
          <MessageCircle aria-hidden className="h-5 w-5" />
          {t('landing.whatsapp')}
        </a>
      )}
    </div>
  );
}

export function ContactSection({ shop, className }: { shop: Shop; className?: string }) {
  // The field holds whatever the reseller typed, so it becomes a followable
  // link here rather than at save time. Null for a scheme that runs code, which
  // is the one thing this is not drawn for. See lib/url.ts and docs/adr/0020.
  const facebookHref = externalHref(shop.facebookUrl);
  const anything = shop.phone || shop.whatsapp || facebookHref || shop.address;
  if (!anything) return null;
  return (
    <Section className={className}>
      <div className="rounded-3xl bg-(--lp-primary) p-6 text-center text-(--lp-primary-fg) shadow-xl sm:p-8">
        <div className="mb-3 flex justify-center">
          <ShopMark shop={shop} size={56} />
        </div>
        <h2 className="font-(family-name:--lp-heading) text-xl font-bold sm:text-2xl">
          {t('landing.contactTitle')}
        </h2>
        <p className="mx-auto mt-1 max-w-prose text-sm opacity-90">{shop.about || t('landing.contactHelp')}</p>

        <ContactButtons shop={shop} className="mx-auto mt-5 max-w-md" />

        {(facebookHref || shop.address) && (
          <div className="mt-4 flex flex-col items-center gap-2 text-sm opacity-95">
            {facebookHref && (
              <a
                href={facebookHref}
                target="_blank"
                rel="noreferrer"
                className="tap inline-flex items-center gap-1.5 font-semibold underline underline-offset-4"
              >
                <Globe aria-hidden className="h-4 w-4" />
                {t('landing.facebook')}
              </a>
            )}
            {shop.address && (
              <p className="flex items-center gap-1.5">
                <MapPin aria-hidden className="h-4 w-4 shrink-0" />
                {shop.address}
              </p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * Call and WhatsApp, always a thumb away. Lifted above the order bar on a
 * phone, where that bar is pinned to the bottom; beside the content on wider
 * screens, where it is not.
 */
export function FloatingContact({ shop }: { shop: Shop }) {
  if (!shop.phone && !shop.whatsapp) return null;
  return (
    <div className="fixed right-3 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2 sm:bottom-6">
      {shop.whatsapp && (
        <a
          href={`https://wa.me/${waNumber(shop.whatsapp)}`}
          target="_blank"
          rel="noreferrer"
          aria-label={t('landing.whatsapp')}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#128c4a] text-white shadow-lg ring-2 ring-white"
        >
          <MessageCircle aria-hidden className="h-6 w-6" />
        </a>
      )}
      {shop.phone && (
        <a
          href={`tel:${shop.phone}`}
          aria-label={t('landing.callNow')}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-700 text-white shadow-lg ring-2 ring-white"
        >
          <Phone aria-hidden className="h-6 w-6" />
        </a>
      )}
    </div>
  );
}

/**
 * The price a customer pays for one box, and the one struck through beside it.
 *
 * `label` is the box's own name, because a price is per box and "৪৩০ / কেজি"
 * would be a different and wrong statement. See docs/adr/0021.
 */
export function PriceTag({
  price,
  regularPrice,
  label,
  size = 'md',
}: {
  price: number;
  regularPrice?: number;
  label: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={cn('tabular font-bold text-(--lp-price)', size === 'lg' ? 'text-3xl' : 'text-xl')}>
        {formatMoney(price)}
      </span>
      <span className="text-sm text-muted-foreground">/ {label}</span>
      {regularPrice != null && (
        <>
          <s className="tabular text-sm text-muted-foreground">{formatMoney(regularPrice)}</s>
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
            {formatNumber(percentOff(price, regularPrice))}% {t('landing.off')}
          </span>
        </>
      )}
    </div>
  );
}

export function ClosedNotice() {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center" aria-live="polite">
      <span
        aria-hidden
        className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
      >
        <Store className="h-5 w-5" />
      </span>
      <h2 className="text-lg font-semibold">{t('shop.notAcceptingTitle')}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{t('shop.notAcceptingHelp')}</p>
    </div>
  );
}

export function ShopFooter({ shop, className }: { shop: Shop; className?: string }) {
  return (
    // The bottom padding keeps the last line clear of the pinned order bar.
    <footer className={cn('px-4 pt-8 pb-40 text-center text-xs text-muted-foreground sm:pb-10', className)}>
      <p className="font-semibold text-foreground">{shop.name}</p>
      <p className="mt-1">{shop.poweredBy}</p>
    </footer>
  );
}

export function PreviewBanner() {
  return (
    <div className="sticky top-0 z-50 bg-neutral-900 px-4 py-2 text-center text-xs font-semibold text-white">
      {t('landing.previewBanner')}
    </div>
  );
}
