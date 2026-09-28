import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';
import { IconCheck, IconClose } from './icons';

type Tone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: Tone;
  message: string;
  detail?: string;
}

interface ToastApi {
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Transient feedback.
 *
 * Confirmations used to be banners that stayed on the page until it navigated,
 * so a screen slowly filled with stale "saved" messages. A toast says its piece
 * and leaves. Errors stay longer than confirmations, because an error is
 * something the reader has to act on rather than merely notice.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, message: string, detail?: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current.slice(-3), { id, tone, message, detail }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8_000 : 4_000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, detail) => push('success', message, detail),
      error: (message, detail) => push('error', message, detail),
      info: (message, detail) => push('info', message, detail),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Announced politely so a screen reader hears confirmations without
          being interrupted mid-sentence. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'animate-in pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-control)] border px-3.5 py-3',
              'bg-[var(--color-surface-raised)] shadow-[var(--shadow-overlay)]',
              toast.tone === 'success' && 'border-[var(--color-tlp-green)]/50',
              toast.tone === 'error' && 'border-[var(--color-severity-critical)]/50',
              toast.tone === 'info' && 'border-[var(--color-border-strong)]',
            )}
          >
            <span
              className={cx(
                'mt-0.5 shrink-0',
                toast.tone === 'success' && 'text-[var(--color-tlp-green)]',
                toast.tone === 'error' && 'text-[var(--color-severity-critical)]',
                toast.tone === 'info' && 'text-[var(--color-accent)]',
              )}
            >
              {toast.tone === 'success' ? (
                <IconCheck className="h-4 w-4" />
              ) : (
                <span className="block h-4 w-4 text-center text-sm leading-4">
                  {toast.tone === 'error' ? '!' : 'i'}
                </span>
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm">{toast.message}</p>
              {toast.detail && (
                <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">{toast.detail}</p>
              )}
            </div>

            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 text-[var(--color-content-faint)] hover:text-[var(--color-content)]"
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
