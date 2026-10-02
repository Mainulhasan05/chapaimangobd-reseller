'use client';

import { useEffect } from 'react';
import { t } from '@/lib/i18n/bn';

/**
 * Asks before a full-page form with unsaved edits is left.
 *
 * The settings and landing pages are long forms with one Save at the bottom,
 * and tapping a nav item halfway through silently threw the edits away. This
 * covers the three ways out: closing or reloading the tab (`beforeunload`,
 * which browsers word themselves), following an in-app link, which the App
 * Router gives no hook for, so link clicks are caught on the way down, and the
 * phone's Back button, which on Android is how most people leave a screen.
 *
 * Back is caught by standing one history entry in front of the page while it
 * is dirty: pressing Back pops that entry, not the page, and the reader is
 * asked. The entry carries the router's own state, so the App Router sees a
 * return to the same page and does nothing.
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

    let guarded = true;
    window.history.pushState(window.history.state, '', window.location.href);
    const onPopState = () => {
      if (!guarded) return;
      if (window.confirm(t('app.unsavedLeave'))) {
        guarded = false;
        window.history.back();
      } else {
        window.history.pushState(window.history.state, '', window.location.href);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
      // A save leaves the extra entry behind; it points at this same page, so
      // pressing Back over it is a no-op rather than a wrong turn.
      guarded = false;
    };
  }, [dirty]);
}
