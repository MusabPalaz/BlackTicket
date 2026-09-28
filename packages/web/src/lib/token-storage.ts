/**
 * Where the two tokens live in the browser.
 *
 * The access token stays in memory only: it never touches storage, so a reload
 * discards it and XSS cannot read it out of localStorage.
 *
 * The refresh token needs to survive a page reload, and it is kept in
 * sessionStorage rather than localStorage — it dies with the tab, so a shared
 * SOC workstation does not hand the next person a live session. The trade-off
 * is explicit: XSS could still read it, which is why the API rotates refresh
 * tokens and revokes the whole family when a used one is replayed.
 */
const REFRESH_KEY = 'bt.refresh';

let accessToken: string | null = null;

export const tokenStorage = {
  getAccess(): string | null {
    return accessToken;
  },

  setAccess(token: string | null): void {
    accessToken = token;
  },

  getRefresh(): string | null {
    try {
      return sessionStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },

  setRefresh(token: string | null): void {
    try {
      if (token) sessionStorage.setItem(REFRESH_KEY, token);
      else sessionStorage.removeItem(REFRESH_KEY);
    } catch {
      // Private-mode browsers can refuse storage; the session then simply
      // ends at the next reload instead of breaking the app.
    }
  },

  clear(): void {
    accessToken = null;
    this.setRefresh(null);
  },
};

/** Broadcast when the session is definitively gone, so the UI can react once. */
export const UNAUTHENTICATED_EVENT = 'bt:unauthenticated';

export function notifyUnauthenticated(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
}
