import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Per-account UI preferences. Stored whole on the server; every key is optional. */
export interface Preferences {
  dashboard?: { widgets?: { id: string; width: 'half' | 'full' }[] };
  /** The dashboard's period. Its own key: a patch replaces a key whole, and
   *  saving the layout would otherwise reset it. */
  dashboardRange?: string;
  theme?: string;
}

export interface PreferencesResponse {
  preferences: Preferences;
}

export const PREFERENCES_KEY = ['preferences'] as const;

export function usePreferences() {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: () => api.get<PreferencesResponse>('/me/preferences'),
  });
}

/**
 * Saves part of the preferences.
 *
 * The endpoint replaces the whole record, so a patch is merged into the latest
 * copy first — otherwise saving a dashboard layout would quietly reset the
 * theme, and choosing a theme would wipe the layout. The answer seeds the
 * cache directly, so the next screen reads what was just saved.
 */
export function useSavePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Preferences>) => {
      const cached = queryClient.getQueryData<PreferencesResponse>(PREFERENCES_KEY);
      const current: Preferences = cached
        ? cached.preferences
        : (await api.get<PreferencesResponse>('/me/preferences')).preferences;
      return api.put<PreferencesResponse>('/me/preferences', {
        preferences: { ...current, ...patch },
      });
    },
    onSuccess: (result) => queryClient.setQueryData(PREFERENCES_KEY, result),
  });
}
