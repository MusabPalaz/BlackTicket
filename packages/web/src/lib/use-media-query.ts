import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query from React.
 *
 * Tailwind covers the ordinary case — this is for the rare decision that is not
 * "how does it look" but "does it exist at all". `useSyncExternalStore` rather
 * than state-plus-effect: the match is read during render, so the first paint
 * is already correct instead of flipping once the effect runs.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onStoreChange);
      return () => media.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The system's reduced-motion preference.
 *
 * The stylesheet already neutralises CSS animations for these users, but a
 * looping <video> is not a CSS animation and `display: none` does not stop one
 * from downloading and decoding. It has to be left out of the tree in React.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
