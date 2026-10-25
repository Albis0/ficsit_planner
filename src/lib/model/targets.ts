import type { Target } from '../solver';
import { cardSize, dirOf, freeSpot } from './layout';
import { type IoNode, isPart, type Model } from './types';

/*
  A Manual factory's targets are its floor's output cards: each product is an output card, and its amount is the most
  that card takes. What the floor is built from (recipes, machines, belts) is the floor's own.
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
