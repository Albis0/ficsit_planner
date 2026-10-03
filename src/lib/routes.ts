import type { Route } from './graph';

/** A spot on the floor, in floor pixels. */
export interface Point {
  x: number;
  y: number;
}

/** How belts run between machines: right angles, curves, or straight lines. */
export type EdgeRouting = 'ORTHOGONAL' | 'SPLINES' | 'POLYLINE';

/** Corner radius on right-angle belts. */
const CORNER = 12;

const xy = (p: Point) => `${p.x},${p.y}`;

/** Straight runs, with each bend rounded off by up to `radius` (never more than half either run). */
function rounded(points: Point[], radius: number): string {
  let d = `M${xy(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, p, b] = [points[i - 1], points[i], points[i + 1]];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(radius, la / 2, lb / 2);
    if (r < 0.5) {
      d += ` L${xy(p)}`;
      continue;
    }
    const p1 = { x: p.x + ((a.x - p.x) * r) / la, y: p.y + ((a.y - p.y) * r) / la };
    const p2 = { x: p.x + ((b.x - p.x) * r) / lb, y: p.y + ((b.y - p.y) * r) / lb };
    d += ` L${xy(p1)} Q${xy(p)} ${xy(p2)}`;
  }
  return `${d} L${xy(points.at(-1)!)}`;
}

/**
 * The SVG path of a belt along its route, start and end included. For curves, ELK's points after the start
 * are the control points of a chain of cubic Béziers, in (control, control, end) threes.
 */
export function routeSvgPath(points: Point[], routing: EdgeRouting): string {
  if (routing === 'SPLINES' && points.length > 1 && (points.length - 1) % 3 === 0) {
    let d = `M${xy(points[0])}`;
    for (let i = 1; i < points.length; i += 3) d += ` C${xy(points[i])} ${xy(points[i + 1])} ${xy(points[i + 2])}`;
    return d;
  }
  return rounded(points, routing === 'ORTHOGONAL' ? CORNER : 0);
}

const moved = (a: Point | undefined, b: Point) => !a || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5;

/** Where a belt ends, and the way it's heading as it gets there (a unit vector). */
export interface Arrival {
  at: Point;
  dir: Point;
}

/** How a path through these points arrives: along its last run that has any length. */
export function arrival(points: Point[]): Arrival {
  const at = points.at(-1)!;
  for (let i = points.length - 2; i >= 0; i--) {
    const len = Math.hypot(at.x - points[i].x, at.y - points[i].y);
    if (len > 0.5) return { at, dir: { x: (at.x - points[i].x) / len, y: (at.y - points[i].y) / len } };
  }
  return { at, dir: { x: 1, y: 0 } };
}

/** An arrowhead's corners: tip on the belt's end, base `length` back along it and `width` across. */
export function arrowHead({ at, dir }: Arrival, length: number, width: number): string {
  const bx = at.x - dir.x * length;
  const by = at.y - dir.y * length;
  const [nx, ny] = [(-dir.y * width) / 2, (dir.x * width) / 2];
  return `${xy(at)} ${xy({ x: bx + nx, y: by + ny })} ${xy({ x: bx - nx, y: by - ny })}`;
}

/**
 * The belt's path, label spot and arrival: the laid-out route while both machines are where the layout put them,
 * otherwise the fallback between their handles.
 */
export function edgePath(
  route: Route | undefined,
  from: Point | undefined,
  to: Point | undefined,
  fallback: () => [string, number, number, Arrival],
): [string, number, number, Arrival] {
  if (!route || moved(from, route.from) || moved(to, route.to)) return fallback();
  return [routeSvgPath(route.points, route.routing), route.label.x, route.label.y, arrival(route.points)];
}

/** A belt as laid out: the machines at its ends and the points it runs through. */
export interface RoutedEdge {
  source: string;
  target: string;
  points: Point[];
}

/** Do two segments cross somewhere other than their ends? */
function crosses(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(d) < 1e-9) return false;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;
  return ua > 1e-6 && ua < 1 - 1e-6 && ub > 1e-6 && ub < 1 - 1e-6;
}

/**
 * Places where two belts cross, each route taken as the lines through its points (for curves, the control
 * polygon). Belts sharing a machine at either end don't count against each other: they meet there anyway.
 */
export function countCrossings(routes: RoutedEdge[]): number {
  // Each route's bounding box: two belts whose boxes don't overlap can't cross, which rules out most pairs on a big floor.
  const boxes = routes.map(({ points }) => ({
    x0: Math.min(...points.map((p) => p.x)),
    x1: Math.max(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    y1: Math.max(...points.map((p) => p.y)),
  }));
  let n = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i];
      const b = routes[j];
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
      const [p, q] = [boxes[i], boxes[j]];
      if (p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0) continue;
      for (let s = 1; s < a.points.length; s++)
        for (let t = 1; t < b.points.length; t++) if (crosses(a.points[s - 1], a.points[s], b.points[t - 1], b.points[t])) n++;
    }
  }
  return n;
}
