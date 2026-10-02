import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { cardSize } from './layout';
import { portsOf } from './ports';
import { isPart, type MLink, type Model } from './types';

/** Room kept on each belt for its label, so no label sits on a card or on another belt. */
const LABEL = { w: 150, h: 40 };

/** Where an end sits on its card: spread evenly down the side, as the card draws them. */
export const portY = (h: number, i: number, of: number) => (h * (i + 1)) / (of + 1);

/**
 * Ways of laying a floor out that are all tried; the one with the fewest crossing belts, bends and the least belt is
 * kept. Each does better on some factories: how cards line up in their columns, how a loop (a byproduct fed back) is
 * broken, and whether columns are counted from the miners or the products.
 */
const VARIANTS: Record<string, string>[] = [
  { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX' },
  { 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF' },
  { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST' },
  { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.layered.layering.strategy': 'LONGEST_PATH_SOURCE' },
];

/** Workers the tries are shared between, so they run side by side. */
const WORKERS = 2;

const ON_BELT = { 'elk.edgeLabels.placement': 'CENTER', 'elk.edgeLabels.inline': 'true' };

const BASE: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.thoroughness': '20',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '40',
  'elk.spacing.edgeNode': '24',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.spacing.edgeEdge': '16',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
  'elk.spacing.componentComponent': '80',
  'elk.layered.cycleBreaking.strategy': 'GREEDY',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.unnecessaryBendpoints': 'false',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
};

let engines: Promise<ELK[]> | undefined;
/**
 * The layout engine is big, so it's fetched the first time a floor is laid out, not with the app, and it runs in
 * workers of its own so the page doesn't stall on a big factory.
 */
const elk = () => {
  engines ??= Promise.all([import('elkjs/lib/elk-api.js'), import('elkjs/lib/elk-worker.min.js?url')]).then(([api, url]) =>
    Array.from({ length: WORKERS }, () => new api.default({ workerUrl: url.default })),
  );
  return engines;
};

/** Runs layouts on other engines: the tests use ones with workers of their own. */
export const setLayoutEngine = (list: ELK[]) => {
  engines = Promise.resolve(list);
};

interface Laid {
  pos: Map<string, { x: number; y: number }>;
  routes: Map<string, { pts: [number, number][]; lbl?: [number, number] }>;
  score: number;
}

/** Straight stretches of a belt, from its first end to its last. */
const runs = (pts: { x: number; y: number }[]) => pts.slice(1).map((p, i) => [pts[i], p] as const);

/** Belts that cross each other, bends and length together: lower reads better. */
function score(lines: { x: number; y: number }[][]): number {
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
  return cross * 4 + bends + length / 400;
}

async function place(m: Model, variant: Record<string, string>, engine: ELK): Promise<Laid> {
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
  const out = await engine.layout(graph);
  const pos = new Map((out.children ?? []).map((c) => [c.id, { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }]));
  const routes: Laid['routes'] = new Map();
  const lines: { x: number; y: number }[][] = [];
  for (const e of (out.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0];
    if (!s) continue;
    lines.push([s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    const label = e.labels?.[0];
    routes.set(e.id, {
      pts: (s.bendPoints ?? []).map((p) => [Math.round(p.x), Math.round(p.y)]),
      lbl:
        label?.x !== undefined && label.y !== undefined
          ? [Math.round(label.x + (label.width ?? 0) / 2), Math.round(label.y + (label.height ?? 0) / 2)]
          : undefined,
    });
  }
  return { pos, routes, score: score(lines) };
}

/**
 * Lays a whole model out afresh, left to right: every card in a column by how far down the line it is, the cards in
 * each column ordered so belts meet their ends in order without crossing, and every belt run in straight stretches
 * with square turns and a spot of its own for its label. Notes and boxes stay where they are.
 */
export async function arrangeModel(m: Model): Promise<Model> {
  if (!m.nodes.some(isPart)) return m;
  const pool = await elk();
  const tries = await Promise.all(VARIANTS.map((v, i) => place(m, v, pool[i % pool.length])));
  const best = tries.reduce((a, b) => (b.score < a.score ? b : a));
  return {
    ...m,
    nodes: m.nodes.map((n) => {
      const p = best.pos.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    links: m.links.map((l): MLink => {
      const { pts: _, lbl: __, ...rest } = l;
      const r = best.routes.get(l.id);
      if (!r) return rest;
      return { ...rest, ...(r.pts.length ? { pts: r.pts } : {}), ...(r.lbl ? { lbl: r.lbl } : {}) };
    }),
  };
}
