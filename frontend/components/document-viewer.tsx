'use client';

import { useRef, useState } from 'react';
import { ExternalLink, ImageOff, ZoomIn, ZoomOut } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A payment screenshot or an ID scan, readable on a phone.
 *
 * These are photos of small print: a bKash transaction id, the number on a
 * national ID. Shrunk to the width of a sheet they could not be read, and the
 * only way to look closer was to long-press and hope the browser offered to
 * open the image. One tap now enlarges it in place, where it pans inside its
 * own box (the sheet around it never scrolls sideways), and a link opens the
 * original for the phone's own pinch zoom.
 *
 * The URLs are signed and expire after a few minutes, so a sheet left open goes
 * stale. A broken image asks its owner for a fresh URL once by itself, and
 * only then says it failed, with a retry.
 */
export function ZoomableImage({
  src,
  alt,
  onBroken,
  className,
}: {
  src: string;
  alt: string;
  /** Fetch a fresh signed URL. Called once automatically, then from the retry. */
  onBroken?: () => void;
  className?: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [broken, setBroken] = useState(false);
  const retried = useRef(false);

  // A new URL is a new chance: whatever failed before was the old one.
  const [seen, setSeen] = useState(src);
  if (seen !== src) {
    setSeen(src);
    setBroken(false);
  }

  if (broken) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground',
          className
        )}
      >
        <ImageOff aria-hidden className="h-5 w-5" />
        <p>{t('viewer.broken')}</p>
        {onBroken && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBroken(false);
              onBroken();
            }}
          >
            {t('app.retry')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <figure className={cn('min-w-0', className)}>
      <div
        className={cn(
          'overflow-auto overscroll-contain rounded-lg border border-border bg-muted',
          zoomed && 'max-h-[70dvh]'
        )}
      >
        <button
          type="button"
          onClick={() => setZoomed((value) => !value)}
          aria-label={zoomed ? t('viewer.zoomOut') : t('viewer.zoomIn')}
          aria-pressed={zoomed}
          className={cn('block cursor-zoom-in', zoomed ? 'w-[250%] max-w-none cursor-zoom-out' : 'w-full')}
        >
          {/* Signed and short lived, so a plain img avoids Next caching a dead URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className={cn('block w-full', !zoomed && 'max-h-80 object-contain')}
            onError={() => {
              if (onBroken && !retried.current) {
                retried.current = true;
                onBroken();
                return;
              }
              setBroken(true);
            }}
          />
        </button>
      </div>
      <figcaption className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {zoomed ? <ZoomOut aria-hidden className="h-3.5 w-3.5" /> : <ZoomIn aria-hidden className="h-3.5 w-3.5" />}
          {zoomed ? t('viewer.zoomOutHint') : t('viewer.zoomInHint')}
        </span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="tap inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          {t('viewer.openTab')}
        </a>
      </figcaption>
    </figure>
  );
}
