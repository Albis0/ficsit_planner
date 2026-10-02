import { arrange } from '../graph';
import { cardSize } from './layout';
import { isPart, type Model } from './types';

/**
 * Lays a whole model out afresh, left to right like the Auto floor: every card in a column by how far down the line
 * it is, splitters and mergers in columns of their own, miners beside what they feed, and every belt routed around
 * the cards with room kept for its label. Notes and boxes stay where they are.
 */
export function arrangeModel(m: Model): Model {
  const parts = m.nodes.filter(isPart);
  const ids = new Set(parts.map((n) => n.id));
  const links = m.links.filter((l) => ids.has(l.a) && ids.has(l.b));
  if (parts.length === 0) return m;
  const { pos, routes } = arrange(
    parts.map((n) => ({ id: n.id, width: cardSize(n).w, height: cardSize(n).h })),
    links.map((l) => ({ id: l.id, source: l.a, target: l.b })),
    'LR',
  );
  return {
    ...m,
    nodes: m.nodes.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n;
    }),
    links: m.links.map((l) => {
      const { pts: _, ...rest } = l;
      const points = routes.get(l.id)?.points ?? [];
      return points.length ? { ...rest, pts: points.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]) } : rest;
    }),
  };
}
