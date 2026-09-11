'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2, Upload, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/form';
import { Button, Spinner } from '@/components/ui/button';
import { optimizeImage, PRESETS } from '@/lib/image-optimize';

/**
 * One public picture: a shop logo, a brand mark.
 *
 * The third sibling of `FileField` and `ImagesField`, and it exists because
 * neither fits. `FileField` hands a file to a form that is submitted later;
 * `ImagesField` manages a set. This one owns a single image that already has a
 * home on the server, so choosing a picture is only half the job and replacing
 * one has to be undoable before it happens.
 *
 * Which is the point of the two step: a chosen picture is previewed at the size
 * it will be seen, and nothing is sent until it is confirmed. Uploading on
 * selection looks faster and is worse, because the picture that replaced the
 * shop logo is already live by the time its owner first sees it properly.
 */

const MAX_BYTES = 5 * 1024 * 1024;

/** Mirrors the multer filter on the server, so a reject happens before upload. */
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Some iPhones hand over a HEIC with an empty mime type, which the list above
 * cannot match. The name is the only thing left to go on, and the file is
 * re-encoded to WebP a moment later anyway.
 */
const isImage = (file: File) =>
  ALLOWED.includes(file.type) ||
  (file.type === '' && /\.(heic|heif)$/i.test(file.name));

export function ImageField({
  label,
  hint,
  currentUrl,
  onUpload,
  onRemove,
  uploading = false,
  removing = false,
  shape = 'square',
  error,
}: {
  label: string;
  hint?: string;
  /** The picture currently on the server, or nothing yet. */
  currentUrl?: string | null;
  onUpload: (file: File) => void;
  onRemove?: () => void;
  uploading?: boolean;
  removing?: boolean;
  /** A shop logo reads as a mark rather than a photograph, so usually a circle. */
  shape?: 'square' | 'circle';
  error?: string;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLImageElement>(null);

  /*
   * The optimized file, and what it weighed before. The original size is kept
   * only to show what the shrinking bought, which is the one moment anybody
   * cares: on a slow connection it is the difference between an upload that
   * finishes and one that is abandoned.
   */
  const [chosen, setChosen] = useState<File | null>(null);
  const [originalBytes, setOriginalBytes] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  /*
   * An object URL is a live handle into the page's memory, not a string. Left
   * unrevoked, every picture reconsidered stays resident for the life of the
   * tab, which on a cheap phone is how a form starts to stutter. It is written
   * straight onto the element rather than mirrored into state, so there is one
   * source of truth rather than two that can disagree for a render.
   */
  useEffect(() => {
    const image = previewRef.current;
    if (!image || !chosen) return undefined;

    const url = URL.createObjectURL(chosen);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [chosen]);

  /**
   * Rejects here rather than after an upload that was always going to fail.
   *
   * The picture is shrunk and re-encoded to WebP first, so the preview above is
   * the file that will actually be sent and the size limit is applied to what
   * leaves the device rather than to what came off the camera.
   */
  const accept = async (file: File | null | undefined) => {
    if (!file) return;
    if (!isImage(file)) {
      setLocalError(t('file.notImage'));
      return;
    }

    setWorking(true);
    const result = await optimizeImage(file, PRESETS.logo);
    setWorking(false);

    if (result.file.size > MAX_BYTES) {
      setLocalError(t('file.tooLarge'));
      return;
    }

    setLocalError(null);
    setOriginalBytes(result.optimized ? result.originalBytes : null);
    setChosen(result.file);
  };

  const shown = error ?? localError;
  const busy = uploading || removing || working;
  const frame = cn(
    'relative h-24 w-24 shrink-0 overflow-hidden bg-muted ring-1 ring-border',
    shape === 'circle' ? 'rounded-full' : 'rounded-xl'
  );

  return (
    <div>
      <Label>{label}</Label>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void accept(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'rounded-xl border bg-muted/60 p-3 transition-colors',
          shown ? 'border-danger' : 'border-border'
        )}
      >
        <div className="flex items-center gap-3">
          <span className={frame}>
            {chosen ? (
              /* A local object URL, so next/image would only add a proxy hop to
               * a blob that is already in memory on this device. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img ref={previewRef} alt={label} className="h-full w-full object-cover" />
            ) : currentUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={currentUrl} alt={label} className="h-full w-full object-cover" />
            ) : (
              <span
                aria-hidden
                className="flex h-full w-full items-center justify-center text-muted-foreground"
              >
                <ImagePlus className="h-6 w-6" />
              </span>
            )}
          </span>

          <div className="min-w-0 flex-1">
            {chosen ? (
              <>
                {/*
                 * Named and sized before it is sent, because the two mistakes
                 * this catches are the wrong picture and one too heavy for the
                 * connection, and both are visible here for free.
                 */}
                <p className="truncate text-sm font-semibold">{chosen.name}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {originalBytes !== null && (
                    <span className="line-through">
                      {formatNumber(Math.round(originalBytes / 1024))} {t('file.kb')}{' '}
                    </span>
                  )}
                  {formatNumber(Math.round(chosen.size / 1024))} {t('file.kb')}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-warning-ink">
                  {t('file.previewOnly')}
                </p>
              </>
            ) : working ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-3.5 w-3.5" />
                {t('file.optimizing')}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{hint ?? t('file.choose')}</p>
            )}
          </div>
        </div>

        {chosen ? (
          /* Nothing has been sent yet. One button does it, the other forgets it. */
          <div className="mt-3 flex gap-2 [&>button]:flex-1">
            <Button type="button" size="sm" loading={uploading} onClick={() => onUpload(chosen)}>
              <Upload className="h-4 w-4" />
              {t('file.upload')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setChosen(null);
                setOriginalBytes(null);
              }}
            >
              <X className="h-4 w-4" />
              {t('app.cancel')}
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2 [&>button]:flex-1">
            {/*
             * Two doors rather than one. `capture` opens the camera directly,
             * which is what someone photographing their own shop sign wants.
             */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              className="sm:hidden"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="h-4 w-4" />
              {t('file.camera')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => galleryRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              {currentUrl ? t('file.change') : t('file.gallery')}
            </Button>
            {currentUrl && onRemove && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={removing}
                onClick={onRemove}
              >
                <Trash2 className="h-4 w-4" />
                {t('file.remove')}
              </Button>
            )}
          </div>
        )}

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            void accept(event.target.files?.[0]);
            // Cleared so re-picking the same file still fires a change event.
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
            void accept(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>

      {shown && <p className="mt-1 text-xs font-semibold text-danger">{shown}</p>}
    </div>
  );
}
