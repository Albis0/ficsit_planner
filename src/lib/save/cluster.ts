import type { SaveBuilding, SaveLink } from './types';

/** Belts, lifts, pipes and what sits in their run; they join buildings, they are not buildings of a factory. */
const LINE = new Set<SaveBuilding['kind']>(['belt', 'lift', 'pipe', 'pass', 'pump']);
/** Splitters, mergers and pipe junctions: part of a run when its length is counted, so a merger half way along a long line does not cut it in two short ones. */
const ATTACHMENT = new Set<SaveBuilding['kind']>(['splitter', 'merger', 'smart', 'prog', 'prio', 'junction']);
/** A run of belts or pipes longer than this, metres, is a line between two factories and does not join them. */
export const LONG_LINE = 150;
/** Buildings closer to each other than this, cm, are one factory. */
export const NEAR = 4000;

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
 * Splits a save's buildings into factories: buildings joined by a short run of belts or pipes, or standing near each
 * other, are one factory. Returns the buildings of each, belts and pipes left out.
 */
export function clusters(buildings: readonly SaveBuilding[], links: readonly SaveLink[]): SaveBuilding[][] {
  const index = new Map(buildings.map((b, i) => [b.id, i]));
  const isLine = (i: number) => LINE.has(buildings[i].kind);
  const inRun = (i: number) => isLine(i) || ATTACHMENT.has(buildings[i].kind);
  const uf = unionFind(buildings.length);
  const pairs: [number, number][] = [];
  for (const l of links) {
    const a = index.get(l.a);
    const b = index.get(l.b);
    if (a !== undefined && b !== undefined && a !== b) pairs.push([a, b]);
  }
  // Each run of line pieces and the splitters and mergers on it, its belt length, and the buildings at its ends.
  const runs = unionFind(buildings.length);
  for (const [a, b] of pairs) if (inRun(a) && inRun(b)) runs.join(a, b);
  const length = new Map<number, number>();
  buildings.forEach((b, i) => {
    if (isLine(i)) length.set(runs.find(i), (length.get(runs.find(i)) ?? 0) + (b.length ?? 0));
  });
  const ends = new Map<number, number[]>();
  const add = (run: number, i: number) => {
    const has = ends.get(run);
    if (has) has.push(i);
    else ends.set(run, [i]);
  };
  for (const [a, b] of pairs) {
    if (inRun(a) === inRun(b)) {
      if (!inRun(a)) uf.join(a, b);
      continue;
    }
    const [line, end] = inRun(a) ? [a, b] : [b, a];
    add(runs.find(line), end);
  }
  buildings.forEach((b, i) => {
    if (ATTACHMENT.has(b.kind)) add(runs.find(i), i);
  });
  for (const [run, list] of ends) if ((length.get(run) ?? 0) <= LONG_LINE) for (const e of list) uf.join(list[0], e);

  // Buildings that stand near each other: each checked against those in its own and the next squares of a grid.
  const grid = new Map<string, number[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / NEAR)},${Math.floor(y / NEAR)}`;
  buildings.forEach((b, i) => {
    if (isLine(i)) return;
    const k = cell(b.x, b.y);
    const has = grid.get(k);
    if (has) has.push(i);
    else grid.set(k, [i]);
  });
  buildings.forEach((b, i) => {
    if (isLine(i)) return;
    const cx = Math.floor(b.x / NEAR);
    const cy = Math.floor(b.y / NEAR);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? [])
          if (j > i && Math.hypot(buildings[j].x - b.x, buildings[j].y - b.y) <= NEAR) uf.join(i, j);
  });

  const groups = new Map<number, SaveBuilding[]>();
  buildings.forEach((b, i) => {
    if (isLine(i)) return;
    const r = uf.find(i);
    const has = groups.get(r);
    if (has) has.push(b);
    else groups.set(r, [b]);
  });
  return [...groups.values()];
}
