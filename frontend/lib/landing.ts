import type { DictKey } from '@/lib/i18n/bn';
import type { LandingIcon, LandingTemplate } from '@/lib/types';

/**
 * The public page designs, in the order a reseller is offered them. The ids
 * mirror backend domain/landing.js; the first is the default there too.
 */
export const LANDING_TEMPLATES: {
  id: LandingTemplate;
  labelKey: DictKey;
  helpKey: DictKey;
  /** Two colours for the picker swatch, so a design is recognisable at a glance. */
  swatch: [string, string];
}[] = [
  {
    id: 'bagan',
    labelKey: 'landing.template.bagan',
    helpKey: 'landing.template.baganHelp',
    swatch: ['#065f46', '#c2410c'],
  },
  {
    id: 'krishok',
    labelKey: 'landing.template.krishok',
    helpKey: 'landing.template.krishokHelp',
    swatch: ['#15803d', '#b45309'],
  },
  {
    id: 'offer',
    labelKey: 'landing.template.offer',
    helpKey: 'landing.template.offerHelp',
    swatch: ['#be185d', '#7e22ce'],
  },
];

export const isLandingTemplate = (value: unknown): value is LandingTemplate =>
  LANDING_TEMPLATES.some((template) => template.id === value);

export const LANDING_ICONS: LandingIcon[] = [
  'leaf',
  'shield',
  'truck',
  'star',
  'heart',
  'package',
  'clock',
  'sun',
  'check',
  'gift',
  'snowflake',
  'wallet',
];

/** Mirrors the backend limits, so the editor stops adding before the save refuses. */
export const LANDING_LIMITS = {
  heroImages: 6,
  badges: 4,
  whyUs: 8,
  features: 8,
  tips: 4,
  reviews: 12,
  faqs: 12,
} as const;

/**
 * How a video link is embedded. A YouTube link becomes the privacy-enhanced
 * player; a direct file plays in a video element; anything else is not shown,
 * because an iframe of an arbitrary page is not a video.
 */
export function videoEmbed(url: string): { kind: 'youtube'; src: string } | { kind: 'file'; src: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\.|^m\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = parsed.pathname.slice(1);
    else if (host === 'youtube.com') {
      id =
        parsed.searchParams.get('v') ??
        parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ??
        null;
    }
    if (id && /^[\w-]{6,20}$/.test(id)) {
      return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (/\.(mp4|webm)$/i.test(parsed.pathname)) return { kind: 'file', src: url };
  } catch {
    // Not a URL at all.
  }
  return null;
}

/** A Bangladeshi mobile number as wa.me wants it: country code, digits only. */
export function waNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('880')) return digits;
  return `880${digits.replace(/^0/, '')}`;
}

/** Whole-percent discount, rounded down so the page never overstates it. */
export const percentOff = (price: number, regular: number) =>
  Math.floor(((regular - price) / regular) * 100);
