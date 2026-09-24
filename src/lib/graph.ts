import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/react';
import { data, transportFor, type Transport } from './data';
import type { RecipeUse, SolveResult } from './solver';

/** Left to right or top to bottom. The layout picks whichever fits the screen, unless the player chose. */
export type Direction = 'LR' | 'TB';

export type EndpointKind = 'raw' | 'supply' | 'missing' | 'target' | 'surplus';

export interface MachineNodeData extends Record<string, unknown> {
  use: RecipeUse;
}

export interface EndpointNodeData extends Record<string, unknown> {
  kind: EndpointKind;
  item: string;
  rate: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The belt's path from the layout: around machines, through a spot kept free for its label. */
export interface Route {
  /** Bends between the two machines; the label sits on the middle one. */
  points: Point[];
  label: Point;
  /** Where both machines were laid out. Once either is dragged, the belt falls back to a plain curve. */
  from: Point;
  to: Point;
}

export interface FlowEdgeData extends Record<string, unknown> {
  item: string;
  rate: number;
  transport: Transport;
  /** Belts/pipes side by side when the best unlocked one can't carry it alone. */
  lanes: number;
  route?: Route;
}

const HANDLE = { width: 10, height: 18 };

/**
 * Handle positions spelled out up front. Without them React Flow assumes top/bottom handles for any
 * node it hasn't measured yet, and a belt can end up entering the output from above.
 */
function handlesFor(size: { width: number; height: number }, sides: { target: boolean; source: boolean }, dir: Direction): NodeHandle[] {
  const list: NodeHandle[] = [];
  if (dir === 'TB') {
    // Same handle turned on its side.
    const x = size.width / 2 - HANDLE.height / 2;
    const flat = { width: HANDLE.height, height: HANDLE.width };
    if (sides.target) list.push({ type: 'target', position: Position.Top, x, y: -flat.height / 2, ...flat });
    if (sides.source) list.push({ type: 'source', position: Position.Bottom, x, y: size.height - flat.height / 2, ...flat });
    return list;
  }
  const y = size.height / 2 - HANDLE.height / 2;
  if (sides.target) list.push({ type: 'target', position: Position.Left, x: -HANDLE.width / 2, y, ...HANDLE });
  if (sides.source) list.push({ type: 'source', position: Position.Right, x: size.width - HANDLE.width / 2, y, ...HANDLE });
  return list;
}

export const SIZE = {
  machine: { width: 310, height: 130 },
  endpoint: { width: 280, height: 84 },
};

/**
 * Space kept for each belt label, so labels never sit on a machine. Dagre gives labels a rank of
 * their own, so ranksep is the gap on both sides of that label rank together.
 */
const LABEL = { width: 176, height: 50 };
const SPACING = {
  LR: { nodesep: 34, ranksep: 70 },
  TB: { nodesep: 30, ranksep: 70 },
};

export interface GraphOptions {
  /** Fixed direction; without it both are tried against the screen and the better fit wins. */
  dir?: Direction;
  /** The floor the graph is shown on, for picking the direction. */
  box?: { width: number; height: number };
}

/**
 * Turns an LP solution into a factory graph. Each item's producers are matched to its
 * consumers greedily (largest first), which keeps the number of belts low compared
 * to splitting every producer proportionally across every consumer.
 */
export function buildGraph(result: SolveResult, tier: number, opts: GraphOptions = {}): { nodes: Node[]; edges: Edge[]; dir: Direction } {
  const nodes: Node[] = [];
  const sides = new Map<string, { source: boolean; target: boolean }>();
  const producers = new Map<string, { node: string; rate: number }[]>();
  const consumers = new Map<string, { node: string; rate: number }[]>();
  const push = (m: typeof producers, item: string, node: string, rate: number) => {
    if (rate <= 1e-6) return;
    const list = m.get(item) ?? [];
    list.push({ node, rate });
    m.set(item, list);
  };

  const endpoint = (kind: EndpointKind, item: string, rate: number) => {
    const id = `${kind}:${item}`;
    const source = kind === 'raw' || kind === 'supply' || kind === 'missing';
    nodes.push({
      id,
      type: 'endpoint',
      position: { x: 0, y: 0 },
      data: { kind, item, rate } satisfies EndpointNodeData,
      ...SIZE.endpoint,
      handles: [],
    });
    sides.set(id, { source, target: !source });
    return id;
  };

  for (const r of result.raw) push(producers, r.item, endpoint('raw', r.item, r.rate), r.rate);
  for (const s of result.supplies) push(producers, s.item, endpoint('supply', s.item, s.rate), s.rate);
  for (const m of result.missing) push(producers, m.item, endpoint('missing', m.item, m.rate), m.rate);

  for (const u of result.recipes) {
    const id = `recipe:${u.recipe.id}`;
    nodes.push({
      id,
      type: 'machine',
      position: { x: 0, y: 0 },
      data: { use: u } satisfies MachineNodeData,
      ...SIZE.machine,
      handles: [],
    });
    sides.set(id, { source: true, target: true });
    for (const o of u.outputs) push(producers, o.item, id, o.rate);
    for (const i of u.inputs) push(consumers, i.item, id, i.rate);
  }

  for (const t of result.targets) push(consumers, t.item, endpoint('target', t.item, t.rate), t.rate);
  for (const s of result.surplus) push(consumers, s.item, endpoint('surplus', s.item, s.rate), s.rate);

  const edges: Edge[] = [];
  for (const [item, prod] of producers) {
    const cons = consumers.get(item);
    if (!cons) continue;
    const p = prod.map((x) => ({ ...x })).sort((a, b) => b.rate - a.rate);
    const c = cons.map((x) => ({ ...x })).sort((a, b) => b.rate - a.rate);
    let i = 0;
    let j = 0;
    while (i < p.length && j < c.length) {
      const flow = Math.min(p[i].rate, c[j].rate);
      if (flow > 1e-4 && p[i].node !== c[j].node) {
        const it = data.items[item];
        const { transport, lanes } = transportFor(it, flow, tier);
        edges.push({
          id: `${p[i].node}>${c[j].node}>${item}`,
          source: p[i].node,
          target: c[j].node,
          type: 'flow',
          data: { item, rate: flow, transport, lanes } satisfies FlowEdgeData,
        });
      }
      p[i].rate -= flow;
      c[j].rate -= flow;
      if (p[i].rate <= 1e-6) i++;
      if (c[j].rate <= 1e-6) j++;
    }
  }

  const dir = layout(nodes, edges, opts);
  for (const n of nodes) n.handles = handlesFor({ width: n.width!, height: n.height! }, sides.get(n.id)!, dir);
  return { nodes, edges, dir };
}

type Ranker = 'network-simplex' | 'tight-tree' | 'longest-path';
const RANKERS: Ranker[] = ['network-simplex', 'tight-tree', 'longest-path'];

interface Placement {
  dir: Direction;
  pos: Map<string, Point>;
  routes: Map<string, { points: Point[]; label: Point }>;
  width: number;
  height: number;
  crossings: number;
}

function place(nodes: Node[], edges: Edge[], dir: Direction, ranker: Ranker): Placement {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: dir, ranker, ...SPACING[dir], marginx: 30, marginy: 30 });
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target, { ...LABEL, labelpos: 'c' }, e.id);
  dagre.layout(g);
  const pos = new Map<string, Point>();
  for (const n of nodes) {
    const p = g.node(n.id);
    pos.set(n.id, { x: p.x - (n.width ?? 0) / 2, y: p.y - (n.height ?? 0) / 2 });
  }
  const routes = new Map<string, { points: Point[]; label: Point }>();
  for (const e of edges) {
    const r = g.edge({ v: e.source, w: e.target, name: e.id });
    // The first and last points sit on the machines' borders; the handles replace them.
    routes.set(e.id, { points: r.points.slice(1, -1), label: { x: r.x, y: r.y } });
  }
  const { width = 0, height = 0 } = g.graph();
  return { dir, pos, routes, width, height, crossings: crossings(nodes, edges, pos, dir) };
}

/** Belts that cross, counting each belt as a straight line from its output handle to its input handle. */
function crossings(nodes: Node[], edges: Edge[], pos: Map<string, Point>, dir: Direction): number {
  const size = new Map(nodes.map((n) => [n.id, { w: n.width ?? 0, h: n.height ?? 0 }]));
  const out = (id: string) => {
    const p = pos.get(id)!;
    const s = size.get(id)!;
    return dir === 'LR' ? { x: p.x + s.w, y: p.y + s.h / 2 } : { x: p.x + s.w / 2, y: p.y + s.h };
  };
  const into = (id: string) => {
    const p = pos.get(id)!;
    const s = size.get(id)!;
    return dir === 'LR' ? { x: p.x, y: p.y + s.h / 2 } : { x: p.x + s.w / 2, y: p.y };
  };
  const lines = edges.map((e) => ({ e, a: out(e.source), b: into(e.target) }));
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[i];
      const m = lines[j];
      if (l.e.source === m.e.source || l.e.target === m.e.target) continue;
      if (side(l.a, l.b, m.a) * side(l.a, l.b, m.b) < 0 && side(m.a, m.b, l.a) * side(m.a, m.b, l.b) < 0) n++;
    }
  }
  return n;
}

/**
 * Tries each ranking strategy in each allowed direction. Within a direction the fewest crossing
 * belts wins; between directions, the one that shows the whole factory bigger on this screen,
 * unless it's only slightly better than the way the screen is shaped.
 */
function layout(nodes: Node[], edges: Edge[], { dir, box }: GraphOptions): Direction {
  const natural: Direction = box && box.height > box.width ? 'TB' : 'LR';
  const dirs: Direction[] = dir ? [dir] : box ? ['LR', 'TB'] : ['LR'];
  const best = dirs.map((d) => RANKERS.map((r) => place(nodes, edges, d, r)).reduce((a, b) => (b.crossings < a.crossings ? b : a)));
  const fit = (p: Placement) => (box ? Math.min(box.width / p.width, box.height / p.height) : 1);
  const pick = best.reduce((a, b) => {
    const [x, y] = a.dir === natural ? [a, b] : [b, a];
    return fit(y) > fit(x) * 1.2 ? y : x;
  });
  for (const n of nodes) n.position = pick.pos.get(n.id)!;
  for (const e of edges) {
    const r = pick.routes.get(e.id)!;
    (e.data as FlowEdgeData).route = { ...r, from: pick.pos.get(e.source)!, to: pick.pos.get(e.target)! };
  }
  return pick.dir;
}
