import type { Item } from '../lib/data';
import { pipeColor } from '../lib/pipe';

/** Small swatch telling solids (belt) from fluids (pipe, in the game's own fluid colour). */
export function FormMark({ item }: { item: Item }) {
  if (item.form === 'solid') return <span className="form-mark solid" aria-hidden />;
  return <span className="form-mark fluid" style={{ background: pipeColor(item) ?? 'var(--fluid)' }} aria-hidden />;
}
