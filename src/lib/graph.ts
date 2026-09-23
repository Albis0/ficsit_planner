import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/react';
import { data, transportFor, type Transport } from './data';
import type { RecipeUse, SolveResult } from './solver';

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
function handlesFor(size: { width: number; height: number }, sides: { target: boolean; source: boolean }): NodeHandle[] {
  const y = size.height / 2 - HANDLE.height / 2;
  const list: NodeHandle[] = [];
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
export function buildGraph(result: SolveResult, tier: number): { nodes: Node[]; edges: Edge[] } {
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
      handles: handlesFor(SIZE.endpoint, { source, target: !source }),
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
      handles: handlesFor(SIZE.machine, { source: true, target: true }),
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

  layout(nodes, edges);
  return { nodes, edges };
}

function layout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 44, ranksep: 220, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const p = g.node(n.id);
    n.position = { x: p.x - (n.width ?? 0) / 2, y: p.y - (n.height ?? 0) / 2 };
  }
}
