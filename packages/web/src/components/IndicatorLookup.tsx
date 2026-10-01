import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { planLookup, type LookupProvider, type ObservableType } from '@black-ticket/shared';
import { api } from '@/lib/api';
import { cx } from './ui';
import { IconSearch } from './icons';

/**
 * The enabled lookup services, and the organisation's own domains (which are
 * never looked up outside). Both change rarely, so they are kept a while.
 */
export function useLookupProviders() {
  return useQuery({
    queryKey: ['lookup-providers'],
    queryFn: () =>
      api.get<{ items: LookupProvider[]; organisationDomains: string[] }>('/lookup-providers'),
    staleTime: 5 * 60_000,
  });
}

const MENU_WIDTH = 248;

/**
 * Look an indicator up with third-party services — VirusTotal, X-Force and
 * whatever else an administrator configured.
 *
 * Opened from the small search button, or by right-clicking the indicator
 * itself. Each choice opens the service in a new tab, from the analyst's own
 * browser, without a referrer: the service learns the indicator and nothing
 * about this system.
 *
 * Only what makes sense is offered: an outside service only for types it can
 * say something about, never for a private address or an internal name, and
 * an address-only service such as AbuseIPDB never for a domain. When nothing
 * is left the button is not shown at all; when the case's PAP or the
 * indicator's TLP is what holds the outside services back, the menu says so.
 */
export function IndicatorLookup({
  type,
  value,
  blockedReason,
  children,
}: {
  type: ObservableType | string;
  value: string;
  blockedReason?: string | null;
  /** The indicator as shown; right-clicking it opens the same menu. */
  children?: ReactNode;
}) {
  const providers = useLookupProviders();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const plan = planLookup(providers.data?.items ?? [], type as ObservableType, value, {
    blockedReason,
    organisationDomains: providers.data?.organisationDomains,
  });
  const available = plan.options.length > 0 || plan.withheld?.policy === true;
  const outside = plan.options.some((option) => !option.internal);

  function openAt(x: number, y: number) {
    // Kept inside the window, whichever corner it was opened from.
    const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8);
    const top = Math.min(y, window.innerHeight - 240);
    setAt({ x: Math.max(8, left), y: Math.max(8, top) });
  }

  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLElement>('a, [tabindex]')?.focus();

    const close = () => setAt(null);
    const onPointer = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    // A fixed menu would drift away from its indicator on scroll; it closes.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [at]);

  return (
    <>
      {children !== undefined && (
        <span
          // With nothing to offer, the browser's own menu (copy and so on) stays.
          onContextMenu={
            available
              ? (event) => {
                  event.preventDefault();
                  openAt(event.clientX, event.clientY);
                }
              : undefined
          }
        >
          {children}
        </span>
      )}
      {available && (
        <button
          ref={button}
          type="button"
          aria-haspopup="menu"
          aria-expanded={at !== null}
          aria-label={`Look up ${value}`}
          title="Look up this indicator (or right-click it)"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            if (at) setAt(null);
            else openAt(rect.left, rect.bottom + 4);
          }}
          className={cx(
            'inline-flex shrink-0 items-center rounded p-1 align-middle text-[var(--color-content-faint)] transition-colors hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-accent)]',
            at && 'text-[var(--color-accent)]',
          )}
        >
          <IconSearch className="h-3.5 w-3.5" />
        </button>
      )}

      {at && available && (
        <div
          ref={menu}
          role="menu"
          aria-label={`Look up ${value}`}
          className="animate-in fixed z-50 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] text-sm shadow-[var(--shadow-overlay)]"
          style={{ left: at.x, top: at.y, width: MENU_WIDTH }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="truncate border-b border-[var(--color-border-subtle)] px-3 py-2 font-mono text-xs text-[var(--color-content-muted)]">
            {value}
          </p>
          {plan.options.length > 0 && (
            <ul className="py-1">
              {plan.options.map((option) => (
                <li key={option.id}>
                  <a
                    role="menuitem"
                    href={option.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setAt(null)}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-[var(--color-surface-overlay)] focus:bg-[var(--color-surface-overlay)] focus:outline-none"
                  >
                    <span className="truncate">{option.name}</span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-xs text-[var(--color-content-faint)]"
                    >
                      {option.internal ? 'in-house ↗' : '↗'}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {plan.withheld && (
            <p
              className={cx(
                'px-3 py-2.5 text-xs',
                plan.options.length > 0 && 'border-t border-[var(--color-border-subtle)]',
                plan.withheld.policy
                  ? 'text-[var(--color-severity-medium)]'
                  : 'text-[var(--color-content-muted)]',
              )}
            >
              {plan.withheld.reason}
            </p>
          )}
          {plan.options.length > 0 && (
            <p className="border-t border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] text-[var(--color-content-faint)]">
              {outside
                ? 'Opens in a new tab and sends the indicator to that service.'
                : 'Opens in a new tab.'}
            </p>
          )}
        </div>
      )}
    </>
  );
}
