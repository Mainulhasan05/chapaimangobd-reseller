'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import type { ProductImage as ProductImageRecord } from '@/lib/types';

/**
 * A product's photograph, wherever a product is shown.
 *
 * Three screens were each drawing this themselves: the reseller's catalog, the
 * public order form, and the owner's product table, which drew nothing at all
 * and listed mangoes as rows of text. They disagreed on size, on corner radius,
 * and on what to show when a product has no photograph, so the same product
 * looked like a different thing depending on which screen you were standing on.
 *
 * It is one component now, and the placeholder is part of it rather than an
 * afterthought at each call site: a product with no photograph still occupies
 * the same square, so a list keeps one left edge instead of ragging in and out.
 */

const SIZES = {
  sm: { box: 'h-10 w-10 rounded-lg', px: 40 },
  md: { box: 'h-14 w-14 rounded-xl', px: 56 },
  lg: { box: 'h-18 w-18 rounded-xl', px: 72 },
} as const;

export type ThumbSize = keyof typeof SIZES;

/**
 * The smallest rendition that will fill the box.
 *
 * ImgBB renders a thumbnail for free and a phone has no business pulling a
 * three megapixel photograph to fill forty square pixels. Images saved before
 * that was true carry no thumbnail, so the full one is the fallback.
 */
const sourceFor = (image: ProductImageRecord | undefined, size: ThumbSize) =>
  size === 'lg' ? (image?.url ?? image?.thumbUrl) : (image?.thumbUrl ?? image?.url);

/**
 * One square. Tapping it opens the gallery, but only when there is more than one
 * photograph to see: a modal that shows the same image again, larger, is a
 * disappointment, and on a phone it costs a tap to get back out of.
 */
export function ProductThumb({
  images,
  alt,
  size = 'md',
  className,
}: {
  images?: ProductImageRecord[];
  alt: string;
  size?: ThumbSize;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const list = images ?? [];
  const cover = list[0];
  const src = sourceFor(cover, size);
  const { box, px } = SIZES[size];

  if (!src) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center bg-subtle text-muted-foreground',
          box,
          className
        )}
      >
        <Package className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
    );
  }

  const tile = (
    <>
      <Image
        src={src}
        alt={alt}
        width={px}
        height={px}
        className="h-full w-full object-cover"
        /* This runs on a mobile connection; nothing below the fold is worth a
         * blocking request. */
        loading="lazy"
      />

      {/* How many more there are, so a set does not masquerade as a single photo. */}
      {list.length > 1 && (
        <span className="tabular absolute bottom-0 right-0 rounded-tl-md bg-black/60 px-1 text-[0.625rem] font-semibold leading-4 text-white">
          +{formatNumber(list.length - 1)}
        </span>
      )}
    </>
  );

  const shell = cn('relative shrink-0 overflow-hidden bg-muted ring-1 ring-border', box, className);

  if (list.length < 2) {
    return <span className={shell}>{tile}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('catalog.viewImages')}
        className={cn(shell, 'transition-opacity hover:opacity-90')}
      >
        {tile}
      </button>

      <ProductGallery
        open={open}
        onClose={() => setOpen(false)}
        images={list}
        alt={alt}
      />
    </>
  );
}

/**
 * Every photograph of one product, one at a time.
 *
 * A grid would fit more on the screen and show less of each: the reason to open
 * this at all is to look closely at fruit, so one image gets the whole width and
 * the rest wait in a strip underneath.
 */
export function ProductGallery({
  open,
  onClose,
  images,
  alt,
}: {
  open: boolean;
  onClose: () => void;
  images: ProductImageRecord[];
  alt: string;
}) {
  const [index, setIndex] = useState(0);

  // Clamped rather than reset, so reopening the gallery does not silently jump
  // back to the first photograph, and a shorter list cannot strand the index
  // past its end.
  const at = Math.min(index, Math.max(images.length - 1, 0));
  const current = images[at];

  const step = (by: number) =>
    setIndex((i) => (i + by + images.length) % images.length);

  return (
    <Modal open={open} onClose={onClose} title={alt}>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted">
        {current && (
          <Image
            src={current.url}
            alt={alt}
            fill
            sizes="(max-width: 640px) 100vw, 480px"
            className="object-contain"
          />
        )}

        {images.length > 1 && (
          <>
            <GalleryArrow side="left" onClick={() => step(-1)} />
            <GalleryArrow side="right" onClick={() => step(1)} />
            <span className="tabular absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
              {formatNumber(at + 1)} / {formatNumber(images.length)}
            </span>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((image, i) => (
            <button
              key={image.id ?? image.key}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`${alt} ${formatNumber(i + 1)}`}
              aria-current={i === at ? 'true' : undefined}
              className={cn(
                'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 transition-all',
                i === at ? 'ring-2 ring-primary' : 'ring-border opacity-70 hover:opacity-100'
              )}
            >
              <Image
                src={image.thumbUrl ?? image.url}
                alt=""
                width={56}
                height={56}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function GalleryArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(side === 'left' ? 'app.back' : 'app.more')}
      className={cn(
        // Forty-four pixels square: this is tapped with a thumb on a photograph
        // that fills the screen, and a smaller target means mis-taps that close
        // the modal instead of turning the page.
        'absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65',
        side === 'left' ? 'left-2' : 'right-2'
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
