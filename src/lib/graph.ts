import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/react';
import { data, transportFor, type Transport } from './data';
import type { RecipeUse, SolveResult } from './solver';

/** Left to right on wide screens; top to bottom on phones, where a long line fits the tall screen. */
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

export interface FlowEdgeData extends Record<string, unknown> {
  item: string;
  rate: number;
  transport: Transport;
  /** Belts/pipes side by side when the best unlocked one can't carry it alone. */
  lanes: number;
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

const SIZE = {
  machine: { width: 330, height: 124 },
  endpoint: { width: 300, height: 84 },
};

/**
 * Turns an LP solution into a factory graph. Each item's producers are matched to its
 * consumers greedily (largest first), which keeps the number of belts low compared
 * to splitting every producer proportionally across every consumer.
 */
export function buildGraph(result: SolveResult, tier: number, dir: Direction = 'LR'): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
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
      handles: handlesFor(SIZE.endpoint, { source, target: !source }, dir),
    });
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
      handles: handlesFor(SIZE.machine, { source: true, target: true }, dir),
    });
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

  layout(nodes, edges, dir);
  return { nodes, edges };
}

function layout(nodes: Node[], edges: Edge[], dir: Direction) {
  const g = new dagre.graphlib.Graph();
  g.setGraph(
    dir === 'TB'
      ? { rankdir: 'TB', nodesep: 30, ranksep: 110, marginx: 20, marginy: 20 }
      : { rankdir: 'LR', nodesep: 44, ranksep: 220, marginx: 40, marginy: 40 },
  );
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const p = g.node(n.id);
    n.position = { x: p.x - (n.width ?? 0) / 2, y: p.y - (n.height ?? 0) / 2 };
  }
}
