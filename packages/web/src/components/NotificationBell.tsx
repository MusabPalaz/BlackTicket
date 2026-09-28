import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cx } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';
import type { NotificationRow } from '@/features/alerts/types';

/**
 * In-app notifications, in the top bar beside the account menu.
 *
 * Polled every 30 seconds rather than pushed: at this scale that is a handful
 * of cheap queries a second, and it avoids a WebSocket layer whose only hard
 * part — authenticating the socket without putting the token in a URL — is
 * work that belongs with a wider realtime story, not with SLA alerts.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const container = useRef<HTMLDivElement>(null);

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationRow[]; unread: number }>('/notifications'),
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = notifications.data?.unread ?? 0;

  return (
    <div className="relative" ref={container}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          'relative flex h-9 w-9 items-center justify-center rounded-full border transition',
          'border-[var(--color-border-subtle)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]',
          open && 'border-[var(--color-accent)] text-[var(--color-accent)]',
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4.5 w-4.5">
          <path
            d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M13.7 19a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-severity-critical)] px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 max-h-96 w-84 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-lg"
          style={{ width: '21rem' }}
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2">
            <span className="text-xs text-[var(--color-content-muted)]">
              {unread} unread of {notifications.data?.items.length ?? 0}
            </span>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="text-xs underline">
                Mark all read
              </button>
            )}
          </div>

          {notifications.data?.items.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-[var(--color-content-muted)]">
              Nothing to report.
            </p>
          )}

          {notifications.data?.items.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              onClick={() => {
                if (!item.isRead) markRead.mutate(item.id);
                if (item.link) {
                  setOpen(false);
                  navigate(item.link);
                }
              }}
              className={cx(
                'block w-full border-b border-[var(--color-border-subtle)] px-3 py-2.5 text-left last:border-b-0',
                'hover:bg-[var(--color-surface-overlay)]',
                !item.isRead && 'bg-[var(--color-surface-overlay)]/60',
              )}
            >
              <p className="flex items-start gap-2 text-sm">
                {!item.isRead && (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                )}
                <span>{item.title}</span>
              </p>
              {item.body && (
                <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">{item.body}</p>
              )}
              <p className="mt-0.5 text-[11px] text-[var(--color-content-muted)]">
                {formatDateTime(item.createdAt)}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
