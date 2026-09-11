'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/form';
import { Spinner } from '@/components/ui/button';
import { optimizeImage, PRESETS } from '@/lib/image-optimize';

/**
 * Picking a photograph, without the browser's own file input.
 *
 * A bare `<input type="file">` renders the operating system's chrome, which on a
 * Bengali KYC form reads "Choose File / No file chosen" in English, gives no
 * preview, no size, and no way to change your mind. It is also a tiny target.
 *
 * This is a tile instead: tap anywhere on it, and once a photo is chosen the
 * tile becomes that photo. On a phone the camera and the gallery are separate
 * buttons, because every document here is a thing you photograph in the moment
 * rather than a file you already have.
 */

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Some iPhones hand over a HEIC with an empty mime type. The name is the only
 * thing left to go on, and the file is re-encoded to WebP a moment later.
 */
const isImage = (file: File) =>
  file.type.startsWith('image/') || (file.type === '' && /\.(heic|heif)$/i.test(file.name));

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024))} ${t('file.kb')}`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} ${t('file.mb')}`;
}

export function FileField({
  label,
  value,
  onChange,
  required,
  error,
  hint,
  id,
}: {
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
  error?: string;
  hint?: string;
  id?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [originalBytes, setOriginalBytes] = useState<number | null>(null);

  const imageRef = useRef<HTMLImageElement>(null);

  /*
   * An object URL is a live handle into the page's memory, not a string. Left
   * unrevoked, every photo a reseller reconsiders stays resident for the life of
   * the tab, which on a cheap phone is how a form starts to stutter.
   *
   * The URL is written straight onto the img element rather than mirrored into
   * React state. Pushing the latest value out to a DOM node and tearing it down
   * again is what an effect is for; holding a second copy of the file in state
   * would just be two sources of truth that can disagree for a render.
   */
  useEffect(() => {
    const image = imageRef.current;
    if (!image || !value) return undefined;

    const url = URL.createObjectURL(value);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [value]);

  /**
   * Rejects here rather than after an upload that was always going to fail.
   *
   * The document is shrunk and re-encoded to WebP first, which is what makes a
   * photographed national ID uploadable at all on a slow connection. The
   * `document` preset is the gentlest of the three: the point of shrinking this
   * is the upload, never the legibility of the numbers the owner has to read.
   */
  const accept = async (file: File | null | undefined) => {
    if (!file) return;
    if (!isImage(file)) {
      setLocalError(t('file.notImage'));
      return;
    }

    setWorking(true);
    const result = await optimizeImage(file, PRESETS.document);
    setWorking(false);

    // Judged on what leaves the device, not on what came off the camera.
    if (result.file.size > MAX_BYTES) {
      setLocalError(t('file.tooLarge'));
      return;
    }

    setLocalError(null);
    setOriginalBytes(result.optimized ? result.originalBytes : null);
    onChange(result.file);
  };

  const shown = error ?? localError;

  return (
    <div>
      <Label htmlFor={fieldId}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </Label>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void accept(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'relative overflow-hidden rounded-xl border-2 border-dashed transition-colors',
          dragging && 'border-primary bg-primary-softer',
          shown ? 'border-danger' : !dragging && 'border-input',
          value && !dragging && 'border-solid border-success'
        )}
      >
        {value ? (
          <div className="flex items-center gap-3 p-3">
            {/*
             * A local object URL, so next/image would only add a proxy hop to a
             * blob that is already in memory on this device.
             */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              alt={label}
              // Tinted, so the tile never flashes a broken-image icon in the
              // frame between mount and the effect setting src.
              className="h-16 w-16 shrink-0 rounded-lg bg-muted object-cover"
            />

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                <Check className="h-4 w-4 shrink-0" />
                {t('file.added')}
              </p>
              <p className="truncate text-xs text-muted-foreground">{value.name}</p>
              <p className="tabular text-xs text-muted-foreground">
                {originalBytes !== null && (
                  <span className="line-through">{humanSize(originalBytes)} </span>
                )}
                {humanSize(value.size)}
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className="tap rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('file.change')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOriginalBytes(null);
                }}
                aria-label={t('file.remove')}
                className="tap flex items-center justify-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
            <ImagePlus aria-hidden className="h-7 w-7 text-muted-foreground" />
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {working && <Spinner className="h-3.5 w-3.5" />}
              {working ? t('file.optimizing') : dragging ? t('file.dropHere') : (hint ?? t('file.choose'))}
            </p>

            {/*
             * Two doors rather than one. `capture` opens the camera directly,
             * which is what someone photographing their own ID actually wants,
             * and the gallery covers the photo they already took.
             */}
            <div className="flex w-full gap-2 [&>button]:flex-1">
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
                className="tap flex items-center justify-center gap-1.5 rounded-lg border-2 border-input px-3 text-sm font-semibold hover:bg-muted"
              >
                {t('file.gallery')}
              </button>
            </div>
          </div>
        )}

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => void accept(event.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => void accept(event.target.files?.[0])}
        />
      </div>

      {shown && <p className="mt-1 text-xs font-semibold text-danger">{shown}</p>}
    </div>
  );
}
