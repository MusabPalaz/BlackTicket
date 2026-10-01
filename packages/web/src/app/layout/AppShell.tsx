import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BRANDING, Permission, detectObservableType } from '@black-ticket/shared';
import { useAuthStore } from '@/lib/auth-store';
import { usePreferences } from '@/lib/preferences';
import { DEFAULT_THEME, isThemeId, setTheme } from '@/lib/theme';
import { BrandMark } from '@/components/brand/BrandMark';
import { NotificationBell } from '@/components/NotificationBell';
import { UserMenu } from '@/components/UserMenu';
import { Button, cx } from '@/components/ui';
import {
  IconAlerts,
  IconAudit,
  IconCases,
  IconClose,
  IconDashboard,
  IconDatabase,
  IconDomain,
  IconKey,
  IconMenu,
  IconObservables,
  IconPlaybook,
  IconSearch,
  IconSettings,
  IconShield,
  IconSidebar,
  IconSso,
  IconUsers,
} from '@/components/icons';

interface NavItem {
  to: string;
  label: string;
  hint: string;
  icon: ReactNode;
  permission?: Permission;
  section: 'work' | 'admin';
}

const ICON_CLASS = 'h-4 w-4 shrink-0';

const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    hint: 'Open cases and SLA risk',
    icon: <IconDashboard className={ICON_CLASS} />,
    section: 'work',
  },
  {
    to: '/cases',
    label: 'Cases',
    hint: 'Investigations',
    icon: <IconCases className={ICON_CLASS} />,
    permission: Permission.CASE_READ,
    section: 'work',
  },
  {
    to: '/alerts',
    label: 'Alerts',
    hint: 'Incoming detections',
    icon: <IconAlerts className={ICON_CLASS} />,
    permission: Permission.ALERT_READ,
    section: 'work',
  },
  {
    to: '/observables',
    label: 'Observables',
    hint: 'Global IOC search',
    icon: <IconObservables className={ICON_CLASS} />,
    permission: Permission.CASE_READ,
    section: 'work',
  },
  {
    to: '/admin/users',
    label: 'Accounts',
    hint: 'User administration',
    icon: <IconUsers className={ICON_CLASS} />,
    permission: Permission.USER_MANAGE,
    section: 'admin',
  },
  {
    to: '/admin/playbooks',
    label: 'Playbooks',
    hint: 'Task checklists per case type',
    icon: <IconPlaybook className={ICON_CLASS} />,
    permission: Permission.TAXONOMY_MANAGE,
    section: 'admin',
  },
  {
    to: '/admin/audit',
    label: 'Audit trail',
    hint: 'Every recorded action',
    icon: <IconAudit className={ICON_CLASS} />,
    permission: Permission.AUDIT_READ,
    section: 'admin',
  },
  {
    to: '/admin/settings',
    label: 'System settings',
    hint: 'Categories and SLA targets',
    icon: <IconSettings className={ICON_CLASS} />,
    permission: Permission.SETTINGS_MANAGE,
    section: 'admin',
  },
  {
    to: '/admin/whitelist',
    label: 'Correlation whitelist',
    hint: 'Indicators that never link cases',
    icon: <IconShield className={ICON_CLASS} />,
    permission: Permission.TAXONOMY_MANAGE,
    section: 'admin',
  },
  {
    to: '/admin/domain',
    label: 'Organisation domain',
    hint: 'E-mail domain policy',
    icon: <IconDomain className={ICON_CLASS} />,
    permission: Permission.SETTINGS_MANAGE,
    section: 'admin',
  },
  {
    to: '/admin/sso',
    label: 'Single sign-on',
    hint: 'Directory sign-in and role mapping',
    icon: <IconSso className={ICON_CLASS} />,
    permission: Permission.SETTINGS_MANAGE,
    section: 'admin',
  },
  {
    to: '/admin/system',
    label: 'System health',
    hint: 'Database size and housekeeping',
    icon: <IconDatabase className={ICON_CLASS} />,
    permission: Permission.SETTINGS_MANAGE,
    section: 'admin',
  },
  {
    to: '/admin/api-keys',
    label: 'API keys',
    hint: 'Ingest credentials for SIEM integrations',
    icon: <IconKey className={ICON_CLASS} />,
    permission: Permission.API_KEY_MANAGE,
    section: 'admin',
  },
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '/', action: 'Focus search' },
  { keys: 'c', action: 'New case' },
  { keys: 'g then d', action: 'Go to dashboard' },
  { keys: 'g then c', action: 'Go to cases' },
  { keys: 'g then a', action: 'Go to alerts' },
  { keys: 'g then o', action: 'Go to observables' },
  { keys: '[', action: 'Collapse or expand the sidebar' },
  { keys: '?', action: 'This help' },
  { keys: 'Esc', action: 'Close menus and dialogs' },
];

/**
 * The collapsed sidebar is a per-screen choice — wanted on a laptop, not on
 * the wall display — so it lives in this browser rather than on the account.
 * Storage can be unavailable (private windows, blocked site data); the sidebar
 * then simply starts expanded.
 */
const SIDEBAR_KEY = 'bt.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

function titleForPath(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname.startsWith('/profile')) return 'Your account';
  if (pathname.startsWith('/change-password')) return 'Change password';
  if (pathname.startsWith('/cases/new')) return 'New case';
  if (/^\/cases\/[^/]+$/.test(pathname)) return 'Case';
  const match = NAV_ITEMS.filter((item) => item.to !== '/')
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname.startsWith(item.to));
  return match?.label ?? BRANDING.productName;
}

export function AppShell() {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const location = useLocation();
  const navigate = useNavigate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [helpOpen, setHelpOpen] = useState(false);

  const toggleCollapsed = useCallback(() => setCollapsed((current) => !current), []);
  useEffect(() => writeCollapsed(collapsed), [collapsed]);

  // The account's theme wins over whatever this browser showed last: someone
  // signing in at a shared console gets their own choice, or the default.
  const preferences = usePreferences();
  const accountTheme = preferences.data?.preferences.theme;
  useEffect(() => {
    if (!preferences.data) return;
    setTheme(isThemeId(accountTheme) ? accountTheme : DEFAULT_THEME);
  }, [preferences.data, accountTheme]);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  const visible = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));
  const work = visible.filter((item) => item.section === 'work');
  const admin = visible.filter((item) => item.section === 'admin');

  // Navigating closes the drawer. Adjusted during render rather than in an
  // effect: an effect would paint the new page with the drawer still over it
  // and close it on a second pass.
  const [drawerPath, setDrawerPath] = useState(location.pathname);
  if (drawerPath !== location.pathname) {
    setDrawerPath(location.pathname);
    setDrawerOpen(false);
  }

  /*
   * A modal that does not move focus is a modal only for the mouse: the
   * keyboard stays behind it, tabbing through the page underneath. Focus goes
   * into the dialog on open, is kept inside it while it is up, and returns to
   * whatever opened it on close.
   */
  useEffect(() => {
    if (!helpOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = helpRef.current;
    panel?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [helpOpen]);

  /**
   * Global shortcuts.
   *
   * `g` then a letter is the pattern people already know from issue trackers,
   * and it keeps single letters free. Nothing fires while a field has focus —
   * typing "c" into a search box must never open a form.
   */
  useEffect(() => {
    let awaitingGo = false;
    let goTimer: number | undefined;

    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

      if (event.key === 'Escape') {
        setHelpOpen(false);
        setDrawerOpen(false);
        if (typing) (target as HTMLElement).blur();
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (awaitingGo) {
        awaitingGo = false;
        window.clearTimeout(goTimer);
        const destination = { d: '/', c: '/cases', a: '/alerts', o: '/observables' }[event.key];
        if (destination) {
          event.preventDefault();
          navigate(destination);
        }
        return;
      }

      if (event.key === 'g') {
        awaitingGo = true;
        goTimer = window.setTimeout(() => {
          awaitingGo = false;
        }, 1_200);
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === '?') {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (event.key === '[') {
        event.preventDefault();
        toggleCollapsed();
      } else if (event.key === 'c' && hasPermission(Permission.CASE_CREATE)) {
        event.preventDefault();
        navigate('/cases/new');
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(goTimer);
    };
  }, [navigate, hasPermission, toggleCollapsed]);

  /** An indicator goes to the IOC search; anything else searches cases. */
  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const term = search.trim();
    if (!term) return;
    const looksLikeIndicator = Boolean(detectObservableType(term));
    navigate(
      looksLikeIndicator
        ? `/observables?q=${encodeURIComponent(term)}`
        : `/cases?status=all&q=${encodeURIComponent(term)}`,
    );
    setSearch('');
    searchRef.current?.blur();
  }

  /**
   * The navigation, full or as a rail of icons.
   *
   * In the rail the labels stay in the markup for screen readers and the
   * tooltip carries both the name and the hint, so collapsing hides text from
   * the eye only — nothing becomes unreachable or anonymous.
   */
  function renderSidebar(rail: boolean) {
    const linkClass = ({ isActive }: { isActive: boolean }) =>
      cx(
        'group relative flex items-center gap-2.5 rounded-[var(--radius-control)] py-2 text-sm transition-colors',
        rail ? 'justify-center px-0' : 'px-3',
        isActive
          ? 'bg-[var(--color-surface-overlay)] text-[var(--color-content)]'
          : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-content)]',
      );

    const link = (item: NavItem) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        title={rail ? `${item.label} — ${item.hint}` : item.hint}
        className={linkClass}
      >
        {({ isActive }) => (
          <>
            <span
              className={cx(
                'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-[var(--color-accent)] transition-opacity',
                isActive ? 'opacity-100' : 'opacity-0',
              )}
            />
            {item.icon}
            <span className={rail ? 'sr-only' : 'truncate'}>{item.label}</span>
          </>
        )}
      </NavLink>
    );

    return (
      <div className="flex h-full flex-col bg-[var(--color-surface-raised)]">
        <div
          className={cx(
            // A floor, so the rail (mark only, no name) is as tall and the nav does not jump.
            'flex min-h-[67px] shrink-0 items-center gap-2.5 border-b border-[var(--color-border-subtle)] py-4',
            rail ? 'justify-center' : 'px-5',
          )}
        >
          <BrandMark size="sm" withText={!rail} />
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
            className="ml-auto text-[var(--color-content-muted)] lg:hidden"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        <nav
          aria-label="Main"
          className={cx(
            'flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto',
            rail ? 'p-2' : 'p-3',
          )}
        >
          {work.map(link)}

          {admin.length > 0 &&
            (rail ? (
              // The heading would not fit; a rule keeps the two groups apart.
              <hr className="mx-2 my-3 border-[var(--color-border-subtle)]" />
            ) : (
              <p className="mt-5 mb-1 px-3 text-[11px] font-medium tracking-wider text-[var(--color-content-faint)] uppercase">
                Administration
              </p>
            ))}
          {admin.map(link)}
        </nav>

        <div
          className={cx(
            'flex items-center border-t border-[var(--color-border-subtle)]',
            rail ? 'flex-col gap-1 py-2' : 'gap-2 py-2 pr-2 pl-5',
          )}
        >
          <button
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            className={cx(
              'text-left text-xs text-[var(--color-content-faint)] hover:text-[var(--color-content-muted)]',
              !rail && 'flex-1',
            )}
          >
            {rail ? (
              <kbd>?</kbd>
            ) : (
              <>
                Press <kbd>?</kbd> for keyboard shortcuts
              </>
            )}
          </button>
          {/* The drawer on narrow screens is already dismissable; collapsing
              only means something for the permanent sidebar. */}
          <button
            onClick={toggleCollapsed}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!rail}
            title={rail ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'}
            className="hidden rounded-[var(--radius-control)] p-1.5 text-[var(--color-content-faint)] transition-colors hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-content)] lg:block"
          >
            <IconSidebar className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-[var(--color-accent)] focus:px-3 focus:py-1.5 focus:text-sm focus:text-black"
      >
        Skip to content
      </a>

      {/* Narrow screens get the same navigation as a drawer rather than a
          cut-down menu — an analyst on a laptop should not lose features. */}
      <aside
        className={cx(
          'hidden shrink-0 border-r border-[var(--color-border-subtle)] transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {renderSidebar(collapsed)}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <div className="animate-in absolute inset-y-0 left-0 w-64 border-r border-[var(--color-border-subtle)] shadow-[var(--shadow-overlay)]">
            {renderSidebar(false)}
          </div>
        </div>
      )}

      {/* The watermark lives on the content column rather than on the shell, so
          it centres in the space the reader actually looks at instead of being
          pushed off-axis by the sidebar. Everything above it — the top bar,
          every card — is opaque, so it only ever shows in the gaps. */}
      <div className="app-backdrop flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 sm:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="text-[var(--color-content-muted)] hover:text-[var(--color-content)] lg:hidden"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <h1 className="truncate text-sm font-medium">{titleForPath(location.pathname)}</h1>

          <form onSubmit={onSearch} className="ml-auto hidden max-w-sm flex-1 sm:block">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-[var(--color-content-faint)]" />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cases or indicators…"
                aria-label="Search cases or indicators"
                className={cx(
                  'w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
                  'py-1.5 pr-8 pl-8 text-sm outline-none transition-colors',
                  'placeholder:text-[var(--color-content-faint)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-accent)]',
                )}
              />
              {!search && (
                <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px]">
                  /
                </kbd>
              )}
            </div>
          </form>

          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {helpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={() => setHelpOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            ref={helpRef}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            className="animate-in relative w-full max-w-sm rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-overlay)] outline-none"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Keyboard shortcuts</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHelpOpen(false)}
                aria-label="Close"
              >
                <IconClose className="h-4 w-4" />
              </Button>
            </div>
            <dl className="space-y-2 text-sm">
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys} className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--color-content-muted)]">{shortcut.action}</dt>
                  <dd>
                    <kbd>{shortcut.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
