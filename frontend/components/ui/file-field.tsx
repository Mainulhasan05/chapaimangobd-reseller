'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/form';

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

  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  /*
   * An object URL is a live handle into the page's memory, not a string. Left
   * unrevoked, every photo a reseller reconsiders stays resident for the life of
   * the tab, which on a cheap phone is how a form starts to stutter.
   */
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  /** Rejects here rather than after an upload that was always going to fail. */
  const accept = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLocalError(t('file.notImage'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError(t('file.tooLarge'));
      return;
    }
    setLocalError(null);
    onChange(file);
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
          accept(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'relative overflow-hidden rounded-xl border-2 border-dashed transition-colors',
          dragging && 'border-primary bg-primary/10',
          shown ? 'border-danger' : !dragging && 'border-input',
          value && !dragging && 'border-solid border-success'
        )}
      >
        {value && preview ? (
          <div className="flex items-center gap-3 p-3">
            {/*
             * A local object URL, so next/image would only add a proxy hop to a
             * blob that is already in memory on this device.
             */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={label}
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                <Check className="h-4 w-4 shrink-0" />
                {t('file.added')}
              </p>
              <p className="truncate text-xs text-muted-foreground">{value.name}</p>
              <p className="tabular text-xs text-muted-foreground">{humanSize(value.size)}</p>
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
                onClick={() => onChange(null)}
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
            <p className="text-sm text-muted-foreground">
              {dragging ? t('file.dropHere') : (hint ?? t('file.choose'))}
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
          onChange={(event) => accept(event.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => accept(event.target.files?.[0])}
        />
      </div>

      {shown && <p className="mt-1 text-xs font-semibold text-danger">{shown}</p>}
    </div>
  );
}
