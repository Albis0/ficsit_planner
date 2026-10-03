import type { Target } from '../solver';
import { cardSize, dirOf, freeSpot } from './layout';
import { addNode } from './ops';
import { type IoNode, isPart, type Model } from './types';

/*
  A factory's targets and its hand-built floor are one list: each product is an output card on the floor, and its
  amount is the most that card takes. Changing a product on either side changes it on the other; what the floor is
  built from (recipes, machines, belts) stays the floor's own.
*/

const products = (m: Model, item?: string) =>
  m.nodes.filter((n): n is IoNode => n.k === 'out' && n.tag !== 'spare' && !!n.item && (item === undefined || n.item === item));

/** A new card past the floor's end (its start, for an input), where it lies on nothing: off to the right, or below. */
export function ioSpot(model: Model, kind: 'in' | 'out'): { x: number; y: number } {
  const parts = model.nodes.filter(isPart);
  if (!parts.length) return { x: 0, y: 0 };
  const dir = dirOf(model);
  const size = cardSize({ id: '', k: kind, x: 0, y: 0 }, dir);
  const box = parts.map((n) => ({ ...n, ...cardSize(n, dir) }));
  if (dir === 'TB') {
    const left = Math.min(...box.map((n) => n.x));
    const y = kind === 'out' ? Math.max(...box.map((n) => n.y + n.h)) + 120 : Math.min(...box.map((n) => n.y)) - size.h - 120;
    return freeSpot(model.nodes, { x: left, y, ...size }, dir);
  }
  const top = Math.min(...box.map((n) => n.y));
  const x = kind === 'out' ? Math.max(...box.map((n) => n.x + n.w)) + 120 : Math.min(...box.map((n) => n.x)) - size.w - 120;
  return freeSpot(model.nodes, { x, y: top, ...size }, dir);
}

/**
 * The targets a floor stands for: each product's output cards' limits added up. A product whose cards have no limit
 * keeps the amount it had (a floor converted before limits were kept); one with no card left is gone.
 */
export function floorTargets(m: Model, was: Target[]): Target[] {
  const out: Target[] = [];
  for (const n of products(m)) {
    if (out.some((t) => t.item === n.item)) continue;
    const cards = products(m, n.item);
    const set = cards.filter((c) => c.lim !== undefined);
    const rate = set.length ? set.reduce((s, c) => s + (c.lim ?? 0), 0) : was.find((t) => t.item === n.item)?.rate;
    if (rate !== undefined) out.push({ item: n.item!, rate: Math.round(rate * 1e6) / 1e6 });
  }
  // In the order the factory lists them, new ones at the end.
  const at = (item: string) => {
    const i = was.findIndex((t) => t.item === item);
    return i < 0 ? was.length : i;
  };
  return out.sort((a, b) => at(a.item) - at(b.item));
}

export const sameTargets = (a: Target[], b: Target[]) =>
  a.length === b.length && a.every((t, i) => t.item === b[i].item && Math.abs(t.rate - b[i].rate) < 1e-6);

/**
 * The floor's output cards set to the factory's targets: a product on two cards shares its new amount as they did
 * (evenly when they had none); a new product gets a card of its own, ready for a belt; a product no longer wanted
 * takes its cards off. Returns the same model when nothing changes.
 */
export function withTargets(m: Model, targets: Target[]): Model {
  let next = m;
  for (const t of targets) {
    const cards = products(next, t.item);
    if (!cards.length) {
      next = addNode(next, { k: 'out', item: t.item, lim: t.rate, ...ioSpot(next, 'out') }).model;
      continue;
    }
    const had = cards.reduce((s, c) => s + (c.lim ?? 0), 0);
    const share = (c: IoNode) => (had > 1e-9 && cards.every((x) => x.lim !== undefined) ? (c.lim ?? 0) / had : 1 / cards.length);
    const lims = new Map(cards.map((c) => [c.id, Math.round(t.rate * share(c) * 1e6) / 1e6]));
    if (cards.every((c) => c.lim !== undefined && Math.abs(c.lim - lims.get(c.id)!) < 1e-6)) continue;
    next = { ...next, nodes: next.nodes.map((n) => (lims.has(n.id) ? { ...n, lim: lims.get(n.id) } : n)) };
  }
  const wanted = new Set(targets.map((t) => t.item));
  const gone = new Set(
    products(next)
      .filter((n) => !wanted.has(n.item!))
      .map((n) => n.id),
  );
  if (gone.size)
    next = { ...next, nodes: next.nodes.filter((n) => !gone.has(n.id)), links: next.links.filter((l) => !gone.has(l.a) && !gone.has(l.b)) };
  return next;
}
