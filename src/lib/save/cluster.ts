import type { SaveBuilding, SaveLink } from './types';

/** Belts, lifts, pipes and what sits in their run; they join buildings, they are not buildings of a factory. */
const LINE = new Set<SaveBuilding['kind']>(['belt', 'lift', 'pipe', 'pass', 'pump']);
/** A run of belts or pipes longer than this, metres, is a line between two factories and does not join them. */
export const LONG_LINE = 150;
/** Factories whose buildings come closer than this, cm, are one factory. */
export const NEAR = 6000;

function unionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  return { find, join };
}

/**
 * Splits a save's buildings into factories: buildings joined by a short belt or pipe run, or standing next to each
 * other, are one factory. Returns the buildings of each, belts and pipes left out.
 */
export function clusters(buildings: readonly SaveBuilding[], links: readonly SaveLink[]): SaveBuilding[][] {
  const index = new Map(buildings.map((b, i) => [b.id, i]));
  const isLine = (i: number) => LINE.has(buildings[i].kind);
  const uf = unionFind(buildings.length);
  const pairs: [number, number][] = [];
  for (const l of links) {
    const a = index.get(l.a);
    const b = index.get(l.b);
    if (a !== undefined && b !== undefined && a !== b) pairs.push([a, b]);
  }
  // Each run of line pieces, its length, and the buildings at its ends.
  const runs = unionFind(buildings.length);
  for (const [a, b] of pairs) if (isLine(a) && isLine(b)) runs.join(a, b);
  const length = new Map<number, number>();
  buildings.forEach((b, i) => {
    if (isLine(i)) length.set(runs.find(i), (length.get(runs.find(i)) ?? 0) + (b.length ?? 0));
  });
  const ends = new Map<number, number[]>();
  for (const [a, b] of pairs) {
    if (isLine(a) === isLine(b)) {
      if (!isLine(a)) uf.join(a, b);
      continue;
    }
    const [line, end] = isLine(a) ? [a, b] : [b, a];
    const run = runs.find(line);
    const has = ends.get(run);
    if (has) has.push(end);
    else ends.set(run, [end]);
  }
  for (const [run, list] of ends) if ((length.get(run) ?? 0) <= LONG_LINE) for (const e of list) uf.join(list[0], e);

  const groups = new Map<number, number[]>();
  buildings.forEach((_, i) => {
    if (isLine(i)) return;
    const r = uf.find(i);
    const has = groups.get(r);
    if (has) has.push(i);
    else groups.set(r, [i]);
  });
  // Groups that come close merge: boxes sorted by their left edge, each checked against the ones starting before its right edge ends.
  const list = [...groups.values()].map((g) => {
    const box = { g, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const i of g) {
      const { x, y } = buildings[i];
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
    }
    return box;
  });
  list.sort((a, b) => a.x0 - b.x0);
  const near = unionFind(list.length);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length && list[j].x0 <= list[i].x1 + NEAR; j++)
      if (list[j].y0 <= list[i].y1 + NEAR && list[i].y0 <= list[j].y1 + NEAR) near.join(i, j);
  const merged = new Map<number, SaveBuilding[]>();
  list.forEach((c, i) => {
    const r = near.find(i);
    const has = merged.get(r) ?? [];
    for (const k of c.g) has.push(buildings[k]);
    merged.set(r, has);
  });
  return [...merged.values()];
}
