import { useSyncExternalStore } from 'react';

/** Phones and portrait tablets: one pane at a time with a bottom navigation bar. Matches the CSS breakpoint. */
export const PHONE = '(max-width: 900px)';
/** Touch screens: no hover, fingers instead of a mouse. */
export const COARSE = '(pointer: coarse)';

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
