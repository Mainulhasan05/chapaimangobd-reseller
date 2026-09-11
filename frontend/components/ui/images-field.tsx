'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/form';
import type { ProductImage } from '@/lib/types';

/**
 * Several photographs of one product, seen before they are uploaded.
 *
 * `FileField` is the single-document version of this, and the two are deliberate
 * siblings rather than one component with a mode flag: a KYC document is one
 * specific page you photograph once, while product photos are a set you add to,
 * look at and cull. What they share is the reasoning, not the markup.
 *
 * What the bare `<input type="file" multiple>` this replaces did wrong: it put
 * the operating system's English chrome inside a Bengali form, showed no
 * preview, gave no way to drop one photo out of a chosen five, and silently
 * replaced the entire selection every time it was reopened.
 */

const MAX_BYTES = 5 * 1024 * 1024;

/** Mirrors the multer filter on the server, so a reject happens before upload. */
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * An image already stored, addressed by its handle. The handle is the ImgBB id,
 * or the R2 key for one saved before images were hosted; the field never has to
 * know which, it only hands the value back when the owner drops the image.
 */
export type ExistingImage = ProductImage;

export function ImagesField({
  label,
  value,
  onChange,
  existing = [],
  onRemoveExisting,
  max = 6,
  hint,
  error,
  id,
}: {
  label: string;
  /** Newly chosen files, not yet uploaded. */
  value: File[];
  onChange: (files: File[]) => void;
  /** Already uploaded and hosted, addressed by handle. */
  existing?: ExistingImage[];
  onRemoveExisting?: (id: string) => void;
  max?: number;
  hint?: string;
  error?: string;
  id?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const total = existing.length + value.length;
  const remaining = Math.max(0, max - total);

  /**
   * Takes what fits and says why the rest did not, rather than failing a whole
   * selection because the last of six photos was oversized.
   */
  const accept = (incoming: FileList | null | undefined) => {
    if (!incoming || incoming.length === 0) return;

    const picked: File[] = [];
    let rejectedType = false;
    let rejectedSize = false;

    Array.from(incoming).forEach((file) => {
      if (!ALLOWED.includes(file.type)) {
        rejectedType = true;
        return;
      }
      if (file.size > MAX_BYTES) {
        rejectedSize = true;
        return;
      }
      picked.push(file);
    });

    const overflowed = picked.length > remaining;
    const kept = picked.slice(0, remaining);

    setLocalError(
      rejectedType
        ? t('file.notImage')
        : rejectedSize
          ? t('file.tooLarge')
          : overflowed
            ? t('file.maxReached').replace('{n}', formatNumber(max))
            : null
    );

    if (kept.length > 0) onChange([...value, ...kept]);
  };

  const removeAt = (index: number) => onChange(value.filter((_, i) => i !== index));

  const shown = error ?? localError;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Label htmlFor={fieldId} className="mb-0">
          {label}
        </Label>
        <span className="tabular text-xs text-muted-foreground">
          {formatNumber(total)}/{formatNumber(max)}
        </span>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files);
        }}
        className={cn(
          'rounded-xl border bg-muted/60 p-3 transition-colors',
          dragging && 'border-primary bg-primary-softer',
          shown && !dragging && 'border-danger',
          !dragging && !shown && 'border-border'
        )}
      >
        {/*
         * The first tile is the photo the catalog card and the public shop
         * render, so the set is not an unordered bag and the owner is told which
         * one currently has that job. Stored images come first because that is
         * the order the server keeps them in.
         */}
        {total > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {existing.map((image, index) => (
              <Tile
                key={image.id}
                alt={label}
                // The small rendition: a tile is a hundred pixels wide and has no
                // business pulling a full size photograph to fill it.
                src={image.thumbUrl ?? image.url}
                isCover={index === 0}
                onRemove={onRemoveExisting ? () => onRemoveExisting(image.id) : undefined}
              />
            ))}

            {value.map((file, index) => (
              <Tile
                key={`${file.name}-${file.lastModified}-${index}`}
                alt={file.name}
                file={file}
                isCover={existing.length === 0 && index === 0}
                isNew
                onRemove={() => removeAt(index)}
              />
            ))}
          </div>
        )}

        {remaining > 0 ? (
          <>
            {total === 0 && (
              <div className="mb-3 flex flex-col items-center gap-1 text-center">
                <ImagePlus aria-hidden className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {dragging ? t('file.dropHere') : (hint ?? t('file.choose'))}
                </p>
              </div>
            )}

            {/*
             * Two doors rather than one. `capture` opens the camera directly,
             * which is what someone standing over a crate of mangoes wants, and
             * the gallery covers the photo they took this morning.
             */}
            <div className="flex gap-2 [&>button]:flex-1">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="tap flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground sm:hidden"
              >
                <Camera className="h-4 w-4" />
                {t('file.camera')}
              </button>
              <button
                type="button"
                id={fieldId}
                onClick={() => galleryRef.current?.click()}
                className="tap flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-semibold transition-colors hover:bg-muted"
              >
                <ImagePlus className="h-4 w-4" />
                {total === 0 ? t('file.gallery') : t('file.addMore')}
              </button>
            </div>
          </>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            {t('file.maxReached').replace('{n}', formatNumber(max))}
          </p>
        )}

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files);
            // Cleared so re-picking the same photo still fires a change event.
            event.target.value = '';
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {shown ? (
        <p className="mt-1 text-xs font-semibold text-danger">{shown}</p>
      ) : (
        total > 0 && hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function Tile({
  src,
  file,
  alt,
  isCover,
  isNew,
  onRemove,
}: {
  /** A stored image, already on the server. */
  src?: string;
  /** A chosen file, not yet uploaded. Exactly one of these two is given. */
  file?: File;
  alt: string;
  isCover?: boolean;
  isNew?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border">
      {/*
       * A plain img: half of these are local object URLs that next/image would
       * only add a proxy hop to, and the rest are thumbnails small enough that
       * optimising them costs more than it saves.
       */}
      {file ? (
        <FilePreview file={file} alt={alt} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        src && <img src={src} alt={alt} className="h-full w-full object-cover" />
      )}

      {isCover && (
        <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[10px] font-semibold text-white">
          {t('file.cover')}
        </span>
      )}

      {isNew && (
        <span className="absolute left-1 top-1 rounded bg-success px-1 py-0.5 text-[10px] font-semibold text-white">
          {t('file.new')}
        </span>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('file.remove')}
          className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-danger"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * One chosen file's thumbnail.
 *
 * The object URL is written straight onto the img element rather than mirrored
 * into React state. Pushing a value out to a DOM node and tearing it down again
 * is exactly what an effect is for, and holding a second copy in state would be
 * two sources of truth that can disagree for a render. Splitting this out per
 * file also means each URL is revoked when its own tile unmounts, so removing
 * the third of six photos does not churn the other five.
 */
function FilePreview({ file, alt }: { file: File; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = ref.current;
    if (!image) return undefined;

    const url = URL.createObjectURL(file);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* eslint-disable-next-line @next/next/no-img-element */
  return <img ref={ref} alt={alt} className="h-full w-full object-cover" />;
}
