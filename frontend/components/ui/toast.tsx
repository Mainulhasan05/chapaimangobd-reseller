'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/*
 * Confirmation, in one place.
 *
 * Before this existed the app told you a mutation had worked by closing a modal,
 * or by doing nothing at all. Saving a sell price moved money-adjacent state and
 * produced no visible change whatsoever, which reads as a broken button.
 *
 * The container is a live region, so the announcement reaches a screen reader
 * as well as an eye. It sits above the bottom navigation, because on a phone
 * that is the one strip of screen guaranteed not to be under a thumb.
 */

export type ToastTone = 'success' | 'danger' | 'neutral';

type Toast = { id: number; message: string; tone: ToastTone };

type Push = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<Push>(() => {});

/** Fire a toast. Safe to call outside the provider, where it does nothing. */
export function useToast(): Push {
  return useContext(ToastContext);
}

const DURATION = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<Push>(
    (message, tone = 'success') => {
      const id = (nextId.current += 1);
      setToasts((prev) => {
        // Three is as many as anyone reads. Older ones fall off the top.
        const next = [...prev, { id, message, tone }];
        return next.slice(-3);
      });
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION)
      );
    },
    [dismiss]
  );

  // A queued dismissal that fires after unmount would set state on a dead tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={cn(
              'toast-in elev-3 pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-left text-sm font-medium',
              toast.tone === 'danger'
                ? 'bg-danger text-danger-foreground'
                : toast.tone === 'success'
                  ? 'bg-success text-success-foreground'
                  : 'bg-foreground text-background'
            )}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
