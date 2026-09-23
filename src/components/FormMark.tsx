import type { Item } from '../lib/data';

/** Small swatch telling solids (belt) from fluids (pipe, in the game's own fluid colour). */
export function FormMark({ item }: { item: Item }) {
  if (item.form === 'solid') return <span className="form-mark solid" aria-hidden />;
  return <span className="form-mark fluid" style={{ background: item.color ?? 'var(--fluid)' }} aria-hidden />;
}
