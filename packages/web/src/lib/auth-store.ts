import { create } from 'zustand';
import { type Permission, type Role, can } from '@black-ticket/shared';
import { api, ApiError } from './api';
import { notifyUnauthenticated, tokenStorage } from './token-storage';

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  permissions: Permission[];
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

interface SsoExchangeResponse extends LoginResponse {
  /** In-app path the sign-in started from, when it began on a deep link. */
  returnTo: string | null;
}

interface AuthState {
  user: SessionUser | null;
  /** True until the initial "do we have a live session?" check finishes. */
  initializing: boolean;
  login: (username: string, password: string, totpCode?: string) => Promise<SessionUser>;
  /** Finishes federated sign-in by trading the one-time handoff code. */
  completeSso: (code: string) => Promise<{ user: SessionUser; returnTo: string | null }>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearSession: () => void;
  hasPermission: (permission: Permission) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initializing: true,

  async login(username, password, totpCode) {
    const result = await api.post<LoginResponse>(
      '/auth/login',
      { username, password, ...(totpCode ? { totpCode } : {}) },
      // A 401 here means bad credentials, not an expired session: retrying
      // through the refresh path would only hide the real error.
      { retryOnUnauthorized: false },
    );

    tokenStorage.setAccess(result.accessToken);
    tokenStorage.setRefresh(result.refreshToken);
    set({ user: result.user });
    return result.user;
  },

  async completeSso(code) {
    const result = await api.post<SsoExchangeResponse>(
      '/auth/sso/exchange',
      { code },
      // The code is single-use: a retry through the refresh path would burn it
      // and turn a readable error into a silent sign-out.
      { retryOnUnauthorized: false },
    );

    tokenStorage.setAccess(result.accessToken);
    tokenStorage.setRefresh(result.refreshToken);
    set({ user: result.user });
    return { user: result.user, returnTo: result.returnTo };
  },

  async logout() {
    const refreshToken = tokenStorage.getRefresh();
    try {
      await api.post('/auth/logout', refreshToken ? { refreshToken } : {});
    } catch {
      // Signing out must succeed locally even if the server is unreachable.
    }
    get().clearSession();
  },

  clearSession() {
    tokenStorage.clear();
    set({ user: null });
  },

  /** Rebuilds the session after a reload from the surviving refresh token. */
  async restore() {
    if (!tokenStorage.getRefresh()) {
      set({ user: null, initializing: false });
      return;
    }

    /*
     * A 401 means the session is genuinely over. Anything else means the server
     * did not answer — an API restart, most often — and the refresh token is
     * still good. Giving up on the first failure dropped people onto the sign-in
     * screen for a blip they never caused, so a handful of quick retries run
     * first; only then does the session fall away, and the token survives even
     * that, so the next reload picks it back up.
     */
    for (let attempt = 0; ; attempt += 1) {
      try {
        const user = await api.get<SessionUser>('/auth/me');
        set({ user, initializing: false });
        return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          tokenStorage.clear();
          notifyUnauthenticated();
          break;
        }
        if (attempt >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }

    set({ user: null, initializing: false });
  },

  async refreshUser() {
    const user = await api.get<SessionUser>('/auth/me');
    set({ user });
  },

  hasPermission(permission) {
    const role = get().user?.role;
    return role ? can(role, permission) : false;
  },
}));
