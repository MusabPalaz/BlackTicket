import { useSyncExternalStore } from 'react';

/**
 * Colour themes.
 *
 * A theme only re-points the design tokens (see `styles/index.css`); nothing
 * in a component knows which one is active. The choice belongs to the
 * account, so it follows a person between machines, and is mirrored in this
 * browser so the first paint — the sign-in screen included — is already right.
 */
export const THEMES = [
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'The original dark blue-grey',
    swatch: 'oklch(0.2 0.014 265)',
  },
  {
    id: 'tactical',
    label: 'Tactical',
    description: 'Command centre: olive, khaki and digital camouflage',
    swatch: 'oklch(0.36 0.06 135)',
  },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'midnight';

const STORAGE_KEY = 'bt.theme';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

function readStored(): ThemeId {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isThemeId(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

let current: ThemeId = readStored();
const listeners = new Set<() => void>();

/**
 * Puts a theme on the page. Separate from choosing one: the signed-out
 * screens always wear the default, whatever the last person chose, so what is
 * painted and what is chosen are not always the same thing.
 */
export function paintTheme(theme: ThemeId): void {
  // The default carries no attribute at all, so the base tokens stay the
  // single definition of it rather than a copy that could drift.
  if (theme === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/**
 * The first paint, before React runs. With a session to restore the person is
 * about to land in the app, so their last theme avoids a flash of the default;
 * without one they are about to see the sign-in screen, which is always default.
 */
export function paintInitialTheme(sessionLikely: boolean): void {
  paintTheme(sessionLikely ? current : DEFAULT_THEME);
}

/** Records the choice; App paints it while someone is signed in. */
export function setTheme(theme: ThemeId): void {
  if (theme === current) return;
  current = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not mirrored; the account still has it.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => current);
}
