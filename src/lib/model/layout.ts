import { portsOf } from './ports';
import { isPart, type MNode } from './types';

/** The floor's grid: cards snap to it. */
export const GRID = 20;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rough card sizes on the floor, for placing cards before they're drawn and keeping them off each other. */
export function cardSize(n: MNode): { w: number; h: number } {
  if (n.k === 'machine' || n.k === 'gen') {
    const p = portsOf(n);
    return { w: 310, h: 130 + Math.max(0, Math.max(p.ins.length, p.outs.length) - 3) * 20 };
  }
  if (n.k === 'extract' || n.k === 'in' || n.k === 'out') return { w: 330, h: 100 };
  if (n.k === 'note' || n.k === 'group') return { w: n.w, h: n.h };
  return { w: 96, h: 96 };
}

const GAP = 20;
const hits = (a: Box, b: Box) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/** Where a new card can go near a spot: there, or nudged down until it lies on no other card. */
export function freeSpot(nodes: MNode[], box: Box): { x: number; y: number } {
  const taken = nodes.filter(isPart).map((n) => ({ x: n.x, y: n.y, ...cardSize(n) }));
  const b = { ...box, x: snap(box.x), y: snap(box.y) };
  while (taken.some((t) => hits(b, t))) b.y += GRID;
  return { x: b.x, y: b.y };
}
