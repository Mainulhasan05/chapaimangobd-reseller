'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Check, ChevronRight, Store, Tag, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, Card, CardHeader } from '@/components/ui/layout';
import type { CatalogItem, ResellerProfile } from '@/lib/types';

/**
 * Getting a new reseller to their first order.
 *
 * Registering gives someone an account and an empty shop, and nothing on the
 * dashboard used to say what stood between that and taking money. The five
 * things that have to happen are knowable - the data for every one of them is
 * already on screen somewhere else - so they are a list rather than something
 * each reseller works out for themselves.
 *
 * The list disappears when it is finished. It is scaffolding for the first
 * week, not a permanent fixture on a working shop's dashboard.
 */

/** One thing that has to be true before the shop can sell. */
type Step = {
  key: string;
  title: string;
  help: string;
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
  done: boolean;
  /** True while it is out of the reseller's hands, such as KYC under review. */
  waiting?: boolean;
};

/**
 * Products the owner sells that this reseller has not priced.
 *
 * A product only reaches a public form through the reseller activating it and
 * naming their own price, so a new product from the owner is invisible until
 * they do. Nothing said so. The reseller's shop quietly lacked the thing that
 * had just been added to the catalog, and they would find out when a customer
 * asked for it.
 */
export function useUnpricedCount() {
  const { data: session } = useSession();

  const catalog = useQuery({
    // The same key the catalog page uses, so pricing something there updates
    // this without a second request.
    queryKey: ['catalog'],
    queryFn: () => api.get<{ products: CatalogItem[] }>('/reseller/catalog'),
    enabled: Boolean(session),
    staleTime: 5 * 60_000,
  });

  const products = catalog.data?.products ?? [];
  return {
    // An archived or unavailable product is not a gap in the shop: the owner is
    // not selling it either, so nagging about its price would be noise.
    unpriced: products.filter((product) => !product.activated && product.isAvailable).length,
    priced: products.filter((product) => product.activated).length,
    loaded: catalog.isSuccess,
  };
}

/**
 * The warning about unpriced products.
 *
 * Separate from the checklist below because it outlives it: the owner adds
 * products all season, and each new one is invisible in this reseller's shop
 * until they price it, long after the setup steps are finished.
 */
export function UnpricedAlert() {
  const { unpriced } = useUnpricedCount();
  if (unpriced === 0) return null;

  return (
    <Alert tone="warning" title={t('catalog.unpricedTitle')} icon={TriangleAlert}>
      <p className="mt-1">
        {t('catalog.unpricedHelp').replace('{n}', formatNumber(unpriced))}
      </p>
      <Link
        href="/reseller/catalog"
        className="mt-2 inline-block font-semibold underline underline-offset-2"
      >
        {t('catalog.setPriceNow')}
      </Link>
    </Alert>
  );
}

/** The setup checklist. Renders nothing once every step is done. */
export function ResellerOnboarding() {
  const { data: session } = useSession();
  const profile = session?.profile;
  const { priced, loaded } = useUnpricedCount();

  // Held back until the catalog has answered, so a step does not flash as
  // undone and then tick itself a moment later.
  if (!profile || !loaded) return null;

  const steps = buildSteps(profile, priced);
  const remaining = steps.filter((step) => !step.done).length;

  if (remaining === 0) return null;

  return (
    <Card className="mb-5">
      <CardHeader
        title={t('setup.title')}
        subtitle={t('setup.help')}
        action={
          <span className="tabular rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {t('setup.stepsLeft').replace('{n}', formatNumber(remaining))}
          </span>
        }
      />

      {/*
       * A bar rather than a percentage. The question this answers is "how much
       * is left", which a shape answers faster than a number does.
       */}
      <div
        role="progressbar"
        aria-valuenow={steps.length - remaining}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        className="mb-4 h-1.5 overflow-hidden rounded-full bg-subtle"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${((steps.length - remaining) / steps.length) * 100}%` }}
        />
      </div>

      <ol className="-my-1 divide-y divide-border">
        {steps.map((step) => (
          <li key={step.key}>
            <StepRow step={step} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * The steps, in the order they have to happen.
 *
 * KYC comes first because it gates the rest: the shop cannot open and orders
 * cannot be confirmed until it passes. Sharing the link is last, and it is the
 * only step that cannot be detected - nothing observes a message being sent -
 * so it is treated as done once the shop is open and has something to sell.
 */
function buildSteps(profile: ResellerProfile, priced: number): Step[] {
  const approved = profile.kycStatus === 'approved';

  return [
    {
      key: 'kyc',
      title: approved || profile.kycStatus !== 'pending' ? t('setup.kyc') : t('setup.kycWaiting'),
      help: t('setup.kycHelp'),
      href: '/reseller/kyc',
      icon: BadgeCheck,
      done: approved,
      waiting: profile.kycStatus === 'pending',
    },
    {
      key: 'shop',
      title: t('setup.shop'),
      help: t('setup.shopHelp'),
      href: '/reseller/shop',
      icon: Store,
      // A name alone is not a shopfront: the picture and a number to ring are
      // what a customer arriving from a chat link is actually looking for.
      done: Boolean(profile.shopName && profile.logoUrl && profile.publicPhone),
    },
    {
      key: 'price',
      title: t('setup.price'),
      help: t('setup.priceHelp'),
      href: '/reseller/catalog',
      icon: Tag,
      done: priced > 0,
    },
    {
      key: 'open',
      title: t('setup.open'),
      help: t('setup.openHelp'),
      href: '/reseller/shop',
      icon: Store,
      done: profile.formActive,
    },
    {
      key: 'share',
      title: t('setup.share'),
      help: t('setup.shareHelp'),
      href: '/reseller/shop',
      icon: ChevronRight,
      done: profile.formActive && priced > 0,
    },
  ];
}

function StepRow({ step }: { step: Step }) {
  const Icon = step.icon;

  const inner = (
    <>
      {/*
       * A tick when it is done, the step's own glyph when it is not. A row of
       * empty circles reads as a form to fill in; a row of ticks reads as
       * progress, which is the point of showing this at all.
       */}
      <span
        aria-hidden
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          step.done
            ? 'bg-success-soft text-success'
            : step.waiting
              ? 'bg-warning-soft text-warning-ink'
              : 'bg-subtle text-muted-foreground'
        )}
      >
        {step.done ? <Check className="h-[1.125rem] w-[1.125rem]" strokeWidth={3} /> : <Icon className="h-[1.125rem] w-[1.125rem]" />}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-sm font-semibold',
            step.done && 'text-muted-foreground line-through'
          )}
        >
          {step.title}
        </span>
        {!step.done && (
          <span className="block text-xs text-muted-foreground">{step.help}</span>
        )}
      </span>

      {!step.done && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary-ink">
          {t('setup.goStep')}
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </>
  );

  // A finished step is not a link. There is nothing left to do there, and a row
  // that still invites a tap after it has been ticked is a small lie.
  if (step.done) {
    return <div className="flex items-center gap-3 py-2.5">{inner}</div>;
  }

  return (
    <Link
      href={step.href}
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"
    >
      {inner}
    </Link>
  );
}
