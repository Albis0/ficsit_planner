import { useStore } from '../store';

/**
 * Brings a part of the side panel into view from somewhere else on screen: opens the panel on that tab (on
 * phones, switches to it), scrolls the part in, flashes it, and optionally presses the button inside it.
 */
export function showInPanel(tab: 'targets' | 'recipes' | 'resources', selector: string, press?: string) {
  useStore.getState().set({ tab, deckClosed: false, pane: 'side' });
  // Two frames: one for the panel to render, one for its layout to settle.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      if (press) el.querySelector<HTMLElement>(press)?.click();
      else el.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
    }),
  );
}
