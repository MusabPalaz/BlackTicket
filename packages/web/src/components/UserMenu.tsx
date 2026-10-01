import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { useSavePreferences } from '@/lib/preferences';
import { THEMES, setTheme, useTheme, type ThemeId } from '@/lib/theme';
import { cx } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';

/** Initials from a full name, falling back to the username. */
function initialsOf(fullName: string | undefined, username: string | undefined): string {
  const source = (fullName ?? username ?? '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * The avatar in the top-right corner: profile settings, and signing out.
 *
 * Sign out is styled as the destructive action it is and sits at the bottom,
 * separated — it is the one item in this menu that ends what you were doing.
 */
export function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const savePreferences = useSavePreferences();
  const toast = useToast();
  const confirm = useConfirm();

  /** Applied at once, then saved to the account so it follows the person. */
  function chooseTheme(next: ThemeId) {
    setTheme(next);
    savePreferences.mutate(
      { theme: next },
      {
        onError: () =>
          toast.error('Theme not saved to your account', 'It still applies in this browser.'),
      },
    );
  }

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

  async function onSignOut() {
    setOpen(false);
    const ok = await confirm({
      title: 'Sign out?',
      body: (
        <p>
          This session ends and you go back to the sign-in screen. Anything not yet saved on this
          screen is lost.
        </p>
      ),
      confirmLabel: 'Sign out',
      tone: 'primary',
    });
    if (!ok) return;
    await logout();
    navigate('/login', { replace: true });
  }

  const needsSecondFactor = Boolean(user && !user.totpEnabled);

  return (
    <div className="relative" ref={container}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          needsSecondFactor
            ? `${user?.fullName} — two-factor authentication is off`
            : user?.fullName
        }
        className={cx(
          'relative flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold transition',
          'border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)]',
          'hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]',
          open && 'border-[var(--color-accent)] text-[var(--color-accent)]',
        )}
      >
        {initialsOf(user?.fullName, user?.username)}

        {/* Carried on the avatar so it is visible from every screen, not only
            from the one place the setting lives. */}
        {needsSecondFactor && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface-raised)] bg-[var(--color-severity-medium)]"
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-lg"
        >
          <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
            <p className="truncate text-sm font-medium">{user?.fullName}</p>
            <p className="truncate text-xs text-[var(--color-content-muted)]">{user?.email}</p>
            <p className="mt-1 text-[11px] tracking-wide text-[var(--color-content-muted)] uppercase">
              {user?.role}
            </p>
          </div>

          {needsSecondFactor && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate('/profile');
              }}
              className="block w-full border-b border-[var(--color-border-subtle)] bg-[var(--color-severity-medium)]/8 px-4 py-2.5 text-left hover:bg-[var(--color-severity-medium)]/15"
            >
              <span className="block text-sm font-medium text-[var(--color-severity-medium)]">
                Two-factor is off
              </span>
              <span className="block text-xs text-[var(--color-content-muted)]">
                Turn it on in your profile
              </span>
            </button>
          )}

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
            className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--color-surface-overlay)]"
          >
            Profile settings
          </button>

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/change-password');
            }}
            className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--color-surface-overlay)]"
          >
            Change password
          </button>

          {/* Kept open after a choice, so the two can be compared side by side. */}
          <div
            role="group"
            aria-label="Theme"
            className="border-t border-[var(--color-border-subtle)] px-4 py-3"
          >
            <p className="mb-2 text-[11px] tracking-wide text-[var(--color-content-muted)] uppercase">
              Theme
            </p>
            <div className="flex items-center gap-2.5">
              {THEMES.map((option) => {
                const selected = option.id === theme;
                return (
                  <button
                    key={option.id}
                    role="menuitemradio"
                    aria-checked={selected}
                    aria-label={option.label}
                    title={`${option.label} — ${option.description}`}
                    onClick={() => chooseTheme(option.id)}
                    style={{ backgroundColor: option.swatch }}
                    className={cx(
                      'h-7 w-7 rounded-full border-2 transition-shadow',
                      selected
                        ? 'border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-soft)]'
                        : 'border-[var(--color-border-strong)] hover:border-[var(--color-content-muted)]',
                    )}
                  />
                );
              })}
              <span className="ml-1 text-xs text-[var(--color-content-muted)]">
                {THEMES.find((option) => option.id === theme)?.label}
              </span>
            </div>
          </div>

          <div className="border-t border-[var(--color-border-subtle)]">
            <button
              role="menuitem"
              onClick={() => void onSignOut()}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-[var(--color-severity-critical)] hover:bg-[var(--color-severity-critical)]/10"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
