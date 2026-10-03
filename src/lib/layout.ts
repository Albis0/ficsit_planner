import type { Edge, Node } from '@xyflow/react';
import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import { type Direction, type FlowEdgeData, LABEL, type Port, type PowerEdgeData, SPACING, setPorts, spreadPorts } from './graph';
import { countCrossings, type EdgeRouting, type RoutedEdge } from './routes';
import { EFFORT_SEEDS, type LayoutEffort, type LayoutPlacement } from './settings';

/**
 * Lays out one ELK graph: a worker from the pool, or ELK on this thread. `isStale` says a newer layout replaced
 * this one, so an engine with a queue can drop it rather than run it for nothing.
 */
export type Engine = (graph: ElkNode, isStale?: () => boolean) => Promise<ElkNode>;

export interface LayoutOptions {
  /** Fixed direction; without it both are tried against the screen and the better fit wins. */
  dir?: Direction;
  /** The floor the graph is shown on, for picking the direction. */
  box?: { width: number; height: number };
  /** Card size from the settings. */
  scale?: number;
  /** Belt label text size, for the room kept free for labels. */
  text?: number;
  /** Room between machines, 1 = default. */
  spacing?: number;
  placement?: LayoutPlacement;
  routing?: EdgeRouting;
  effort?: LayoutEffort;
}

/** A laid-out floor: cards placed, belts routed, and the direction it runs. */
export interface Floor {
  nodes: Node[];
  edges: Edge[];
  dir: Direction;
}

type Graph = { nodes: Node[]; edges: Edge[] };

/** Past this many cards and belts together, one arrangement per direction: each takes seconds on a floor this big. */
const BIG = 400;

/** Gap between belts, and between a belt and a machine, before spacing and card size. */
const BELT_GAP = 12;

/** Room along a card's side for each belt meeting it, so belts side by side stay apart. */
const PORT_PITCH = 14;

/**
 * Cards with more belts on one side than fit there grow along that side (taller left to right, wider top to
 * bottom), and say so in `data.side` for the stylesheet. New node objects; the built ones are untouched.
 */
function roomForPorts(graph: Graph, dir: Direction): Graph {
  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  for (const e of graph.edges) {
    outs.set(e.source, (outs.get(e.source) ?? 0) + 1);
    ins.set(e.target, (ins.get(e.target) ?? 0) + 1);
  }
  const along = dir === 'LR' ? 'height' : 'width';
  const nodes = graph.nodes.map((n) => {
    const need = (Math.max(ins.get(n.id) ?? 0, outs.get(n.id) ?? 0) + 1) * PORT_PITCH;
    return need <= (n[along] ?? 0) ? n : { ...n, [along]: need, data: { ...n.data, side: need } };
  });
  return { nodes, edges: graph.edges };
}

/** How ELK lays out a floor: layered, in one direction, with room for belts and their labels, from one random seed. */
export function elkOptions(opts: LayoutOptions, dir: Direction, seed: number): Record<string, string> {
  const gap = (opts.scale ?? 1) * (opts.spacing ?? 1);
  const belt = String(BELT_GAP * gap);
  return {
    'elk.algorithm': 'layered',
    'elk.direction': dir === 'LR' ? 'RIGHT' : 'DOWN',
    'elk.layered.nodePlacement.strategy': opts.placement ?? 'NETWORK_SIMPLEX',
    'elk.edgeRouting': opts.routing ?? 'ORTHOGONAL',
    'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE',
    // Layer sweeps, then the greedy-switch pass, which ELK otherwise skips past 40 nodes (labels and long belts
    // add hidden nodes that count). Seeds, not ELK's own thoroughness, are how we try harder.
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
    'elk.layered.crossingMinimization.greedySwitch.activationThreshold': '0',
    'elk.layered.cycleBreaking.strategy': 'GREEDY',
    'elk.randomSeed': String(seed),
    'elk.spacing.nodeNode': String(SPACING[dir].nodesep * gap),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(SPACING[dir].ranksep * gap),
    'elk.spacing.edgeEdge': belt,
    'elk.spacing.edgeNode': belt,
    'elk.layered.spacing.edgeEdgeBetweenLayers': belt,
    'elk.layered.spacing.edgeNodeBetweenLayers': belt,
    'elk.edgeLabels.placement': 'CENTER',
    'elk.padding': '[top=30,left=30,bottom=30,right=30]',
  };
}

/** The graph in ELK's terms, for one direction and one random seed. */
export function toElk(graph: Graph, opts: LayoutOptions, dir: Direction, seed: number): ElkNode {
  const text = opts.text ?? 1;
  const label = { width: Math.round(LABEL.width * text), height: Math.round(LABEL.height * text) };
  const [inSide, outSide] = dir === 'LR' ? ['WEST', 'EAST'] : ['NORTH', 'SOUTH'];
  const ports = new Map<string, ElkPort[]>(graph.nodes.map((n) => [n.id, []]));
  const port = (id: string, side: string): ElkPort => ({ id, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } });
  for (const e of graph.edges) {
    ports.get(e.source)?.push(port(e.sourceHandle!, outSide));
    ports.get(e.target)?.push(port(e.targetHandle!, inSide));
  }
  return {
    id: 'root',
    layoutOptions: elkOptions(opts, dir, seed),
    children: graph.nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      ports: ports.get(n.id),
      layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
    })),
    edges: graph.edges.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.sourceHandle!],
        targets: [e.targetHandle!],
        // ELK skips a label with no text, keeping no room for it; ours are drawn by the floor, so any text will do.
        labels: [{ id: `${e.id}:label`, text: e.id, ...label }],
      }),
    ),
  };
}

/** The built graph placed as ELK laid it out: new node and edge objects, the built ones untouched. */
export function fromElk(graph: Graph, laid: ElkNode, dir: Direction, routing: EdgeRouting): Floor {
  const placed = new Map((laid.children ?? []).map((c) => [c.id, c]));
  const nodes = graph.nodes.map((n) => {
    const c = placed.get(n.id);
    const node: Node = { ...n, position: { x: c?.x ?? 0, y: c?.y ?? 0 } };
    const ports: Port[] = (c?.ports ?? []).map((p) => ({
      id: p.id,
      type: p.id.endsWith(':out') ? 'source' : 'target',
      offset: dir === 'LR' ? (p.y ?? 0) + (p.height ?? 0) / 2 : (p.x ?? 0) + (p.width ?? 0) / 2,
    }));
    setPorts(node, ports, dir);
    return node;
  });
  const pos = new Map(nodes.map((n) => [n.id, n.position]));
  const routed = new Map((laid.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge]));
  const edges = graph.edges.map((e) => {
    const r = routed.get(e.id);
    const s = r?.sections?.[0];
    if (!r || !s) return { ...e };
    const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y }));
    const l = r.labels?.[0];
    const label = l ? { x: (l.x ?? 0) + (l.width ?? 0) / 2, y: (l.y ?? 0) + (l.height ?? 0) / 2 } : points[Math.floor(points.length / 2)];
    const route = { points, label, from: pos.get(e.source)!, to: pos.get(e.target)!, routing };
    return { ...e, data: { ...(e.data as FlowEdgeData | PowerEdgeData), route } };
  });
  return { nodes, edges, dir };
}

/** The floor's belts as routed lines, for counting crossings. */
export function routesOf(floor: Floor): RoutedEdge[] {
  return floor.edges.flatMap((e) => {
    const route = (e.data as FlowEdgeData | PowerEdgeData | undefined)?.route;
    return route ? [{ source: e.source, target: e.target, points: route.points }] : [];
  });
}

/**
 * Lays the graph out with each seed the effort allows, in each allowed direction, all at once. Within a direction
 * the fewest crossing belts wins (the lower seed on a tie); between directions, the one that shows the whole
 * factory bigger on this screen, unless it's only slightly better than the way the screen is shaped.
 */
export async function layoutGraph(graph: Graph, opts: LayoutOptions, engine: Engine, isStale?: () => boolean): Promise<Floor> {
  const { dir, box } = opts;
  const natural: Direction = box && box.height > box.width ? 'TB' : 'LR';
  const dirs: Direction[] = dir ? [dir] : box ? ['LR', 'TB'] : ['LR'];
  const tries = graph.nodes.length + graph.edges.length > BIG ? 1 : EFFORT_SEEDS[opts.effort ?? 'balanced'];
  const seeds = Array.from({ length: tries }, (_, i) => i + 1);
  const routing = opts.routing ?? 'ORTHOGONAL';
  const best = await Promise.all(
    dirs.map(async (d) => {
      const sized = roomForPorts(graph, d);
      const runs = await Promise.all(
        seeds.map(async (seed) => {
          const laid = await engine(toElk(sized, opts, d, seed), isStale);
          return { floor: fromElk(sized, laid, d, routing), width: laid.width ?? 0, height: laid.height ?? 0 };
        }),
      );
      return fewestCrossings(runs);
    }),
  );
  const fit = (p: { width: number; height: number }) => (box ? Math.min(box.width / p.width, box.height / p.height) : 1);
  return best.reduce((a, b) => {
    const [x, y] = a.floor.dir === natural ? [a, b] : [b, a];
    return fit(y) > fit(x) * 1.2 ? y : x;
  }).floor;
}

/** The run with the fewest crossing belts, the earlier one on a tie. With one run there is nothing to count. */
export function fewestCrossings<T extends { floor: Floor }>(runs: T[]): T {
  if (runs.length === 1) return runs[0];
  return runs.map((run) => ({ run, crossings: countCrossings(routesOf(run.floor)) })).reduce((a, b) => (b.crossings < a.crossings ? b : a))
    .run;
}

/** When no layout engine works: cards in a plain grid in build order, belts as plain curves between their handles. */
export function gridLayout(built: Graph, dir: Direction): Floor {
  const graph = roomForPorts(built, dir);
  const cols = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)));
  const cellW = Math.max(0, ...graph.nodes.map((n) => n.width ?? 0)) + 80;
  const cellH = Math.max(0, ...graph.nodes.map((n) => n.height ?? 0)) + 80;
  const nodes = graph.nodes.map((n, i) => ({ ...n, position: { x: (i % cols) * cellW, y: Math.floor(i / cols) * cellH } }));
  spreadPorts(nodes, graph.edges, dir);
  return { nodes, edges: graph.edges.map((e) => ({ ...e })), dir };
}
