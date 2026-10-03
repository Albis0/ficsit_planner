import { portsOf } from './ports';
import { isPart, type MNode } from './types';

/**
 * The floor's grid, the same as its drawn lines: cards snap to it, every card's sides lie on it and every end sits on
 * one of its lines, so a belt between two ends at the same height runs straight along a line.
 */
export const GRID = 40;
export const snap = (v: number) => Math.round(v / GRID) * GRID;
/** Belts turn on the grid's lines or halfway between them, so two running side by side stay apart. */
export const HALF = GRID / 2;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which way a hand-built floor runs: left to right, every card taking in on its left and putting out on its right, or
 * top to bottom, in on its top and out at its bottom.
 */
export type Dir = 'LR' | 'TB';

/** The way a model runs. */
export const dirOf = (m: { dir?: 'TB' }): Dir => m.dir ?? 'LR';

/** Ends along a side, a grid square apart; a card with more of them is longer that way. */
const tall = (ends: number, least: number) => Math.max(least, GRID * (ends + 1));

/** Card sizes on the floor, in whole grid squares: how the cards are drawn, laid out and kept off each other. */
export function cardSize(n: MNode, dir: Dir = 'LR'): { w: number; h: number } {
  if (n.k === 'note' || n.k === 'group') return { w: n.w, h: n.h };
  const p = portsOf(n);
  const ends = Math.max(p.ins.length, p.outs.length);
  if (n.k === 'machine' || n.k === 'gen' || n.k === 'unknown')
    return dir === 'TB' ? { w: tall(ends, 320), h: 160 } : { w: 320, h: tall(ends, 160) };
  if (n.k === 'extract' || n.k === 'in' || n.k === 'out') return { w: 360, h: 80 };
  // Splitters and the like lie across the floor's way.
  return dir === 'TB' ? { w: tall(ends, 160), h: 80 } : { w: 80, h: tall(ends, 160) };
}

/**
 * Where an end sits along its card's side, from the side's start: on a grid line, the ends a square apart and
 * centred, two ends two squares apart so each is clear of the middle.
 */
export function portY(h: number, i: number, of: number): number {
  const step = of === 2 && h >= GRID * 4 ? GRID * 2 : GRID;
  return snap(h / 2 - ((of - 1) * step) / 2) + i * step;
}

/** Where end `i` of a card's inputs or outputs is, from its top left corner. */
export function endSpot(n: MNode, side: 'in' | 'out', i: number, dir: Dir = 'LR'): { x: number; y: number } {
  const { w, h } = cardSize(n, dir);
  const p = portsOf(n);
  const of = (side === 'in' ? p.ins : p.outs).length;
  return dir === 'TB' ? { x: portY(w, i, of), y: side === 'out' ? h : 0 } : { x: side === 'out' ? w : 0, y: portY(h, i, of) };
}

const GAP = 20;
const hits = (a: Box, b: Box) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * Where a new card can go near a spot: there on the grid, or nudged across the floor's way (down a floor running left
 * to right, right on one running down) until it lies on no other card.
 */
export function freeSpot(nodes: MNode[], box: Box, dir: Dir = 'LR'): { x: number; y: number } {
  const taken = nodes.filter(isPart).map((n) => ({ x: n.x, y: n.y, ...cardSize(n, dir) }));
  const b = { ...box, x: snap(box.x), y: snap(box.y) };
  while (taken.some((t) => hits(b, t))) {
    if (dir === 'TB') b.x += GRID;
    else b.y += GRID;
  }
  return { x: b.x, y: b.y };
}
