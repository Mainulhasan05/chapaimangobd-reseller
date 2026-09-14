/**
 * Shrinking and re-encoding a photograph in the browser, before it is uploaded.
 *
 * A phone camera in this market produces a four to twelve megabyte JPEG, several
 * thousand pixels on the long edge. Every one of those bytes was being pushed up
 * a mobile connection so that the result could be displayed in a tile ninety
 * pixels wide. The upload was the slowest thing in the app, and it was slowest
 * for exactly the people on the worst connections.
 *
 * So the work happens here instead: decode once, scale to something the screen
 * can actually use, and re-encode as WebP, which is roughly a third the size of
 * the equivalent JPEG at a quality nobody can tell apart on a phone. A typical
 * eight megabyte camera photograph comes out around three hundred kilobytes.
 *
 * Everything about this is best effort. A browser that cannot decode the file,
 * cannot encode WebP, or simply fails, hands back the original untouched: a
 * slower upload is a far better outcome than a refused one, and the server
 * accepts the original formats regardless.
 */

export type OptimizeResult = {
  /** What to upload. The original file when nothing could be improved. */
  file: File;
  /** Bytes before and after, for telling someone what just happened. */
  originalBytes: number;
  bytes: number;
  /** False when the original was handed back untouched. */
  optimized: boolean;
};

export type OptimizePreset = {
  /** The longest edge of the result, in pixels. Never upscales. */
  maxEdge: number;
  /** WebP quality, 0 to 1. */
  quality: number;
};

/**
 * How hard to squeeze, by what the picture is for.
 *
 * A product photograph is looked at, so it keeps enough resolution to survive a
 * full width view on a large phone. A logo is rendered in a circle a hundred
 * pixels across and never larger. A KYC document is read by a human deciding
 * whether to approve someone, so it keeps the most detail of the three: the
 * point of shrinking it is the upload, never the legibility of the numbers on
 * a national ID card.
 */
export const PRESETS = {
  product: { maxEdge: 1600, quality: 0.82 },
  logo: { maxEdge: 512, quality: 0.85 },
  document: { maxEdge: 2000, quality: 0.9 },
} satisfies Record<string, OptimizePreset>;

export type PresetName = keyof typeof PRESETS;

/** Whether this browser can actually write WebP, asked once and remembered. */
let webpSupport: boolean | null = null;

function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/**
 * Decodes a file into something drawable.
 *
 * `createImageBitmap` is asked to apply the EXIF orientation, which is what
 * stops a photograph taken in portrait from arriving on its side: the rotation
 * lives in metadata that re-encoding would otherwise discard, leaving a
 * sideways picture that no longer carries the tag that would fix it.
 *
 * The fallback path exists for older WebKit, which has the function but not the
 * options argument. An `<img>` element applies orientation on its own.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* falls through to the element path below */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode failed'));
      image.src = url;
    });
  } finally {
    // Revoked as soon as the bytes are decoded. The bitmap does not need the
    // URL to stay alive, and a handle left open holds the whole file in memory.
    URL.revokeObjectURL(url);
  }
}

const widthOf = (source: ImageBitmap | HTMLImageElement) =>
  'naturalWidth' in source ? source.naturalWidth : source.width;

const heightOf = (source: ImageBitmap | HTMLImageElement) =>
  'naturalHeight' in source ? source.naturalHeight : source.height;

/** Re-encodes the canvas, preferring WebP and falling back to JPEG. */
function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const type = supportsWebp() ? 'image/webp' : 'image/jpeg';
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/** `photo.HEIC` becomes `photo.webp`, so the name matches what is inside it. */
function rename(name: string, mime: string): string {
  const extension = mime === 'image/webp' ? 'webp' : 'jpg';
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.${extension}`;
}

/**
 * Optimizes one image, or returns it untouched if it cannot be improved.
 *
 * Never rejects. Every failure path is a reason to upload the original rather
 * than a reason to stop, because the alternative is telling someone their
 * perfectly good photograph cannot be used.
 */
export async function optimizeImage(
  file: File,
  preset: OptimizePreset = PRESETS.product
): Promise<OptimizeResult> {
  const unchanged: OptimizeResult = {
    file,
    originalBytes: file.size,
    bytes: file.size,
    optimized: false,
  };

  // An animated GIF loses its animation on a canvas, and an SVG is already as
  // small as it is going to get. Neither is worth the risk of mangling.
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return unchanged;
  }

  try {
    const source = await decode(file);
    const width = widthOf(source);
    const height = heightOf(source);
    if (!width || !height) return unchanged;

    // Never upscales. Enlarging a small picture adds bytes and no detail.
    const scale = Math.min(1, preset.maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) return unchanged;

    // Smoothing matters when shrinking by a factor of four or more, which is
    // the normal case here; without it the result is visibly speckled.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, targetWidth, targetHeight);

    if ('close' in source) source.close();

    const blob = await encode(canvas, preset.quality);
    if (!blob) return unchanged;

    /*
     * An already-small, already-efficient image can come out larger than it
     * went in. Keeping the original is the honest outcome: the point was a
     * smaller upload, and this did not produce one.
     */
    if (blob.size >= file.size && scale === 1) return unchanged;

    const optimized = new File([blob], rename(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });

    return {
      file: optimized,
      originalBytes: file.size,
      bytes: optimized.size,
      optimized: true,
    };
  } catch {
    return unchanged;
  }
}

/**
 * Optimizes several, one after another rather than all at once.
 *
 * Sequential on purpose. Decoding six twelve-megapixel photographs in parallel
 * on a cheap Android phone means six full size bitmaps resident at the same
 * time, which is how the tab gets killed. One at a time is barely slower and
 * does not run the device out of memory.
 */
export async function optimizeImages(
  files: File[],
  preset: OptimizePreset = PRESETS.product
): Promise<OptimizeResult[]> {
  const results: OptimizeResult[] = [];
  for (const file of files) {
    results.push(await optimizeImage(file, preset));
  }
  return results;
}
