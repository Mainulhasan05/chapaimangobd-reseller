'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * A plain overlay rather than a dialog library. It is the only overlay pattern in
 * the app, so a dependency would buy little; what it does need is the two things
 * hand-rolled dialogs usually miss, closing on Escape and not scrolling the page
 * behind itself.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'card max-h-[90vh] w-full overflow-y-auto rounded-b-none sm:rounded-b-xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="বন্ধ করুন"
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>

        {children}

        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
