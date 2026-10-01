import { flushSync } from 'react-dom';
import { motionReduced } from '../components/ModeSwitch';

type Prop = 'height' | 'gridTemplateRows' | 'gridTemplateColumns';

/**
 * Folds or unfolds something smoothly: reads the sizes before the change, applies it at once, reads them after, and
 * plays the difference back over a moment. Track lists in px interpolate, so a grid row or column glides too.
 * Reduced motion just applies the change.
 */
export function fold(el: HTMLElement | null | undefined, props: readonly Prop[], change: () => void, duration = 320) {
  if (!el || motionReduced() || typeof el.animate !== 'function') return change();
  const read = () => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, cs[p]])) as Keyframe;
  };
  const before = read();
  flushSync(change);
  const after = read();
  if (props.every((p) => before[p] === after[p])) return;
  el.animate(
    [
      { ...before, overflow: 'hidden' },
      { ...after, overflow: 'hidden' },
    ],
    {
      duration,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  );
}
