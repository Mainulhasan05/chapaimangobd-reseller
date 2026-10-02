'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, ImagePlus, Star, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/form';
import { Spinner } from '@/components/ui/button';
import { optimizeImages, PRESETS } from '@/lib/image-optimize';
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

/**
 * Mirrors the multer filter on the server, so a reject happens before upload.
 *
 * The size check runs after optimization rather than before it. A twelve
 * megabyte photograph straight off a phone camera is not a file anyone should
 * be told off for choosing: it becomes a few hundred kilobytes of WebP, and the
 * limit is there to stop what is actually uploaded from being enormous.
 */
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Some iPhones hand over a HEIC with an empty mime type, which the list above
 * cannot match. The name is the only thing left to go on, and the file is
 * re-encoded to WebP a moment later anyway.
 */
const isImage = (file: File) =>
  ALLOWED.includes(file.type) ||
  (file.type === '' && /\.(heic|heif)$/i.test(file.name));

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
  uploading,
  busyIds,
  confirmRemove,
  onMakeCover,
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
  /**
   * The chosen files are on their way up right now. Where a picture is sent the
   * moment it is picked (an existing product, the landing page), each new tile
   * says so and cannot be dropped halfway through its own upload.
   */
  uploading?: boolean;
  /** Stored images being removed, each of which shows its own spinner. */
  busyIds?: readonly string[];
  /**
   * Ask on the tile before a stored image goes. For the places where the
   * removal is immediate and there is no Save to back out of.
   */
  confirmRemove?: boolean;
  /**
   * Offers "কভার করুন" on every stored photo but the first. The first photo is
   * what the catalog card and every shop show, and choosing it used to mean
   * deleting the photos in front of it and uploading them again.
   */
  onMakeCover?: (id: string) => void;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const total = existing.length + value.length;
  const remaining = Math.max(0, max - total);

  /**
   * Takes what fits and says why the rest did not, rather than failing a whole
   * selection because the last of six photos was oversized.
   *
   * Every picture is shrunk and re-encoded to WebP before it is added, so the
   * tile below previews the file that will actually be uploaded rather than the
   * twelve megabyte original it came from.
   */
  const accept = async (incoming: FileList | null | undefined) => {
    if (!incoming || incoming.length === 0) return;

    const chosen = Array.from(incoming);
    const images = chosen.filter(isImage);
    const rejectedType = images.length < chosen.length;

    const overflowed = images.length > remaining;
    const within = images.slice(0, remaining);

    if (within.length === 0) {
      setLocalError(rejectedType ? t('file.notImage') : t('file.maxReached').replace('{n}', formatNumber(max)));
      return;
    }

    setWorking(true);
    const results = await optimizeImages(within, PRESETS.product);
    setWorking(false);

    // Judged on what leaves the device. A file still over the limit after
    // re-encoding is one the browser could not decode at all.
    const kept = results.map((result) => result.file).filter((file) => file.size <= MAX_BYTES);
    const rejectedSize = kept.length < results.length;

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
          void accept(event.dataTransfer.files);
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
          // Two across on a phone, so a tile is big enough for its ✕ and ★ corners
          // and the remove confirmation without them overlapping.
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {existing.map((image, index) => (
              <Tile
                key={image.id}
                alt={label}
                // The small rendition: a tile is a hundred pixels wide and has no
                // business pulling a full size photograph to fill it.
                src={image.thumbUrl ?? image.url}
                isCover={index === 0}
                busy={busyIds?.includes(image.id)}
                confirm={confirmRemove}
                onRemove={onRemoveExisting ? () => onRemoveExisting(image.id) : undefined}
                onMakeCover={
                  onMakeCover && index > 0 ? () => onMakeCover(image.id) : undefined
                }
              />
            ))}

            {value.map((file, index) => (
              <Tile
                key={`${file.name}-${file.lastModified}-${index}`}
                alt={file.name}
                file={file}
                isCover={existing.length === 0 && index === 0}
                isNew
                busy={uploading}
                onRemove={uploading ? undefined : () => removeAt(index)}
              />
            ))}
          </div>
        )}

        {working && (
          <p className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
            <Spinner className="h-3.5 w-3.5" />
            {t('file.optimizing')}
          </p>
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
            void accept(event.target.files);
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
            void accept(event.target.files);
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
  busy,
  confirm,
  onRemove,
  onMakeCover,
}: {
  /** A stored image, already on the server. */
  src?: string;
  /** A chosen file, not yet uploaded. Exactly one of these two is given. */
  file?: File;
  alt: string;
  isCover?: boolean;
  isNew?: boolean;
  /** Uploading or being removed: a spinner over the picture, and no ✕. */
  busy?: boolean;
  /** Ask "সরাবেন?" on the tile before calling `onRemove`. */
  confirm?: boolean;
  onRemove?: () => void;
  onMakeCover?: () => void;
}) {
  const [asking, setAsking] = useState(false);

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

      {busy && (
        <span
          role="status"
          aria-label={isNew ? t('photos.uploading') : t('app.saving')}
          className="absolute inset-0 flex items-center justify-center bg-foreground/45 text-background"
        >
          <Spinner className="h-5 w-5" />
        </span>
      )}

      {/*
       * The hit area is the whole 44px corner; the visible circle stays small so
       * it does not cover the photograph it belongs to.
       */}
      {onRemove && !busy && !asking && (
        <button
          type="button"
          onClick={() => (confirm ? setAsking(true) : onRemove())}
          aria-label={t('file.remove')}
          className="group absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/60 text-background transition-colors group-hover:bg-danger group-hover:text-danger-foreground">
            <X className="h-4 w-4" />
          </span>
        </button>
      )}

      {/* The opposite corner from the ✕, with the same 44px hit area. */}
      {onMakeCover && !busy && !asking && (
        <button
          type="button"
          onClick={onMakeCover}
          aria-label={t('photos.makeCover')}
          title={t('photos.makeCover')}
          className="group absolute left-0 top-0 flex h-11 w-11 items-start justify-start p-1"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/60 text-background transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Star className="h-4 w-4" />
          </span>
        </button>
      )}

      {asking && onRemove && (
        // Stacked, full width: two 44px buttons side by side do not fit a tile on a 360px phone.
        <div className="absolute inset-0 flex flex-col items-stretch justify-center gap-1 bg-foreground/80 p-1.5 text-background">
          <span className="text-center text-xs font-semibold">{t('photos.removeAsk')}</span>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                onRemove();
              }}
              className="tap rounded-md bg-danger px-2 text-xs font-semibold text-danger-foreground"
            >
              {t('app.yes')}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="tap rounded-md bg-background px-2 text-xs font-semibold text-foreground"
            >
              {t('app.no')}
            </button>
          </div>
        </div>
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
