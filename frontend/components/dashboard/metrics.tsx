'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '@/lib/i18n/bn';
import { dhakaHour } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A number that counts up to its value.
 *
 * The point is not decoration. A figure that arrives by moving draws the eye to
 * itself, which on a dashboard is exactly where the eye should go first, and it
 * makes a page that fetches its data feel like it is responding rather than
 * repainting. Anyone who has asked their phone to stop animating gets the final
 * number immediately.
 *
 * There is no hydration hazard here: these figures come from client-side queries,
 * so the server never renders anything but a skeleton in their place.
 */
export function CountUp({
  value,
  format,
  className,
  durationMs = 650,
}: {
  value: number;
  /** Applied to every intermediate frame, so the currency and digits stay right. */
  format: (value: number) => string;
  className?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const frame = useRef<number | undefined>(undefined);
  const from = useRef(value);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || from.current === value) {
      setShown(value);
      from.current = value;
      return undefined;
    }

    const start = performance.now();
    const origin = from.current;
    const delta = value - origin;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      // Ease out cubic: fast at first, settling rather than stopping dead.
      const eased = 1 - (1 - progress) ** 3;
      setShown(origin + delta * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else from.current = value;
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      from.current = value;
    };
  }, [value, durationMs]);

  return <span className={className}>{format(shown)}</span>;
}

/** The clock never notifies, so a greeting is read once and left alone. */
const NEVER_CHANGES = () => () => {};

/**
 * The hour-appropriate greeting, in Dhaka time.
 *
 * The clock is an external source, so it is read as one. The server snapshot is
 * null and the greeting simply does not exist in the prerendered HTML: the hour
 * on the build machine is not the hour in the reader's hand, and rendering it
 * would be a hydration mismatch dressed up as a nicety.
 */
export function Greeting({ name }: { name?: string }) {
  const hour = useSyncExternalStore<number | null>(
    NEVER_CHANGES,
    () => dhakaHour(),
    () => null
  );

  if (hour === null) return null;

  const key =
    hour < 5 ? 'dash.night' : hour < 12 ? 'dash.morning' : hour < 17 ? 'dash.afternoon' : hour < 20 ? 'dash.evening' : 'dash.night';

  return (
    <p className="text-sm font-medium text-muted-foreground">
      {t(key)}
      {name ? `, ${name}` : ''}
    </p>
  );
}

/**
 * The headline money figure, on the brand fill.
 *
 * Dark text on mango rather than white, at around 8:1, for the same reason the
 * primary button carries dark text: white on amber cannot reach a readable ratio
 * without darkening the amber into brown and losing the fruit.
 */
export function HeroCard({
  label,
  value,
  caption,
  tone = 'brand',
  children,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  /** `alert` for a figure that is bad news, which should not wear the brand. */
  tone?: 'brand' | 'alert';
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'elev-2 relative overflow-hidden rounded-[var(--radius-panel)] p-6',
        tone === 'brand'
          ? 'bg-gradient-to-br from-[oklch(0.84_0.15_85)] to-[oklch(0.74_0.17_62)] text-[oklch(0.24_0.045_60)]'
          : 'bg-gradient-to-br from-[oklch(0.32_0.06_35)] to-[oklch(0.24_0.05_30)] text-[oklch(0.97_0.01_60)]'
      )}
    >
      {/* A soft highlight, so the fill reads as a surface rather than a swatch. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-white/20 blur-2xl"
      />

      <div className="relative">
        <p className="text-xs font-semibold opacity-80">{label}</p>
        <p className="tabular mt-1.5 text-[2.5rem] font-bold leading-none tracking-tight">{value}</p>
        {caption && <p className="mt-2.5 text-xs font-medium opacity-80">{caption}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * A single ratio against a limit, drawn on the same ramp as the value it tracks.
 * A meter rather than a two-slice pie, which is the usual mistake here.
 */
export function Meter({
  label,
  used,
  total,
  caption,
  tone = 'brand',
}: {
  label: string;
  used: number;
  total: number;
  caption?: string;
  tone?: 'brand' | 'alert';
}) {
  const share = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-semibold">
        <span className="opacity-80">{label}</span>
        {caption && <span className="tabular opacity-80">{caption}</span>}
      </div>
      <div
        className={cn('h-2 overflow-hidden rounded-full', tone === 'brand' ? 'bg-black/15' : 'bg-white/20')}
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-700 ease-out',
            tone === 'brand' ? 'bg-[oklch(0.28_0.05_60)]' : 'bg-[oklch(0.75_0.16_70)]'
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}
