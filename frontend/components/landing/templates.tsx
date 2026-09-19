import Image from 'next/image';
import { Phone, ShoppingBag, Truck } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DeliveryZone, LandingTemplate, PublicShop } from '@/lib/types';
import { roundedBengali, serifBengali } from './fonts';
import { themeStyle } from './theme';
import { OrderSection } from './order-section';
import {
  BadgeRow,
  CheckList,
  ContactButtons,
  ContactSection,
  Cta,
  FaqList,
  FloatingContact,
  HeroGallery,
  PriceTag,
  ReviewsGrid,
  Section,
  SectionTitle,
  ShopFooter,
  ShopMark,
  TipsGrid,
  TrustStats,
  VideoBlock,
  heroImagesFor,
} from './parts';

/**
 * The three landing designs. Each is an order of sections and a palette over
 * the same blocks and the same content, which is what lets a reseller switch
 * design without anyone rewriting a word. See backend domain/landing.js.
 *
 * A section with nothing in it renders nothing, so a design never shows an
 * empty heading where the owner has not written that part yet.
 */

type Props = { slug: string; shop: PublicShop; zones: DeliveryZone[] };

export function LandingPage({ template, ...props }: Props & { template: LandingTemplate }) {
  const Design = template === 'krishok' ? Krishok : template === 'offer' ? Offer : Bagan;
  return (
    <div
      style={themeStyle(template)}
      className={cn('min-h-screen', serifBengali.variable, roundedBengali.variable)}
    >
      <Design {...props} />
      <FloatingContact shop={props.shop.shop} />
    </div>
  );
}

/**
 * The reseller's number in the header, where a buyer looks for it first. The
 * number itself from `sm` up; on a phone a round call button, because the
 * header is already carrying the shop name and the order button.
 */
function HeaderCall({ shop }: { shop: PublicShop['shop'] }) {
  if (!shop.phone) return null;
  return (
    <a
      href={`tel:${shop.phone}`}
      aria-label={`${t('landing.callNow')} ${shop.phone}`}
      className="tap inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full border-2 border-(--lp-primary) px-2 text-sm font-bold text-(--lp-ink) sm:px-3"
    >
      <Phone aria-hidden className="h-4 w-4" />
      <span className="tabular hidden sm:inline">{shop.phone}</span>
    </a>
  );
}

/* ------------------------------------------------------------------ bagan -- */

/**
 * Premium orchard. A dark green hero with the headline in a serif, the
 * photographs swiped underneath, then trust, reasons and the packages.
 */
function Bagan({ slug, shop, zones }: Props) {
  const { landing } = shop;
  const info = shop.shop;
  const images = heroImagesFor(shop);

  return (
    <main>
      <header className="bg-(--lp-primary) text-(--lp-primary-fg)">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <ShopMark shop={info} size={40} />
          <p className="min-w-0 flex-1 truncate font-bold">{info.name}</p>
          {info.phone && (
            <a
              href={`tel:${info.phone}`}
              className="tap tabular rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold"
            >
              {info.phone}
            </a>
          )}
        </div>
      </header>

      <section className="bg-(--lp-primary) px-4 pt-6 pb-16 text-center text-(--lp-primary-fg)">
        <div className="mx-auto max-w-2xl">
          {landing.deliveryNote && (
            <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <Truck aria-hidden className="h-3.5 w-3.5" />
              {landing.deliveryNote}
            </p>
          )}
          <h1 className="font-(family-name:--lp-heading) text-3xl leading-tight font-bold sm:text-5xl">
            {landing.headline || info.name}
          </h1>
          {landing.subtitle && (
            <p className="mx-auto mt-3 max-w-prose text-base opacity-90 sm:text-lg">{landing.subtitle}</p>
          )}
          <TrustStats landing={landing} className="mt-4 justify-center" />
          <Cta className="mt-6 w-full sm:w-auto">
            <ShoppingBag aria-hidden className="h-5 w-5" />
            {t('landing.orderNow')}
          </Cta>
        </div>
      </section>

      {images.length > 0 && (
        <div className="-mt-10 px-4">
          <HeroGallery
            images={images}
            alt={landing.headline || info.name}
            className="mx-auto max-w-2xl shadow-2xl"
          />
        </div>
      )}

      {landing.badges.length > 0 && (
        <Section className="pb-0 sm:pb-0">
          <BadgeRow badges={landing.badges} />
        </Section>
      )}

      {landing.whyUs.length > 0 && (
        <Section>
          <SectionTitle>{t('landing.whyUs')}</SectionTitle>
          <div className="rounded-3xl bg-surface p-6 shadow-sm ring-1 ring-black/5">
            <CheckList items={landing.whyUs} />
            {landing.guaranteeNote && (
              <p className="mt-5 rounded-xl bg-(--lp-soft) p-3 text-center text-sm font-semibold text-(--lp-ink)">
                {landing.guaranteeNote}
              </p>
            )}
          </div>
        </Section>
      )}

      {landing.videoUrl && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.video')}</SectionTitle>
          <VideoBlock url={landing.videoUrl} />
        </Section>
      )}

      {landing.features.length > 0 && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.features')}</SectionTitle>
          <CheckList items={landing.features} />
        </Section>
      )}

      <OrderSection
        slug={slug}
        shop={shop}
        zones={zones}
        title={t('landing.packages')}
        className="bg-(--lp-soft)/60"
      />

      {landing.reviews.length > 0 && (
        <Section>
          <SectionTitle>{t('landing.reviews')}</SectionTitle>
          <ReviewsGrid reviews={landing.reviews} />
        </Section>
      )}

      {landing.tips.length > 0 && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.tips')}</SectionTitle>
          <TipsGrid tips={landing.tips} />
        </Section>
      )}

      {landing.faqs.length > 0 && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.faq')}</SectionTitle>
          <FaqList faqs={landing.faqs} />
        </Section>
      )}

      <ContactSection shop={info} className="pt-0 sm:pt-0" />
      <ShopFooter shop={info} />
    </main>
  );
}

/* ---------------------------------------------------------------- krishok -- */

/**
 * The farmer's guide. Plain and explanatory: what the fruit is like, why buy
 * here, how to ripen and keep it, what other buyers said, then the form.
 */
function Krishok({ slug, shop, zones }: Props) {
  const { landing } = shop;
  const info = shop.shop;
  const images = heroImagesFor(shop);
  const cover = images[0];
  const second = images[1] ?? images[0];

  return (
    <main>
      <header className="sticky top-0 z-40 border-b border-black/5 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <ShopMark shop={info} size={38} />
          <p className="min-w-0 flex-1 truncate font-bold text-(--lp-ink)">{info.name}</p>
          <HeaderCall shop={info} />
          <Cta tone="primary" className="min-h-10 px-4 text-sm">
            {t('shop.orderNow')}
          </Cta>
        </div>
      </header>

      <section className="bg-(--lp-soft) px-4 py-8 sm:py-14">
        <div className="mx-auto grid max-w-5xl items-center gap-6 md:grid-cols-2">
          <div className="text-center md:text-left">
            <h1 className="font-(family-name:--lp-heading) text-3xl leading-tight font-bold text-(--lp-ink) sm:text-4xl">
              {landing.headline || info.name}
            </h1>
            {landing.deliveryNote && (
              <p className="mt-3 inline-block rounded-lg bg-(--lp-accent) px-3 py-1 text-sm font-bold text-(--lp-accent-fg)">
                {landing.deliveryNote}
              </p>
            )}
            {landing.subtitle && <p className="mt-3 text-base leading-relaxed">{landing.subtitle}</p>}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row md:justify-start">
              <Cta tone="primary">{t('landing.orderNow')}</Cta>
              {info.phone && (
                <Cta href={`tel:${info.phone}`} tone="outline" className="text-(--lp-ink)">
                  {t('landing.callNow')}: <span className="tabular">{info.phone}</span>
                </Cta>
              )}
            </div>
          </div>
          {cover && (
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-xl">
              <Image
                src={cover.url}
                alt={landing.headline || info.name}
                fill
                priority
                sizes="(min-width: 768px) 480px, 100vw"
                className="object-cover"
              />
            </div>
          )}
        </div>
      </section>

      {landing.features.length > 0 && (
        <Section wide>
          <div className="grid items-center gap-6 md:grid-cols-2">
            {second && (
              <div className="relative order-last aspect-square overflow-hidden rounded-2xl md:order-first">
                <Image
                  src={second.url}
                  alt={t('landing.features')}
                  fill
                  sizes="(min-width: 768px) 480px, 100vw"
                  className="object-cover"
                  loading="lazy"
                />
              </div>
            )}
            <div>
              <SectionTitle className="md:text-left">{t('landing.features')}</SectionTitle>
              <CheckList items={landing.features} />
              <Cta tone="accent" className="mt-6 w-full sm:w-auto">
                {t('landing.orderNow')}
              </Cta>
            </div>
          </div>
        </Section>
      )}

      {landing.whyUs.length > 0 && (
        <Section wide className="bg-(--lp-soft)/50">
          <SectionTitle>{t('landing.whyUs')}</SectionTitle>
          <ol className="grid gap-3 sm:grid-cols-2">
            {landing.whyUs.map((reason, index) => (
              <li key={reason} className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm">
                <span className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--lp-primary) text-sm font-bold text-(--lp-primary-fg)">
                  {formatNumber(index + 1)}
                </span>
                <span className="leading-relaxed">{reason}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {landing.badges.length > 0 && (
        <Section className="pb-0 sm:pb-0">
          <BadgeRow badges={landing.badges} />
        </Section>
      )}

      {landing.tips.length > 0 && (
        <Section wide>
          <SectionTitle>{t('landing.tips')}</SectionTitle>
          <TipsGrid tips={landing.tips} />
        </Section>
      )}

      {landing.videoUrl && (
        <Section>
          <SectionTitle>{t('landing.video')}</SectionTitle>
          <VideoBlock url={landing.videoUrl} />
        </Section>
      )}

      {landing.reviews.length > 0 && (
        <Section wide className="bg-(--lp-soft)/50">
          <SectionTitle>{t('landing.reviews')}</SectionTitle>
          <ReviewsGrid reviews={landing.reviews} />
        </Section>
      )}

      <OrderSection slug={slug} shop={shop} zones={zones} />

      {landing.faqs.length > 0 && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.faq')}</SectionTitle>
          <FaqList faqs={landing.faqs} />
        </Section>
      )}

      {(info.phone || info.whatsapp) && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle sub={info.about || t('landing.contactHelp')}>{t('landing.contactTitle')}</SectionTitle>
          <ContactButtons shop={info} />
          {info.address && <p className="mt-3 text-center text-sm text-muted-foreground">{info.address}</p>}
        </Section>
      )}

      <ShopFooter shop={info} className="border-t border-black/5" />
    </main>
  );
}

/* ------------------------------------------------------------------ offer -- */

/**
 * The offer page. Loud colour, the video first, and every product as its own
 * offer block with the saving spelled out, before the form that takes them all.
 */
function Offer({ slug, shop, zones }: Props) {
  const { landing } = shop;
  const info = shop.shop;
  const images = heroImagesFor(shop);
  const products = shop.products;

  return (
    <main>
      <div className="bg-(--lp-accent) px-4 py-1.5 text-center text-xs font-bold text-(--lp-accent-fg)">
        {t('landing.cod')}
        {landing.deliveryNote && ` · ${landing.deliveryNote}`}
      </div>

      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2.5">
          <ShopMark shop={info} size={40} />
          <p className="min-w-0 flex-1 truncate font-(family-name:--lp-heading) text-lg font-bold text-(--lp-ink)">
            {info.name}
          </p>
          <HeaderCall shop={info} />
        </div>
      </header>

      <section className="px-4 pt-8 pb-6 text-center">
        <div className="mx-auto max-w-2xl">
          <h1 className="font-(family-name:--lp-heading) text-3xl leading-tight font-bold text-(--lp-ink) sm:text-5xl">
            <span className="bg-[linear-gradient(transparent_60%,var(--lp-soft)_60%)] px-1">
              {landing.headline || info.name}
            </span>
          </h1>
          {landing.subtitle && <p className="mx-auto mt-3 max-w-prose text-base">{landing.subtitle}</p>}
          <TrustStats landing={landing} className="mt-4 justify-center [&>span]:ring-1 [&>span]:ring-black/10" />
        </div>
      </section>

      <div className="px-4">
        <div className="mx-auto max-w-2xl">
          {landing.videoUrl ? (
            <VideoBlock url={landing.videoUrl} />
          ) : (
            <HeroGallery images={images} alt={landing.headline || info.name} className="shadow-xl" />
          )}
          <Cta tone="primary" className="mt-5 w-full text-lg">
            <ShoppingBag aria-hidden className="h-5 w-5" />
            {t('landing.orderNow')}
          </Cta>
        </div>
      </div>

      {products.length > 0 && (
        <Section>
          <div className="space-y-5">
            {products.map((product, index) => (
              <article
                key={product.id}
                className="overflow-hidden rounded-3xl bg-white shadow-md ring-1 ring-black/5 sm:flex"
              >
                {product.images[0] && (
                  <div
                    className={cn(
                      'relative aspect-[4/3] sm:aspect-auto sm:w-2/5',
                      index % 2 === 1 && 'sm:order-last'
                    )}
                  >
                    <Image
                      src={product.images[0].url}
                      alt={product.name}
                      fill
                      sizes="(min-width: 640px) 280px, 100vw"
                      className="object-cover"
                      loading="lazy"
                    />
                    {product.variants.some((v) => v.regularPrice != null) && (
                      <span className="absolute top-3 left-3 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white shadow">
                        {t('landing.offerPrice')}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex-1 p-5">
                  <h2 className="font-(family-name:--lp-heading) text-2xl font-bold text-(--lp-ink)">
                    {product.name}
                  </h2>
                  {/*
                   * A price per box, one line each: the mango is the same, the
                   * six-kilo box and the eleven-kilo box are not. docs/adr/0021.
                   */}
                  <div className="mt-2 space-y-1">
                    {product.priceHidden ? (
                      <p className="text-lg font-bold text-(--lp-price)">{t('shop.priceOnCall')}</p>
                    ) : (
                      product.variants.map((variant) => (
                        <PriceTag
                          key={variant.id}
                          price={variant.price ?? 0}
                          regularPrice={variant.regularPrice}
                          label={variant.label}
                          size={product.variants.length > 1 ? 'md' : 'lg'}
                        />
                      ))
                    )}
                  </div>
                  {product.description && (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
                  )}
                  <Cta tone="accent" className="mt-4 w-full">
                    {t('landing.orderNow')}
                  </Cta>
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}

      {(landing.badges.length > 0 || landing.whyUs.length > 0) && (
        <Section className="bg-(--lp-soft)/60">
          <BadgeRow badges={landing.badges} />
          {landing.whyUs.length > 0 && (
            <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-(family-name:--lp-heading) text-xl font-bold text-(--lp-ink)">
                {t('landing.whyUs')}
              </h2>
              <CheckList items={landing.whyUs} />
            </div>
          )}
          {landing.features.length > 0 && (
            <div className="mt-4 rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-(family-name:--lp-heading) text-xl font-bold text-(--lp-ink)">
                {t('landing.features')}
              </h2>
              <CheckList items={landing.features} />
            </div>
          )}
        </Section>
      )}

      <OrderSection slug={slug} shop={shop} zones={zones} />

      {landing.guaranteeNote && (
        <p className="mx-4 -mt-4 mb-6 text-center text-sm font-semibold text-(--lp-ink)">
          {landing.guaranteeNote}
        </p>
      )}

      {landing.reviews.length > 0 && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.reviews')}</SectionTitle>
          <ReviewsGrid reviews={landing.reviews} />
        </Section>
      )}

      {landing.tips.length > 0 && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.tips')}</SectionTitle>
          <TipsGrid tips={landing.tips} />
        </Section>
      )}

      {landing.faqs.length > 0 && (
        <Section className="pt-0 sm:pt-0">
          <SectionTitle>{t('landing.faq')}</SectionTitle>
          <FaqList faqs={landing.faqs} />
        </Section>
      )}

      <ContactSection shop={info} className="pt-0 sm:pt-0" />
      <ShopFooter shop={info} />
    </main>
  );
}
