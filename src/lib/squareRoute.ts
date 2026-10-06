import type { Direction, Point } from './graph';

/** One belt on the floor: the machines at its ends, the handles it leaves and reaches, and the bends dagre routed it by. */
export interface SquareBelt {
  id: string;
  source: string;
  target: string;
  from: Point;
  to: Point;
  via: Point[];
}

/** Room between two belts' upright runs that share a gap between columns, in floor units. */
const LANE = 14;
/** How close an upright run may come to a column of cards. */
const EDGE = 10;

interface Run {
  belt: SquareBelt;
  /** Where along the flow it stands, and the stretch across it covers. */
  u: number;
  lo: number;
  hi: number;
  /** The gap between columns it has to stay in. */
  min: number;
  max: number;
}

/**
 * The bends that turn dagre's routes into square belts: along the flow at the height of each column's dummy point, and
 * upright between the columns. Belts of different lines that would run upright over each other in one gap get a lane
 * each; belts leaving one machine or reaching one share theirs, like belts off a splitter. Returned as bends between
 * the two handles, in floor coordinates.
 */
export function squareBends(belts: SquareBelt[], dir: Direction): Map<string, Point[]> {
  // Worked out as (u along the flow, v across it), then turned back.
  const uv = (p: Point): [number, number] => (dir === 'LR' ? [p.x, p.y] : [p.y, p.x]);
  const xy = (u: number, v: number): Point => (dir === 'LR' ? { x: u, y: v } : { x: v, y: u });
  const runs: Run[] = [];
  const stops = new Map<string, [number, number][]>();
  for (const belt of belts) {
    const pts = [belt.from, ...belt.via, belt.to].map(uv);
    stops.set(belt.id, pts);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      if (Math.abs(a[1] - b[1]) < 1) continue;
      const room = Math.abs(b[0] - a[0]);
      const [min, max] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      runs.push({
        belt,
        u: (a[0] + b[0]) / 2,
        lo: Math.min(a[1], b[1]),
        hi: Math.max(a[1], b[1]),
        // A narrow gap keeps its run in the middle.
        min: room > 2 * EDGE + LANE ? min + EDGE : (a[0] + b[0]) / 2,
        max: room > 2 * EDGE + LANE ? max - EDGE : (a[0] + b[0]) / 2,
      });
    }
  }
  // Lanes in a gap, belts of different lines only; the ones nearest the middle are given out first.
  const clash = (a: Run, b: Run) =>
    a.belt.source !== b.belt.source &&
    a.belt.target !== b.belt.target &&
    Math.abs(a.u - b.u) < LANE - 0.5 &&
    Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 2;
  const placed: Run[] = [];
  const ordered = [...runs].sort((a, b) => a.u - b.u || a.lo - b.lo || a.belt.id.localeCompare(b.belt.id));
  for (const run of ordered) {
    const middle = run.u;
    for (let k = 0; k < 12; k++) {
      const at = middle + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * LANE * (k === 0 ? 0 : 1);
      const u = Math.min(run.max, Math.max(run.min, at));
      run.u = u;
      if (!placed.some((p) => clash(p, run))) break;
    }
    placed.push(run);
  }
  // Every belt: its stops in order, with the upright run (now placed) between each two that are at different heights.
  const byBelt = new Map<string, Run[]>();
  for (const r of runs) byBelt.set(r.belt.id, [...(byBelt.get(r.belt.id) ?? []), r]);
  const out = new Map<string, Point[]>();
  for (const belt of belts) {
    const pts = stops.get(belt.id)!;
    const mine = [...(byBelt.get(belt.id) ?? [])];
    const bends: Point[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      if (Math.abs(a[1] - b[1]) < 1) continue;
      const run = mine.shift()!;
      bends.push(xy(run.u, a[1]), xy(run.u, b[1]));
    }
    out.set(belt.id, bends);
  }
  return out;
}
