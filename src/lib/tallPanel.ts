import { useEffect } from 'react';
import { useStore } from '../store';

/** Below this the floor counts as small: the machine panel would end short of the screen's height. */
const SMALL = 520;

/**
 * On a wide screen with a small floor, the machine panel on the floor grows up over the panel above it to the top bar,
 * so it is as tall as the screen allows instead of ending short; a taller floor, and a phone's sheet, are left alone.
 */
export function useTallPanel() {
  const inspect = useStore((s) => s.inspect);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pick is a new panel to fit
  useEffect(() => {
    const floor = document.querySelector<HTMLElement>('.floor-view');
    if (!floor) return;
    const fit = () => {
      const panel = floor.querySelector<HTMLElement>(':scope > .inspector');
      if (!panel) return;
      const f = floor.getBoundingClientRect();
      const bar = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 12;
      if (innerWidth <= 760 || f.height >= SMALL || bar >= f.top) {
        panel.style.top = '';
        panel.style.maxHeight = '';
        return;
      }
      // The panel is zoomed with the interface size, so its lengths are in that zoom.
      const zoom = Number.parseFloat(getComputedStyle(panel).zoom) || 1;
      panel.style.top = `${(bar - f.top) / zoom}px`;
      panel.style.maxHeight = `${(f.bottom - 18 - bar) / zoom}px`;
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(floor);
    // A panel that is picked after this ran is not there yet.
    const added = new MutationObserver(fit);
    added.observe(floor, { childList: true });
    return () => {
      watch.disconnect();
      added.disconnect();
    };
  }, [inspect]);
}
