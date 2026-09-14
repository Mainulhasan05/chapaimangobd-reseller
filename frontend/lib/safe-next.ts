/**
 * A `?next=` value that is safe to navigate to, or null.
 *
 * Only a same-origin absolute path is accepted. `//evil.example` and
 * `/\evil.example` both start with a slash but are read by browsers as
 * protocol-relative URLs to another host, and anything with a scheme
 * (`javascript:`, `https:`) is never a path. Control characters are refused too,
 * because browsers strip tabs and newlines before parsing, which turns `/\t/evil`
 * back into `//evil`.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (hasControlOrBackslash(value)) return null;

  // Final check against the URL parser itself: the result must stay on this origin.
  try {
    const base = 'http://same-origin.invalid';
    const url = new URL(value, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** A C0 control character, DEL, or a backslash anywhere in the value. */
function hasControlOrBackslash(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}
