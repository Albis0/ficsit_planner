import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { cardSize, dirOf, endSpot, GRID, HALF, portY } from './layout';
import { type Block, findGroups, layoutGroup, leaning, loose, type Pt, type Route } from './lines';
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

/**
 * A floor from a game save can hold a thousand cards or more: it is laid out one way only and less thoroughly, which
 * takes seconds where the full set of tries would take minutes.
 */
const QUICK = { 'elk.layered.thoroughness': '7' };

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
  routes: Map<string, Route>;
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

interface Ctx {
  blocks?: Block[];
  all?: Map<string, MNode>;
}

async function place(
  nodes: MNode[],
  linksIn: MLink[],
  dir: 'LR' | 'TB',
  variant: Record<string, string>,
  engine: ELK,
  alone = false,
  ctx: Ctx = {},
): Promise<Laid & { lines: Pt[][] }> {
  const blocks = ctx.blocks ?? [];
  const blockOf = new Map<string, Block>();
  for (const b of blocks) for (const id of b.members) blockOf.set(id, b);
  const ids = new Set(nodes.map((n) => n.id));
  const known = (id: string) => ids.has(id) || blockOf.has(id);
  const links = linksIn.filter((l) => known(l.a) && known(l.b) && !(blockOf.has(l.a) && blockOf.get(l.a) === blockOf.get(l.b)));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const full = (id: string) => byId.get(id) ?? ctx.all?.get(id);
  const slot = new Map<string, number>();
  // A splitter's ends (a merger's) go in the order the belts lead on, by the ports they end on further along, so the
  // left end feeds what leads left and its belts don't cross on the way.
  const onward = leaning(links, true);
  const back = leaning(links, false);
  const rank = (ls: MLink[], key: (l: MLink) => number, side: 'a' | 'b') => {
    ls.sort((x, y) => key(x) - key(y) || x.id.localeCompare(y.id));
    for (const [k, l] of ls.entries()) slot.set(`${l.id}:${side}`, k);
  };
  for (const n of nodes) {
    if (!loose(n)) continue;
    rank(
      links.filter((l) => l.a === n.id),
      (l) => l.bp + onward(l.b) / 2,
      'a',
    );
    rank(
      links.filter((l) => l.b === n.id),
      (l) => l.ap + back(l.a) / 2,
      'b',
    );
  }
  const down = dir === 'TB';
  const srcPort = (l: MLink) => slot.get(`${l.id}:a`) ?? l.ap;
  const dstPort = (l: MLink) => slot.get(`${l.id}:b`) ?? l.bp;
  const spot = (b: Block, l: MLink, side: 'in' | 'out') => {
    const id = side === 'out' ? l.a : l.b;
    const n = full(id)!;
    const at = b.inner.get(id)!;
    const e = endSpot(n, side, side === 'out' ? l.ap : l.bp, dir);
    const x = at.x + e.x;
    const y = at.y + e.y;
    return down ? { x, y: side === 'out' ? b.h : 0 } : { x: side === 'out' ? b.w : 0, y };
  };
  const bport = (b: Block, l: MLink, side: 'in' | 'out') => `${b.id}:${l.id}:${side}`;
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      ...BASE,
      ...variant,
      'elk.direction': down ? 'DOWN' : 'RIGHT',
    },
    children: [
      ...nodes.map((n) => {
        const { w, h } = cardSize(n, dir);
        const p = portsOf(n);
        return {
          id: n.id,
          width: w,
          height: h,
          layoutOptions: {
            ...(loose(n)
              ? { 'elk.portConstraints': 'FIXED_SIDE', 'elk.portAlignment.default': 'DISTRIBUTED' }
              : { 'elk.portConstraints': 'FIXED_POS' }),
          } as Record<string, string>,
          ports: [
            ...p.ins.map((_, i) => ({
              id: `${n.id}:i${i}`,
              ...endSpot(n, 'in', i, dir),
              width: 0,
              height: 0,
              layoutOptions: { 'elk.port.side': down ? 'NORTH' : 'WEST' },
            })),
            ...p.outs.map((_, i) => ({
              id: `${n.id}:o${i}`,
              ...endSpot(n, 'out', i, dir),
              width: 0,
              height: 0,
              layoutOptions: { 'elk.port.side': down ? 'SOUTH' : 'EAST' },
            })),
          ],
        };
      }),
      ...blocks.map((b) => ({
        id: b.id,
        width: b.w,
        height: b.h,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } as Record<string, string>,
        ports: [
          ...links
            .filter((l) => blockOf.get(l.a) === b)
            .map((l) => ({
              id: bport(b, l, 'out'),
              ...spot(b, l, 'out'),
              width: 0,
              height: 0,
              layoutOptions: { 'elk.port.side': down ? 'SOUTH' : 'EAST' },
            })),
          ...links
            .filter((l) => blockOf.get(l.b) === b)
            .map((l) => ({
              id: bport(b, l, 'in'),
              ...spot(b, l, 'in'),
              width: 0,
              height: 0,
              layoutOptions: { 'elk.port.side': down ? 'NORTH' : 'WEST' },
            })),
        ],
      })),
    ],
    edges: links.map(
      (l): ElkExtendedEdge => ({
        id: l.id,
        sources: [blockOf.has(l.a) ? bport(blockOf.get(l.a)!, l, 'out') : `${l.a}:o${srcPort(l)}`],
        targets: [blockOf.has(l.b) ? bport(blockOf.get(l.b)!, l, 'in') : `${l.b}:i${dstPort(l)}`],
        labels: [{ id: `${l.id}:label`, text: '-', width: LABEL.w, height: LABEL.h, layoutOptions: ON_BELT }],
      }),
    ),
  };
  const out = await engine.layout(graph);
  const on = (v: number, step: number) => Math.round(v / step) * step;
  const pos = new Map<string, Pt>();
  for (const c of out.children ?? []) {
    const p = { x: on(c.x ?? 0, GRID), y: on(c.y ?? 0, GRID) };
    const b = blocks.find((x) => x.id === c.id);
    if (!b) pos.set(c.id, p);
    else for (const [id, q] of b.inner) pos.set(id, { x: p.x + q.x, y: p.y + q.y });
  }
  const order = new Map<string, { in: number[]; out: number[] }>();
  for (const c of out.children ?? []) {
    const n = byId.get(c.id);
    if (!n || !loose(n)) continue;
    const ranked = (side: 'i' | 'o') => {
      const ps = (c.ports ?? []).filter((p) => p.id.startsWith(`${c.id}:${side}`));
      const along = (p: { x?: number; y?: number }) => (down ? (p.x ?? 0) : (p.y ?? 0));
      const by = [...ps].sort((a, b) => along(a) - along(b)).map((p) => p.id);
      const to: number[] = [];
      for (const p of ps) to[Number(p.id.slice(c.id.length + 2))] = by.indexOf(p.id);
      return to;
    };
    order.set(c.id, { in: ranked('i'), out: ranked('o') });
  }
  const endOf = (id: string, side: 'in' | 'out', i: number) => order.get(id)?.[side][i] ?? i;
  const endAt = (id: string, side: 'in' | 'out', i: number) => {
    const n = full(id);
    const p = pos.get(id);
    if (!n || !p) return undefined;
    const e = endSpot(n, side, i, dir);
    return { x: p.x + e.x, y: p.y + e.y };
  };
  const routes: Laid['routes'] = new Map();
  const lines: Pt[][] = [];
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
      const k = down ? 'x' : 'y';
      bends[0][k] = from[k];
      bends[bends.length - 1][k] = to[k];
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
  return { pos, routes, score: alone ? 0 : score(lines), lines };
}

export async function arrangement(m: Model, quick = false): Promise<Arrangement> {
  const nodes = m.nodes.filter(isPart);
  if (!nodes.length) return { pos: new Map(), routes: new Map() };
  const pool = await elk();
  const dir = dirOf(m);
  const ids = new Set(nodes.map((n) => n.id));
  const links = m.links.filter((l) => ids.has(l.a) && ids.has(l.b));
  const all = new Map(nodes.map((n) => [n.id, n]));
  const found = findGroups(nodes, links);
  const blocks: Block[] = found.map((g, i) => ({ ...layoutGroup(g, all, links, dir), id: `block${i}` }));
  const inBlock = new Set(blocks.flatMap((b) => [...b.members]));
  const rest = nodes.filter((n) => !inBlock.has(n.id));
  const tries = await Promise.all(
    (quick ? [{ ...VARIANTS[0], ...QUICK }] : VARIANTS).map((v, i) =>
      place(rest, links, dir, v, pool[i % pool.length], quick, { blocks, all }),
    ),
  );
  const best = tries.reduce((a, b) => (b.score < a.score ? b : a));
  const routes = new Map(best.routes);
  for (const b of blocks) {
    const [id0] = [...b.members];
    const at = best.pos.get(id0)!;
    const off = b.inner.get(id0)!;
    const dx = at.x - off.x;
    const dy = at.y - off.y;
    for (const [id, r] of b.routes)
      routes.set(id, {
        ap: r.ap,
        bp: r.bp,
        pts: r.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]),
        lbl: r.lbl ? [r.lbl[0] + dx, r.lbl[1] + dy] : undefined,
      });
  }
  return { pos: best.pos, routes };
}

export async function arrangeModel(m: Model, quick = false): Promise<Model> {
  return applyArrangement(m, await arrangement(m, quick));
}

export type Arrangement = Pick<Laid, 'pos' | 'routes'>;

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
      // Tidy up lays the floor out afresh, a belt the player routed by hand included: its stops would only tangle the new layout.
      const { pts: _, lbl: __, own: ___, ...rest } = l;
      if (!r) return rest;
      return { ...rest, ap: r.ap, bp: r.bp, ...(r.pts.length ? { pts: r.pts } : {}), ...(r.lbl ? { lbl: r.lbl } : {}) };
    }),
  };
}
