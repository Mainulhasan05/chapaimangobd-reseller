'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t } from '@/lib/i18n/bn';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A bottom sheet on a phone, a centred dialog from `sm` up.
 *
 * It looked like a sheet before and behaved like a div. What it now does is the
 * part users feel rather than see:
 *
 * - Focus enters the sheet and cannot Tab out behind it, and goes back where it
 *   came from on close.
 * - iOS Safari ignores `overflow: hidden` on the body, so the page is pinned by
 *   position instead and the scroll offset is restored afterwards.
 * - The header and footer stay put while the body scrolls. The Confirm button on
 *   an order is the point of the screen and was reachable only by scrolling to
 *   the bottom of it.
 * - Casual dismissal is guarded when `dirty` is set. A tap on the backdrop used
 *   to discard a half-filled deposit form, screenshot and all.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  footerLead,
  wide,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Pinned above the footer buttons: the numbers a decision depends on. */
  footerLead?: React.ReactNode;
  wide?: boolean;
  /** Set when the sheet holds unsaved input, to guard backdrop, Escape and swipe. */
  dirty?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  /** Every casual dismissal path goes through here. The X button does not. */
  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);

    /*
     * `overflow: hidden` on the body is not enough on iOS, which keeps scrolling
     * the page behind the sheet. Pinning by position works everywhere, at the
     * cost of having to put the reader back where they were.
     */
    const { body } = document;
    const scrollY = window.scrollY;
    const saved = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    // Focus the panel rather than its first control: an autofocused text input
    // on a phone opens the keyboard over the content the user came to read.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey, true);
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.width = saved.width;
      body.style.overflow = saved.overflow;
      window.scrollTo(0, scrollY);
      previouslyFocused?.focus?.();
    };
  }, [open, requestClose]);

  if (!open) return null;

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        className={cn(
          'sheet-in card elev-3 relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-b-none rounded-t-2xl border-0 p-0 outline-none sm:max-h-[85vh] sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        )}
      >
        <header
          className="shrink-0 bg-surface"
          onTouchStart={(event) => {
            dragStart.current = event.touches[0].clientY;
          }}
          onTouchMove={(event) => {
            if (dragStart.current === null) return;
            // Downward only. Dragging a sheet up past its own top looks broken.
            const delta = event.touches[0].clientY - dragStart.current;
            if (delta > 0) setDragY(delta);
          }}
          onTouchEnd={() => {
            // A quarter of the way down is a dismissal; anything less snaps back.
            if (dragY > 120) requestClose();
            setDragY(0);
            dragStart.current = null;
          }}
        >
          {/* The grab handle, which is also the affordance that says "drag me". */}
          <div className="flex justify-center pt-2 sm:hidden">
            <span aria-hidden className="h-1 w-10 rounded-full bg-input" />
          </div>

          <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4 sm:pt-5">
            <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('app.close')}
              className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {(footer || footerLead) && (
          <div className="shrink-0 border-t border-border bg-surface px-5 py-4 pb-safe">
            {footerLead && <div className="mb-3">{footerLead}</div>}
            {/* Full width and side by side on a phone, where a corner button is a stretch. */}
            {footer && (
              <div className="flex gap-2 [&>button]:flex-1 sm:justify-end sm:[&>button]:flex-none">
                {footer}
              </div>
            )}
          </div>
        )}

        {confirmingClose && (
          <div className="fade-in absolute inset-0 z-10 flex flex-col justify-end bg-black/40 sm:justify-center sm:p-6">
            <div className="card elev-3 m-0 rounded-b-none rounded-t-2xl border-0 p-5 sm:rounded-2xl">
              <p className="font-medium">{t('app.unsavedTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('app.unsavedHelp')}</p>
              <div className="mt-4 flex gap-2 [&>button]:flex-1">
                <Button variant="outline" onClick={() => setConfirmingClose(false)}>
                  {t('app.keepEditing')}
                </Button>
                <Button variant="danger" onClick={onClose}>
                  {t('app.discard')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
