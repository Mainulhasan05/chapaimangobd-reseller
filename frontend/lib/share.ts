/**
 * Getting a shop link out of the app and into a chat.
 *
 * This business runs on links pasted into WhatsApp, so sharing is the growth
 * loop, not a convenience. The previous copy button called
 * `navigator.clipboard.writeText` unguarded, which rejects on an insecure origin
 * and is undefined on the older Android browsers this audience actually uses.
 * The promise was never caught, so the failure was an unhandled rejection and
 * the user saw nothing at all.
 */

export type ShareResult = 'shared' | 'copied' | 'failed';

/** The last resort, for browsers with no async clipboard. */
function legacyCopy(text: string): boolean {
  try {
    const field = document.createElement('textarea');
    field.value = text;
    // Off-screen but still selectable. `display: none` cannot be selected.
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, or an insecure origin. Fall through.
    }
  }
  return legacyCopy(text);
}

/**
 * The native share sheet where there is one, the clipboard everywhere else.
 * A share the user backs out of is reported as `failed` and should say nothing:
 * they cancelled on purpose and do not need to be told.
 */
export async function shareLink({
  url,
  title,
  text,
}: {
  url: string;
  title?: string;
  text?: string;
}): Promise<ShareResult> {
  if (navigator.share) {
    try {
      await navigator.share({ url, title, text });
      return 'shared';
    } catch (error) {
      // AbortError is the user closing the sheet, which is not a failure to
      // recover from by silently copying something to their clipboard instead.
      if (error instanceof Error && error.name === 'AbortError') return 'failed';
    }
  }

  return (await copyText(url)) ? 'copied' : 'failed';
}
