import type { CSSProperties } from 'react';
import type { LandingTemplate } from '@/lib/types';

/**
 * Each design's palette, as CSS variables on the design's root element.
 *
 * `--lp-*` is what the landing blocks read. The app tokens (`--primary` and
 * friends) are overridden too, because the order form and its sticky bar are
 * the dashboard's own components and should take the design's colour rather
 * than the dashboard blue. Every foreground/background pair here is at least
 * 4.5:1, measured against the fill it sits on.
 */
type Palette = {
  primary: string;
  primaryFg: string;
  accent: string;
  accentFg: string;
  soft: string;
  ink: string;
  price: string;
  background: string;
  heading: string;
};

const PALETTES: Record<LandingTemplate, Palette> = {
  // Emerald 800 / orange 700 on a pale green ground.
  bagan: {
    primary: '#065f46',
    primaryFg: '#ffffff',
    accent: '#c2410c',
    accentFg: '#ffffff',
    soft: '#d1fae5',
    ink: '#064e3b',
    price: '#9a3412',
    background: '#f3faf6',
    heading: 'var(--font-landing-serif), var(--font-bengali), serif',
  },
  // Green 700 / amber 700 on white: plain, farm-market.
  krishok: {
    primary: '#15803d',
    primaryFg: '#ffffff',
    accent: '#b45309',
    accentFg: '#ffffff',
    soft: '#dcfce7',
    ink: '#14532d',
    price: '#15803d',
    background: '#ffffff',
    heading: 'var(--font-bengali), sans-serif',
  },
  // Pink 700 / purple 700 on warm off-white: loud, offer-led.
  offer: {
    primary: '#be185d',
    primaryFg: '#ffffff',
    accent: '#7e22ce',
    accentFg: '#ffffff',
    soft: '#fce7f3',
    ink: '#500724',
    price: '#be185d',
    background: '#faf8f5',
    heading: 'var(--font-landing-rounded), var(--font-bengali), sans-serif',
  },
};

export function themeStyle(template: LandingTemplate): CSSProperties {
  const p = PALETTES[template];
  return {
    '--lp-primary': p.primary,
    '--lp-primary-fg': p.primaryFg,
    '--lp-accent': p.accent,
    '--lp-accent-fg': p.accentFg,
    '--lp-soft': p.soft,
    '--lp-ink': p.ink,
    '--lp-price': p.price,
    '--lp-heading': p.heading,
    '--primary': p.primary,
    '--primary-foreground': p.primaryFg,
    '--primary-soft': p.soft,
    '--primary-softer': p.soft,
    '--primary-ink': p.ink,
    '--ring': p.primary,
    '--background': p.background,
    background: p.background,
  } as CSSProperties;
}
