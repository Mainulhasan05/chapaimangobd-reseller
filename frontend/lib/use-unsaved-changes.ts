'use client';

import { useEffect } from 'react';
import { t } from '@/lib/i18n/bn';

/**
 * Asks before a full-page form with unsaved edits is left.
 *
 * The settings and landing pages are long forms with one Save at the bottom,
 * and tapping a nav item halfway through silently threw the edits away. This
 * covers the two ways out: closing or reloading the tab (`beforeunload`, which
 * browsers word themselves), and following an in-app link, which the App Router
 * gives no hook for, so link clicks are caught on the way down.
 *
 * Sheets do not need this: `Modal`'s `dirty` guards them.
 */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Chrome still needs a value set to show the prompt.
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // A link to this same page (a hash, a filter) is not leaving it.
      if (url.pathname === window.location.pathname) return;
      if (!window.confirm(t('app.unsavedLeave'))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}
