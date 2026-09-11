import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { ArrowRight, BadgeCheck, Link2, PackageCheck, Share2, Tag, Truck, Wallet } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import { Logo } from '@/components/ui/logo';

/**
 * The public landing page.
 *
 * This file used to be a redirect to `/login`, on the reasoning that a visitor
 * is either signing in or opening a reseller's shop link. That held while the
 * only way to become a reseller was to know someone. It stops holding the moment
 * the business wants to recruit, which is what this page is for: it speaks to
 * somebody who has a job and is considering a second income, and its whole job
 * is to get them to the register form.
 *
 * Server rendered, like `/r/[slug]` and for the same reasons. It is
 * unauthenticated, it is the first thing anyone sees after tapping a link in a
 * chat, and it is opened on a cheap phone over a slow connection, so the markup
 * should arrive complete. Nothing here is a Client Component and the only
 * interactive widget, the FAQ, is a native `<details>` rather than state.
 */

const SITE = 'চাঁপাই ম্যাঙ্গো';

export const metadata: Metadata = {
  title: `${SITE} · ${t('landing.title')}`,
  description: t('landing.subtitle'),
  openGraph: {
    title: `${SITE} · ${t('landing.title')}`,
    description: t('landing.subtitle'),
    // The standee artwork doubles as the share card, so a link pasted into a
    // WhatsApp group renders the pitch rather than a bare URL.
    images: [{ url: '/vertical_banner.jpeg', width: 601, height: 1600 }],
  },
};

/*
 * The worked example from the README, unchanged. Ten kilos bought at 55 and sold
 * at 62 is a margin of 70 taka, and that is the number the ledger will actually
 * produce. Quoting a rounder, better-looking figure here would be found out by
 * the first reseller who completes an order.
 */
const EXAMPLE = { cost: 55, sell: 62, qty: 10 };
const EXAMPLE_PROFIT = (EXAMPLE.sell - EXAMPLE.cost) * EXAMPLE.qty;

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <Hero />
      <Steps />
      <Earnings />
      <Why />
      <Faq />
      <FinalCta />
      <SiteFooter />
    </div>
  );
}

/* ---------------------------------------------------------------- header -- */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[oklch(0.16_0.01_60)]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size="sm" />
          <span className="font-bold tracking-tight text-white">{SITE}</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            {t('landing.navLogin')}
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-bold text-brand-foreground transition-[filter] hover:brightness-105 sm:px-4"
          >
            {t('landing.navJoin')}
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ hero -- */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[oklch(0.16_0.01_60)] text-white">
      {/* A mango glow behind the artwork, so the black is not a flat slab. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-0 h-[36rem] w-[36rem] rounded-full bg-brand/20 blur-[120px]"
      />

      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1.1fr_auto] lg:items-center lg:gap-16 lg:py-20">
        {/*
         * Copy first on a phone, artwork second. The call to action has to be
         * reachable without scrolling past a 1600px-tall poster to find it.
         */}
        <div className="max-w-xl">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            {t('landing.eyebrow')}
          </p>

          <h1 className="text-4xl font-bold leading-[1.15] tracking-tight sm:text-5xl">
            {t('landing.title')}
            <span className="mt-1 block text-brand">{t('landing.titleAccent')}</span>
          </h1>

          <p className="mt-5 text-base leading-relaxed text-white/75 sm:text-lg">
            {t('landing.subtitle')}
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/register"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-bold text-brand-foreground transition-[filter] hover:brightness-105"
            >
              {t('landing.ctaPrimary')}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {t('landing.ctaSecondary')}
            </Link>
          </div>

          <ul className="mt-9 grid gap-4 sm:grid-cols-3">
            <Proof title={t('landing.proofCapital')} help={t('landing.proofCapitalHelp')} />
            <Proof title={t('landing.proofStock')} help={t('landing.proofStockHelp')} />
            <Proof title={t('landing.proofLedger')} help={t('landing.proofLedgerHelp')} />
          </ul>
        </div>

        {/*
         * The standee artwork, at its own aspect ratio and capped by height
         * rather than width. A 601x1600 image given the full width of a phone
         * would be two and a half screens tall; capping the height lets it shrink
         * on a short screen instead of pushing everything else off the page.
         */}
        <div className="justify-self-center lg:justify-self-end">
          <Image
            src="/vertical_banner.jpeg"
            alt={`${SITE} — ${t('landing.title')}`}
            width={601}
            height={1600}
            priority
            sizes="(min-width: 1024px) 340px, 240px"
            className="h-auto w-[14rem] rounded-2xl shadow-[0_30px_80px_oklch(0_0_0/0.6)] sm:w-[16rem] lg:w-[21rem]"
          />
        </div>
      </div>
    </section>
  );
}

function Proof({ title, help }: { title: string; help: string }) {
  return (
    <li>
      <p className="flex items-center gap-1.5 text-sm font-bold text-brand">
        <BadgeCheck aria-hidden className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <p className="mt-0.5 text-xs text-white/60">{help}</p>
    </li>
  );
}

/* ----------------------------------------------------------------- steps -- */

const STEPS = [
  { icon: BadgeCheck, title: 'landing.step1', help: 'landing.step1Help' },
  { icon: Tag, title: 'landing.step2', help: 'landing.step2Help' },
  { icon: Share2, title: 'landing.step3', help: 'landing.step3Help' },
  { icon: PackageCheck, title: 'landing.step4', help: 'landing.step4Help' },
] as const;

function Steps() {
  return (
    <Section title={t('landing.stepsTitle')} subtitle={t('landing.stepsSubtitle')}>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="card p-5">
            <div className="mb-3 flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand-ink"
              >
                <step.icon className="h-5 w-5" />
              </span>
              <span className="tabular text-2xl font-bold text-muted-foreground/60">
                {formatNumber(index + 1)}
              </span>
            </div>
            <h3 className="font-bold">{t(step.title)}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(step.help)}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* -------------------------------------------------------------- earnings -- */

function Earnings() {
  return (
    <Section title={t('landing.mathTitle')} subtitle={t('landing.mathSubtitle')} muted>
      <div className="mx-auto max-w-2xl">
        <div className="card overflow-hidden p-0">
          <dl className="divide-y divide-border">
            <MathRow
              label={t('landing.mathCost')}
              value={`${formatMoney(EXAMPLE.cost)} / ${t('landing.mathPerKg')}`}
            />
            <MathRow
              label={t('landing.mathYourPrice')}
              value={`${formatMoney(EXAMPLE.sell)} / ${t('landing.mathPerKg')}`}
            />
            <MathRow label={t('landing.mathQty')} value={`${formatNumber(EXAMPLE.qty)} কেজি`} />
          </dl>

          {/* The answer, on the brand fill. Dark text on mango, at about 8:1. */}
          <div className="flex items-baseline justify-between gap-3 bg-brand px-5 py-4 text-brand-foreground">
            <dt className="text-sm font-bold">{t('landing.mathProfit')}</dt>
            <dd className="tabular text-3xl font-bold">{formatMoney(EXAMPLE_PROFIT)}</dd>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t('landing.mathNote')}</p>
      </div>
    </Section>
  );
}

function MathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="tabular text-sm font-semibold">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------- why -- */

const REASONS = [
  { icon: Truck, title: 'landing.why1', help: 'landing.why1Help' },
  { icon: PackageCheck, title: 'landing.why2', help: 'landing.why2Help' },
  { icon: Wallet, title: 'landing.why3', help: 'landing.why3Help' },
  { icon: Link2, title: 'landing.why4', help: 'landing.why4Help' },
] as const;

function Why() {
  return (
    <Section title={t('landing.whyTitle')}>
      <div className="grid gap-4 sm:grid-cols-2">
        {REASONS.map((reason) => (
          <div key={reason.title} className="card flex gap-4 p-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink"
            >
              <reason.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="font-bold">{t(reason.title)}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t(reason.help)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- faq -- */

const FAQ = [
  { q: 'landing.faq1', a: 'landing.faq1Help' },
  { q: 'landing.faq2', a: 'landing.faq2Help' },
  { q: 'landing.faq3', a: 'landing.faq3Help' },
  { q: 'landing.faq4', a: 'landing.faq4Help' },
] as const;

function Faq() {
  return (
    <Section title={t('landing.faqTitle')} muted>
      {/*
       * Native `<details>`, so the answers are in the markup, open without
       * JavaScript, are found by the browser's own page search, and cost nothing
       * to hydrate. An accordion built from state would be worse on every count.
       */}
      <div className="mx-auto max-w-2xl space-y-3">
        {FAQ.map((item) => (
          <details key={item.q} className="card group p-0 [&[open]_svg]:rotate-45">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
              {t(item.q)}
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
            </summary>
            <p className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">
              {t(item.a)}
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- final cta -- */

function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[oklch(0.16_0.01_60)] text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-full h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/25 blur-[100px]"
      />
      <div className="relative mx-auto max-w-2xl px-4 py-16 text-center sm:py-20">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.finalTitle')}</h2>
        <p className="mt-3 text-white/70">{t('landing.finalHelp')}</p>
        <Link
          href="/register"
          className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-7 text-base font-bold text-brand-foreground transition-[filter] hover:brightness-105"
        >
          {t('landing.ctaPrimary')}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- footer -- */

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size="sm" />
          <div>
            <p className="text-sm font-bold">{SITE}</p>
            <p className="text-xs text-muted-foreground">{t('landing.footerNote')}</p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link href="/track" className="text-muted-foreground hover:text-foreground">
            {t('landing.track')}
          </Link>
          <Link href="/login" className="text-muted-foreground hover:text-foreground">
            {t('landing.navLogin')}
          </Link>
          <Link href="/register" className="font-semibold text-primary-ink hover:underline">
            {t('landing.navJoin')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------------- section -- */

function Section({
  title,
  subtitle,
  muted,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Alternating ground, so neighbouring sections do not merge into one page. */
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={muted ? 'bg-subtle' : undefined}>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}
