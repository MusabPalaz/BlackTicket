import { notifyUnauthenticated, tokenStorage } from './token-storage';

/**
 * Exported because federated sign-in is a browser navigation, not a fetch:
 * the page hands the tab to the API, which redirects on to the provider.
 */
export const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  /** Present on server-side errors; also on domain errors carrying a code. */
  code?: string;
  errorId: string;
  path: string;
  timestamp: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Flattens validation errors into a single readable line. */
  get detail(): string {
    const message = this.body?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message ?? this.message;
  }

  /** Application-level code, e.g. TOTP_REQUIRED or PASSWORD_CHANGE_REQUIRED. */
  get code(): string | undefined {
    return this.body?.code;
  }
}

interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Single-flight refresh.
 *
 * Several queries can hit a 401 at the same moment when an access token
 * expires. Without this guard each one would rotate the refresh token
 * independently, and the second rotation would look exactly like a replay
 * attack to the server — logging the user out for being fast.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = tokenStorage.getRefresh();
  if (!refreshToken) return false;

  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;

      const pair = (await response.json()) as TokenPairResponse;
      tokenStorage.setAccess(pair.accessToken);
      tokenStorage.setRefresh(pair.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe the result.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const accessToken = tokenStorage.getAccess();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  return fetch(`${BASE_URL}${path}`, { ...init, headers });
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: { retryOnUnauthorized?: boolean } = {},
): Promise<T> {
  const { retryOnUnauthorized = true } = options;

  let response = await rawRequest(path, init);

  if (response.status === 401 && retryOnUnauthorized && tokenStorage.getRefresh()) {
    if (await refreshSession()) {
      response = await rawRequest(path, init);
    } else {
      tokenStorage.clear();
      notifyUnauthenticated();
    }
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const body = isJson ? (payload as ApiErrorBody) : null;
    throw new ApiError(response.status, body, `Request failed with status ${response.status}`);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, options?: { retryOnUnauthorized?: boolean }) =>
    apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, options),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
