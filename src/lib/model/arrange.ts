import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Engine } from '../layout';
import { layoutInBackground } from '../layoutClient';
import { cardSize, GRID, HALF, portY } from './layout';
import { portsOf } from './ports';
import { isPart, type MLink, type Model } from './types';

/** Room kept on each belt for its label, so no label sits on a card or on another belt. */
const LABEL = { w: 160, h: 40 };

export { portY };

/**
 * Ways of laying a floor out that are all tried; the one with the fewest crossing belts, bends and the least belt is
 * kept. Each does better on some factories: which way cards in a column lean to keep belts straight, and how close
 * the columns are drawn afterwards. Picked by trying many on a spread of factories.
 */
const COMPACT = { 'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH' };
const DEPTH = { 'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST' };
const lean = (to: string) => ({ 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.nodePlacement.bk.fixedAlignment': to });
const VARIANTS: Record<string, string>[] = [
  { ...lean('NONE'), ...COMPACT },
  { ...lean('NONE'), ...COMPACT, ...DEPTH },
  { ...lean('RIGHTUP'), ...COMPACT },
  { ...lean('RIGHTUP'), ...COMPACT, ...DEPTH },
];

const ON_BELT = { 'elk.edgeLabels.placement': 'CENTER', 'elk.edgeLabels.inline': 'true' };

const BASE: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.thoroughness': '60',
  // Gaps in grid squares and half squares, so the floor snaps onto the grid without two belts landing on one line.
  'elk.spacing.nodeNode': String(GRID),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(GRID),
  'elk.spacing.edgeNode': String(GRID),
  'elk.layered.spacing.edgeNodeBetweenLayers': String(GRID),
  'elk.spacing.edgeEdge': String(HALF),
  'elk.layered.spacing.edgeEdgeBetweenLayers': String(HALF),
  'elk.spacing.componentComponent': String(GRID * 2),
  'elk.layered.cycleBreaking.strategy': 'GREEDY',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.unnecessaryBendpoints': 'false',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
};

/**
 * Where the tries are laid out: the Auto floor's pool of workers, so they run side by side and the page doesn't stall
 * on a big factory, or ELK on this thread when workers won't start here.
 */
let engine: Engine = layoutInBackground;

/** Runs layouts on another engine: the tests use one with workers of their own. */
export const setLayoutEngine = (e: Engine) => {
  engine = e;
};

interface Laid {
  pos: Map<string, { x: number; y: number }>;
  routes: Map<string, { pts: [number, number][]; lbl?: [number, number] }>;
  score: number;
}

/** Straight stretches of a belt, from its first end to its last. */
const runs = (pts: { x: number; y: number }[]) => pts.slice(1).map((p, i) => [pts[i], p] as const);

/** Belts that cross each other, bends and length together: lower reads better. */
function measure(lines: { x: number; y: number }[][]): { cross: number; bends: number; length: number } {
  let cross = 0;
  let bends = 0;
  let length = 0;
  const all = lines.map((l) => runs(l));
  for (const r of all) {
    bends += Math.max(0, r.length - 1);
    for (const [a, b] of r) length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      for (const [a, b] of all[i])
        for (const [c, d] of all[j]) {
          // One across and one along, each strictly inside the other's span.
          const [h, v] =
            a.y === b.y && c.x === d.x
              ? [
                  [a, b],
                  [c, d],
                ]
              : a.x === b.x && c.y === d.y
                ? [
                    [c, d],
                    [a, b],
                  ]
                : [];
          if (!h || !v) continue;
          const [hx0, hx1] = [Math.min(h[0].x, h[1].x), Math.max(h[0].x, h[1].x)];
          const [vy0, vy1] = [Math.min(v[0].y, v[1].y), Math.max(v[0].y, v[1].y)];
          if (v[0].x > hx0 && v[0].x < hx1 && h[0].y > vy0 && h[0].y < vy1) cross++;
        }
  return { cross, bends, length };
}

function score(lines: { x: number; y: number }[][]): number {
  const { cross, bends, length } = measure(lines);
  return cross * 4 + bends + length / 400;
}

async function place(m: Model, variant: Record<string, string>): Promise<Laid & { lines: { x: number; y: number }[][] }> {
  const parts = m.nodes.filter(isPart);
  const ids = new Set(parts.map((n) => n.id));
  const links = m.links.filter((l) => ids.has(l.a) && ids.has(l.b));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: { ...BASE, ...variant },
    children: parts.map((n) => {
      const { w, h } = cardSize(n);
      const p = portsOf(n);
      return {
        id: n.id,
        width: w,
        height: h,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: [
          ...p.ins.map((_, i) => ({
            id: `${n.id}:i${i}`,
            x: 0,
            y: portY(h, i, p.ins.length),
            width: 0,
            height: 0,
            layoutOptions: { 'elk.port.side': 'WEST' },
          })),
          ...p.outs.map((_, i) => ({
            id: `${n.id}:o${i}`,
            x: w,
            y: portY(h, i, p.outs.length),
            width: 0,
            height: 0,
            layoutOptions: { 'elk.port.side': 'EAST' },
          })),
        ],
      };
    }),
    edges: links.map(
      (l): ElkExtendedEdge => ({
        id: l.id,
        sources: [`${l.a}:o${l.ap}`],
        targets: [`${l.b}:i${l.bp}`],
        // Placed on the belt itself; the engine skips a label with no text.
        labels: [{ id: `${l.id}:label`, text: '-', width: LABEL.w, height: LABEL.h, layoutOptions: ON_BELT }],
      }),
    ),
  };
  const out = await engine(graph);
  // Onto the grid: cards on its lines, so their ends are too; bends on a line or halfway, which keeps belts that ran
  // side by side apart. The first and last stretch of a belt stay level with the ends they leave and reach.
  const on = (v: number, step: number) => Math.round(v / step) * step;
  const pos = new Map((out.children ?? []).map((c) => [c.id, { x: on(c.x ?? 0, GRID), y: on(c.y ?? 0, GRID) }]));
  const byId = new Map(parts.map((n) => [n.id, n]));
  const endAt = (id: string, side: 'in' | 'out', i: number) => {
    const n = byId.get(id);
    const p = pos.get(id);
    if (!n || !p) return undefined;
    const { w, h } = cardSize(n);
    const ports = portsOf(n);
    return { x: p.x + (side === 'out' ? w : 0), y: p.y + portY(h, i, side === 'out' ? ports.outs.length : ports.ins.length) };
  };
  const routes: Laid['routes'] = new Map();
  const lines: { x: number; y: number }[][] = [];
  const linkOf = new Map(links.map((l) => [l.id, l]));
  for (const e of (out.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0];
    const l = linkOf.get(e.id);
    if (!s || !l) continue;
    const from = endAt(l.a, 'out', l.ap);
    const to = endAt(l.b, 'in', l.bp);
    if (!from || !to) continue;
    const bends = (s.bendPoints ?? []).map((p) => ({ x: on(p.x, HALF), y: on(p.y, HALF) }));
    if (bends.length) {
      bends[0].y = from.y;
      bends[bends.length - 1].y = to.y;
    }
    lines.push([from, ...bends, to]);
    const label = e.labels?.[0];
    routes.set(e.id, {
      pts: bends.map((p) => [p.x, p.y]),
      lbl:
        label?.x !== undefined && label.y !== undefined
          ? [on(label.x + (label.width ?? 0) / 2, HALF), on(label.y + (label.height ?? 0) / 2, HALF)]
          : undefined,
    });
  }
  return { pos, routes, score: score(lines), lines };
}

/** Where each card goes and each belt's bends and label: what laying a model out gives, before it's put on the model. */
export type Arrangement = Pick<Laid, 'pos' | 'routes'>;

/**
 * Lays a whole model out afresh, left to right: every card in a column by how far down the line it is, the cards in
 * each column ordered so belts meet their ends in order without crossing, and every belt run in straight stretches
 * with square turns and a spot of its own for its label. Notes and boxes aren't placed.
 */
export async function arrangement(m: Model): Promise<Arrangement> {
  if (!m.nodes.some(isPart)) return { pos: new Map(), routes: new Map() };
  const tries = await Promise.all(VARIANTS.map((v) => place(m, v)));
  const best = tries.reduce((a, b) => (b.score < a.score ? b : a));
  return { pos: best.pos, routes: best.routes };
}

/**
 * Puts an arrangement on a model: the cards it placed move there and their belts take its bends and label spots.
 * Cards and belts it doesn't know (added while it was being worked out) stay as they are, but a belt between cards
 * that moved loses its old bends, which would lead nowhere now.
 */
export function applyArrangement(m: Model, a: Arrangement): Model {
  if (a.pos.size === 0) return m;
  return {
    ...m,
    nodes: m.nodes.map((n) => {
      const p = a.pos.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    links: m.links.map((l): MLink => {
      const r = a.routes.get(l.id);
      if (!r && !a.pos.has(l.a) && !a.pos.has(l.b)) return l;
      const { pts: _, lbl: __, ...rest } = l;
      if (!r) return rest;
      return { ...rest, ...(r.pts.length ? { pts: r.pts } : {}), ...(r.lbl ? { lbl: r.lbl } : {}) };
    }),
  };
}

/** The model laid out afresh: `arrangement` put on it. Notes and boxes stay where they are. */
export async function arrangeModel(m: Model): Promise<Model> {
  return applyArrangement(m, await arrangement(m));
}
