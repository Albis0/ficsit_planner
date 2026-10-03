import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { cardSize, GRID, HALF, portY } from './layout';
import { portsOf } from './ports';
import { isPart, type MLink, type MNode, type Model } from './types';

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

/** Workers the tries are shared between, so they run side by side. */
const WORKERS = 2;

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
  /** Each belt's bends and label spot, and the ends it now leaves and reaches on a splitter or merger. */
  routes: Map<string, { pts: [number, number][]; lbl?: [number, number]; ap: number; bp: number }>;
  score: number;
}

/**
 * Splitters, mergers and pipe junctions: any of their ends on a side does the same, so the engine may put them in the order that keeps belts
 * from crossing (the top output to the card highest up). Smart and programmable splitters keep theirs: each end has
 * its own rule.
 */
const loose = (n: MNode) => n.k === 'logistic' && (n.kind === 'splitter' || n.kind === 'merger' || n.kind === 'junction');

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

async function place(m: Model, variant: Record<string, string>, engine: ELK): Promise<Laid & { lines: { x: number; y: number }[][] }> {
  const parts = m.nodes.filter(isPart);
  const ids = new Set(parts.map((n) => n.id));
  const links = m.links.filter((l) => ids.has(l.a) && ids.has(l.b));
  const byId = new Map(parts.map((n) => [n.id, n]));
  // A splitter's or merger's belts go to the engine in an order of their own, by what's at their other end, so the
  // ends they're on now don't sway the layout: tidying twice lays the floor out the same.
  const slot = new Map<string, number>();
  // The card at the other end, and the end on it when that end is fixed (a machine's), not one this may change.
  const far = (id: string, port: number) => {
    const n = byId.get(id);
    return n && loose(n) ? id : `${id}:${port}`;
  };
  const rank = (ls: MLink[], other: (l: MLink) => string, side: 'a' | 'b') => {
    ls.sort((x, y) => other(x).localeCompare(other(y)) || x.id.localeCompare(y.id));
    for (const [k, l] of ls.entries()) slot.set(`${l.id}:${side}`, k);
  };
  for (const n of parts) {
    if (!loose(n)) continue;
    rank(
      links.filter((l) => l.a === n.id),
      (l) => far(l.b, l.bp),
      'a',
    );
    rank(
      links.filter((l) => l.b === n.id),
      (l) => far(l.a, l.ap),
      'b',
    );
  }
  const srcPort = (l: MLink) => slot.get(`${l.id}:a`) ?? l.ap;
  const dstPort = (l: MLink) => slot.get(`${l.id}:b`) ?? l.bp;
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
        // Ends spread down the side as the cards draw them, so the order the engine picks lands on the same spots.
        layoutOptions: (loose(n)
          ? { 'elk.portConstraints': 'FIXED_SIDE', 'elk.portAlignment.default': 'DISTRIBUTED' }
          : { 'elk.portConstraints': 'FIXED_POS' }) as Record<string, string>,
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
        sources: [`${l.a}:o${srcPort(l)}`],
        targets: [`${l.b}:i${dstPort(l)}`],
        // Placed on the belt itself; the engine skips a label with no text.
        labels: [{ id: `${l.id}:label`, text: '-', width: LABEL.w, height: LABEL.h, layoutOptions: ON_BELT }],
      }),
    ),
  };
  const out = await engine.layout(graph);
  // Onto the grid: cards on its lines, so their ends are too; bends on a line or halfway, which keeps belts that ran
  // side by side apart. The first and last stretch of a belt stay level with the ends they leave and reach.
  const on = (v: number, step: number) => Math.round(v / step) * step;
  const pos = new Map((out.children ?? []).map((c) => [c.id, { x: on(c.x ?? 0, GRID), y: on(c.y ?? 0, GRID) }]));
  // On a splitter or merger, which of our ends each of the engine's became: its ends on a side, top to bottom.
  const order = new Map<string, { in: number[]; out: number[] }>();
  for (const c of out.children ?? []) {
    const n = byId.get(c.id);
    if (!n || !loose(n)) continue;
    const ranked = (side: 'i' | 'o') => {
      const ps = (c.ports ?? []).filter((p) => p.id.startsWith(`${c.id}:${side}`));
      const by = [...ps].sort((a, b) => (a.y ?? 0) - (b.y ?? 0)).map((p) => p.id);
      const to: number[] = [];
      for (const p of ps) to[Number(p.id.slice(c.id.length + 2))] = by.indexOf(p.id);
      return to;
    };
    order.set(c.id, { in: ranked('i'), out: ranked('o') });
  }
  const endOf = (id: string, side: 'in' | 'out', i: number) => order.get(id)?.[side][i] ?? i;
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
    const ap = endOf(l.a, 'out', srcPort(l));
    const bp = endOf(l.b, 'in', dstPort(l));
    const from = endAt(l.a, 'out', ap);
    const to = endAt(l.b, 'in', bp);
    if (!from || !to) continue;
    const bends = (s.bendPoints ?? []).map((p) => ({ x: on(p.x, HALF), y: on(p.y, HALF) }));
    if (bends.length) {
      bends[0].y = from.y;
      bends[bends.length - 1].y = to.y;
    }
    lines.push([from, ...bends, to]);
    const label = e.labels?.[0];
    routes.set(e.id, {
      ap,
      bp,
      pts: bends.map((p) => [p.x, p.y]),
      lbl:
        label?.x !== undefined && label.y !== undefined
          ? [on(label.x + (label.width ?? 0) / 2, HALF), on(label.y + (label.height ?? 0) / 2, HALF)]
          : undefined,
    });
  }
  return { pos, routes, score: score(lines), lines };
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
      return { ...rest, ap: r.ap, bp: r.bp, ...(r.pts.length ? { pts: r.pts } : {}), ...(r.lbl ? { lbl: r.lbl } : {}) };
    }),
  };
}
