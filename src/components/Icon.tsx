import manifest from '../data/icon-manifest.json';
import { data } from '../lib/data';
import { FormMark } from './FormMark';

const available = new Set(Object.keys(manifest));
const base = import.meta.env.BASE_URL;

/** Game icon for an item or building, extracted from the game's archives. Falls back to a form swatch. */
export function Icon({ id, size = 24, className }: { id: string; size?: number; className?: string }) {
  if (!available.has(id)) {
    const item = data.items[id];
    return item ? <FormMark item={item} /> : null;
  }
  return (
    <img
      className={`icon ${className ?? ''}`}
      src={`${base}icons/${id}.webp`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      loading="lazy"
    />
  );
}
