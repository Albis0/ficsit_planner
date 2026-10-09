import { squarePath } from '../components/floor/squarePath';
import { squareBends } from './squareRoute';
import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/react';
import { groupClocks } from './clocks';
import { data, transportFor, type Transport } from './data';
import { plantIdOf } from './power';
import type { RecipeUse, SolveResult } from './solver';
import { matchFlows, type Split, type SplitGroup, splitByDestination } from './split';

/** Left to right or top to bottom. The layout picks whichever fits the screen, unless the player chose. */
export type Direction = 'LR' | 'TB';

export type EndpointKind = 'raw' | 'supply' | 'missing' | 'target' | 'surplus';

export interface MachineNodeData extends Record<string, unknown> {
  use: RecipeUse;
  /** Generators: MW this plant puts on the grid, augmenter boost included. */
  generation?: number;
  /** The line built as one group per place its output goes, when it goes to more than one. */
  split?: Split;
  /** A card of its own for one of those groups: `use` is then just this group's machines. */
  part?: SplitGroup;
}

/** Who draws from the grid: a factory, the fuel chain itself, what the player typed in, or the output sent on. */
export interface Consumer {
  id: string;
  label: string;
  mw: number;
  tone: 'factory' | 'chain' | 'other' | 'out';
}

export interface PowerNodeData extends Record<string, unknown> {
  kind: 'grid' | 'consumer';
  label: string;
  mw: number;
  tone?: Consumer['tone'];
  /** Grid: augmenter boost, e.g. 0.3. */
  boost?: number;
  /** Grid: generation minus everything drawn; negative when the grid is short. */
  balance?: number;
}

/** A power line: generator to grid, grid to what it feeds. */
export interface PowerEdgeData extends Record<string, unknown> {
  mw: number;
  route?: Route;
}

export interface LogisticNodeData extends Record<string, unknown> {
  kind: 'splitter' | 'merger' | 'junction';
  item: string;
  /** What passes through it, per minute. */
  rate: number;
  /** How many ends it has on each side: one in and three out for a splitter, three in and one out for a merger. */
  ins: number;
  outs: number;
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
  /** With square belts: the bends of the same route in straight runs and square turns. */
  square?: Point[];
  /** With square belts: where the label sits on that route, clear of the cards and of other labels. */
  labelAt?: Point;
  /** A belt that runs back against the flow goes round under the cards in square runs; this is the turn where it climbs to its input. */
  loop?: Point;
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

/** Where along its side each of `n` ends of a splitter or merger sits, as a share of the side: one in the middle, three evenly. */
export const portSpots = (n: number): number[] => (n <= 1 ? [0.5] : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)));

/** Which of `total` ends the `used` ones sit on, in order: one in the middle, two on the outer ends, three on all. */
const slotsFor = (used: number, total: number): number[] =>
  total <= 1 ? [0] : used === 1 ? [Math.floor(total / 2)] : used === 2 && total === 3 ? [0, 2] : Array.from({ length: used }, (_, i) => i);

/**
 * Handle positions spelled out up front. Without them React Flow assumes top/bottom handles for any
 * node it hasn't measured yet, and a belt can end up entering the output from above.
 */
function handlesFor(
  size: { width: number; height: number },
  sides: { target: boolean; source: boolean },
  dir: Direction,
  ends?: { ins: number; outs: number },
): NodeHandle[] {
  const list: NodeHandle[] = [];
  if (ends) {
    // A splitter or merger: its ends spread along the side, each with an id the belts name.
    const down = dir === 'TB';
    const [w, h] = down ? [HANDLE.height, HANDLE.width] : [HANDLE.width, HANDLE.height];
    for (const [i, at] of portSpots(ends.ins).entries())
      list.push({
        id: `i${i}`,
        type: 'target',
        position: down ? Position.Top : Position.Left,
        x: down ? at * size.width - w / 2 : -w / 2,
        y: down ? -h / 2 : at * size.height - h / 2,
        width: w,
        height: h,
      });
    for (const [i, at] of portSpots(ends.outs).entries())
      list.push({
        id: `o${i}`,
        type: 'source',
        position: down ? Position.Bottom : Position.Right,
        x: down ? at * size.width - w / 2 : size.width - w / 2,
        y: down ? size.height - h / 2 : at * size.height - h / 2,
        width: w,
        height: h,
      });
    return list;
  }
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
  logistic: { width: 96, height: 96 },
  endpoint: { width: 330, height: 100 },
  grid: { width: 300, height: 124 },
  consumer: { width: 260, height: 84 },
};

/** Each clock group past the first ("+ 1 × 126.19%") takes a line of its own under the count, and the card grows by it. */
export const RUN_LINE = 32;
export const runExtra = (u: RecipeUse) => Math.max(0, groupClocks(u.clocks).length - 1);
/** Lines a machine card grows by: extra clock groups, and the split by destination (or where this group goes) on a line of its own. */
export const cardExtra = (u: RecipeUse, split?: Split | SplitGroup) => runExtra(u) + (split ? 1 : 0);

type Box = { width: number; height: number };

const scaled = (size: Box, k: number) => ({
  width: Math.round(size.width * k),
  height: Math.round(size.height * k),
});

/**
 * A card's box on the floor: card size scales all of it, and text size makes room for the bigger
 * lettering (mostly height, since lines wrap). The CSS sizes the cards with the same formula.
 */
export const cardBox = (size: Box, k: number, text: number): Box => ({
  width: Math.round(size.width * k * (0.6 + 0.4 * text)),
  height: Math.round(size.height * k * (0.3 + 0.7 * text)),
});

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
  /** Card size from the settings; the stylesheet draws the cards at the same scale. */
  scale?: number;
  /** Belt label text size from the settings, for the room kept free for labels. */
  text?: number;
  /** Room between machines, 1 = default. */
  spacing?: number;
  /** Power grid: what it feeds, drawn after the grid node. */
  consumers?: Consumer[];
  /** A line whose output goes to several places: one card with a note, or a card per place. */
  splitLines?: 'one' | 'each';
  /** Belts in straight runs with square turns, as on the hand-built floor, instead of curves. */
  squareBelts?: boolean;
  /** A splitter, merger or pipe junction where a belt feeds several machines or several belts feed one. */
  splitters?: boolean;
}

export interface LineTagData extends Record<string, unknown> {
  /** The products the line makes. */
  items: string[];
}

type Graph = { nodes: Node[]; edges: Edge[]; dir: Direction };

/** Room between one line and the next, and above each for its tag. */
const LINE_GAP = 140;
const LINE_TAG = { width: 520, height: 60, room: 84 };

/** The graph of a factory. With products on lines of their own, each line is laid out apart and the lines stand one after the other. */
export function buildGraph(result: SolveResult, tier: number, opts: GraphOptions = {}): Graph {
  const lines = result.lines;
  if (!lines || lines.length < 2) return buildGraphOne(result, tier, opts);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let dir = opts.dir;
  let cursor = 0;
  for (const [i, line] of lines.entries()) {
    // One direction for all of them: the first line's pick, unless the player chose.
    const g = buildGraphOne({ ...line.result, lines: undefined }, tier, { ...opts, dir });
    dir ??= g.dir;
    const box = {
      minX: Math.min(...g.nodes.map((n) => n.position.x)),
      minY: Math.min(...g.nodes.map((n) => n.position.y)),
      maxX: Math.max(...g.nodes.map((n) => n.position.x + (n.width ?? 0))),
      maxY: Math.max(...g.nodes.map((n) => n.position.y + (n.height ?? 0))),
    };
    // Down the page left to right, side by side top to bottom; each line starts at the edge, with room above for its tag.
    const [dx, dy] = g.dir === 'LR' ? [-box.minX, cursor + LINE_TAG.room - box.minY] : [cursor - box.minX, LINE_TAG.room - box.minY];
    cursor += (g.dir === 'LR' ? box.maxY - box.minY : box.maxX - box.minX) + LINE_GAP + LINE_TAG.room;
    const at = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
    const id = (x: string) => `L${i}:${x}`;
    nodes.push({
      id: `line:${i}`,
      type: 'line',
      position: at({ x: box.minX, y: box.minY - LINE_TAG.room }),
      data: { items: line.items } satisfies LineTagData,
      width: LINE_TAG.width,
      height: LINE_TAG.height,
      draggable: false,
      selectable: false,
      focusable: false,
      handles: [],
    });
    for (const n of g.nodes) nodes.push({ ...n, id: id(n.id), position: at(n.position) });
    for (const e of g.edges) {
      const data = e.data as FlowEdgeData;
      const route = data.route && {
        ...data.route,
        points: data.route.points.map(at),
        label: at(data.route.label),
        from: at(data.route.from),
        to: at(data.route.to),
        ...(data.route.square ? { square: data.route.square.map(at) } : {}),
        ...(data.route.labelAt ? { labelAt: at(data.route.labelAt) } : {}),
        ...(data.route.loop ? { loop: at(data.route.loop) } : {}),
      };
      edges.push({ ...e, id: id(e.id), source: id(e.source), target: id(e.target), data: { ...data, route } });
    }
  }
  return { nodes, edges, dir: dir ?? 'LR' };
}

/** Turns an LP solution into a factory graph, with a belt for each flow `matchFlows` finds. */
function buildGraphOne(result: SolveResult, tier: number, opts: GraphOptions = {}): Graph {
  const k = opts.scale ?? 1;
  const box = (size: Box) => cardBox(size, k, opts.text ?? 1);
  const nodes: Node[] = [];
  const sides = new Map<string, { source: boolean; target: boolean }>();

  const endpoint = (kind: EndpointKind, item: string, rate: number) => {
    const id = `${kind}:${item}`;
    const source = kind === 'raw' || kind === 'supply' || kind === 'missing';
    nodes.push({
      id,
      type: 'endpoint',
      position: { x: 0, y: 0 },
      data: { kind, item, rate } satisfies EndpointNodeData,
      ...box(SIZE.endpoint),
      handles: [],
    });
    sides.set(id, { source, target: !source });
  };

  for (const r of result.raw) endpoint('raw', r.item, r.rate);
  for (const s of result.supplies) endpoint('supply', s.item, s.rate);
  for (const m of result.missing) endpoint('missing', m.item, m.rate);

  const flows = matchFlows(result);
  // Lines drawn as a card per destination: each group's node id, and its share of the line's machines.
  const cards = new Map<string, { id: string; share: number; part: SplitGroup }[]>();
  for (const u of result.recipes) {
    const id = `recipe:${u.recipe.id}`;
    const plant = plantIdOf(u.recipe.id);
    const split = splitByDestination(u, flows, tier);
    if (split && opts.splitLines === 'each') {
      const list = split.groups.map((part, i) => ({ id: `${id}~${i}`, share: part.use.count / u.count, part }));
      cards.set(id, list);
      for (const c of list) {
        nodes.push({
          id: c.id,
          type: 'machine',
          position: { x: 0, y: 0 },
          data: { use: c.part.use, part: c.part } satisfies MachineNodeData,
          ...box({ ...SIZE.machine, height: SIZE.machine.height + RUN_LINE * cardExtra(c.part.use, c.part) }),
          handles: [],
        });
        sides.set(c.id, { source: true, target: true });
      }
      continue;
    }
    nodes.push({
      id,
      type: 'machine',
      position: { x: 0, y: 0 },
      data: { use: u, generation: plant ? (result.grid?.plants[plant] ?? 0) : undefined, split } satisfies MachineNodeData,
      ...box({ ...SIZE.machine, height: SIZE.machine.height + RUN_LINE * cardExtra(u, split) }),
      handles: [],
    });
    sides.set(id, { source: true, target: true });
  }

  for (const t of result.targets) endpoint('target', t.item, t.rate);
  for (const s of result.surplus) endpoint('surplus', s.item, s.rate);

  const edges: Edge[] = [];
  const belt = (from: string, to: string, item: string, rate: number) => {
    const { transport, lanes } = transportFor(data.items[item], rate, tier);
    edges.push({
      id: `${from}>${to}>${item}`,
      source: from,
      target: to,
      type: 'flow',
      data: { item, rate, transport, lanes } satisfies FlowEdgeData,
    });
  };
  const shared = new Map<string, { sources: Map<string, number>; targets: Map<string, number> }>();
  for (const f of flows) {
    if (f.from === f.to) continue;
    const from = cards.get(f.from);
    const to = cards.get(f.to);
    if (!from && !to) {
      belt(f.from, f.to, f.item, f.rate);
      continue;
    }
    // A split line's main output leaves from the group made for that destination; everything else (its inputs, its
    // byproducts) is shared out by each group's size, and matched largest first like the belts between lines.
    const own = from?.find((c) => c.part.nodes.includes(f.to) && f.item === c.part.use.outputs[0].item);
    const sources = own
      ? [{ id: own.id, rate: f.rate }]
      : from
        ? from.map((c) => ({ id: c.id, rate: f.rate * c.share }))
        : [{ id: f.from, rate: f.rate }];
    const targets = to ? to.map((c) => ({ id: c.id, rate: f.rate * c.share })) : [{ id: f.to, rate: f.rate }];
    if (own) {
      for (const [a, b, rate] of pair(sources, targets)) belt(a, b, f.item, rate);
      continue;
    }
    // Shared out by group size: kept for the whole item and matched once below, so two groups' byproducts meet their
    // destinations in as few belts as it takes, not one set of belts for every flow.
    const by = shared.get(f.item) ?? { sources: new Map<string, number>(), targets: new Map<string, number>() };
    shared.set(f.item, by);
    for (const x of sources) by.sources.set(x.id, (by.sources.get(x.id) ?? 0) + x.rate);
    for (const x of targets) by.targets.set(x.id, (by.targets.get(x.id) ?? 0) + x.rate);
  }
  for (const [item, by] of shared) {
    const list = (m: Map<string, number>) => [...m].map(([id, rate]) => ({ id, rate }));
    for (const [a, b, rate] of pair(list(by.sources), list(by.targets))) if (a !== b) belt(a, b, item, rate);
  }

  if (opts.splitters) addLogistics(nodes, edges, sides, box, tier);
  if (result.grid) addGrid(result, nodes, edges, sides, opts.consumers ?? [], box);

  const dir = layout(nodes, edges, opts);
  if (opts.splitters) assignPorts(nodes, edges, dir);
  for (const n of nodes) {
    const d = n.type === 'logistic' ? (n.data as LogisticNodeData) : undefined;
    n.handles = handlesFor({ width: n.width!, height: n.height! }, sides.get(n.id)!, dir, d && { ins: d.ins, outs: d.outs });
  }
  return { nodes, edges, dir };
}

/**
 * Each belt of a splitter or merger takes one of its ends, in the order its other end sits on the floor, so belts leaving
 * one side don't cross each other. Run once the cards have their places.
 */
function assignPorts(nodes: Node[], edges: Edge[], dir: Direction) {
  const at = new Map(nodes.map((n) => [n.id, n]));
  const across = (id: string) => {
    const n = at.get(id);
    if (!n) return 0;
    return dir === 'TB' ? n.position.x + (n.width ?? 0) / 2 : n.position.y + (n.height ?? 0) / 2;
  };
  for (const n of nodes) {
    if (n.type !== 'logistic') continue;
    const d = n.data as LogisticNodeData;
    const outs = edges.filter((e) => e.source === n.id).sort((a, b) => across(a.target) - across(b.target));
    const ins = edges.filter((e) => e.target === n.id).sort((a, b) => across(a.source) - across(b.source));
    slotsFor(outs.length, d.outs).forEach((slot, i) => {
      outs[i].sourceHandle = `o${slot}`;
    });
    slotsFor(ins.length, d.ins).forEach((slot, i) => {
      ins[i].targetHandle = `i${slot}`;
    });
  }
}

/** Up to three belts out of a splitter (three into a merger); more than that chains another one on. */
const FAN = 3;

/**
 * A belt that feeds several machines gets a splitter, and several belts into one machine a merger (a junction for
 * pipes), chained three at a time like on the Manual floor, so the floor shows what would be built.
 */
function addLogistics(
  nodes: Node[],
  edges: Edge[],
  sides: Map<string, { source: boolean; target: boolean }>,
  box: (size: Box) => Box,
  tier: number,
) {
  let n = 0;
  const seen = new Map<string, number>();
  const unique = (id: string) => {
    const c = (seen.get(id) ?? 0) + 1;
    seen.set(id, c);
    return c > 1 ? `${id}#${c}` : id;
  };
  const flowEdges = () => edges.filter((e) => e.type === 'flow');
  const make = (from: string, to: string, item: string, rate: number): Edge => {
    const { transport, lanes } = transportFor(data.items[item], rate, tier);
    return {
      id: unique(`${from}>${to}>${item}`),
      source: from,
      target: to,
      type: 'flow',
      data: { item, rate, transport, lanes } satisfies FlowEdgeData,
    };
  };
  const logistic = (kind: LogisticNodeData['kind'], item: string, rate: number, merge: boolean): string => {
    const id = `${kind}:${n++}`;
    nodes.push({
      id,
      type: 'logistic',
      position: { x: 0, y: 0 },
      data: { kind, item, rate, ins: merge ? FAN : 1, outs: merge ? 1 : FAN } satisfies LogisticNodeData,
      ...box(SIZE.logistic),
      handles: [],
    });
    sides.set(id, { source: true, target: true });
    return id;
  };
  const group = (key: (e: Edge) => string) => {
    const by = new Map<string, Edge[]>();
    for (const e of flowEdges()) by.set(key(e), [...(by.get(key(e)) ?? []), e]);
    return [...by.values()].filter((list) => list.length > 1);
  };
  const rateOf = (e: Edge) => (e.data as FlowEdgeData).rate;
  const itemOf = (e: Edge) => (e.data as FlowEdgeData).item;
  const pipe = (item: string) => data.items[item]?.form !== 'solid';
  const drop = (gone: Edge[]) => {
    for (const e of gone) edges.splice(edges.indexOf(e), 1);
  };

  // Splitters: one output going to several places.
  for (const list of group((e) => `${e.source}|${itemOf(e)}`)) {
    const item = itemOf(list[0]);
    const kind = pipe(item) ? 'junction' : 'splitter';
    drop(list);
    let feed = list[0].source;
    let left = [...list].sort((a, b) => rateOf(b) - rateOf(a));
    while (left.length) {
      const last = left.length <= FAN;
      const take = last ? left : left.slice(0, FAN - 1);
      const through = left.reduce((s, e) => s + rateOf(e), 0);
      const id = logistic(kind, item, through, false);
      edges.push(make(feed, id, item, through));
      for (const e of take) edges.push(make(id, e.target, item, rateOf(e)));
      left = left.slice(take.length);
      feed = id;
    }
  }
  // Mergers: several belts into one input.
  for (const list of group((e) => `${e.target}|${itemOf(e)}`)) {
    const item = itemOf(list[0]);
    const kind = pipe(item) ? 'junction' : 'merger';
    drop(list);
    const into = list[0].target;
    let left = [...list].sort((a, b) => rateOf(b) - rateOf(a));
    let feed = into;
    // The first merger is the one next to the machine; each further one feeds the one before it.
    while (left.length) {
      const last = left.length <= FAN;
      const take = last ? left : left.slice(0, FAN - 1);
      const through = left.reduce((s, e) => s + rateOf(e), 0);
      const id = logistic(kind, item, through, true);
      edges.push(make(id, feed, item, through));
      for (const e of take) edges.push(make(e.source, id, item, rateOf(e)));
      left = left.slice(take.length);
      feed = id;
    }
  }
}

/** Two lists of ends matched largest first, as few belts as it takes: [from, to, rate] each. */
function pair(sources: { id: string; rate: number }[], targets: { id: string; rate: number }[]): [string, string, number][] {
  const p = sources.map((x) => ({ ...x })).sort((a, b) => b.rate - a.rate);
  const c = targets.map((x) => ({ ...x })).sort((a, b) => b.rate - a.rate);
  const out: [string, string, number][] = [];
  let i = 0;
  let j = 0;
  while (i < p.length && j < c.length) {
    const rate = Math.min(p[i].rate, c[j].rate);
    if (rate > 1e-4) out.push([p[i].id, c[j].id, rate]);
    p[i].rate -= rate;
    c[j].rate -= rate;
    if (p[i].rate <= 1e-6) i++;
    if (c[j].rate <= 1e-6) j++;
  }
  return out;
}

/**
 * The power grid as a node of its own: every generator feeds it a power line, and it feeds each
 * consumer, so the whole grid reads left to right from fuel to factories.
 */
function addGrid(
  result: SolveResult,
  nodes: Node[],
  edges: Edge[],
  sides: Map<string, { source: boolean; target: boolean }>,
  consumers: Consumer[],
  box: (size: Box) => Box,
) {
  const grid = result.grid!;
  const drawn = consumers.reduce((s, c) => s + c.mw, 0);
  nodes.push({
    id: 'grid',
    type: 'power',
    position: { x: 0, y: 0 },
    data: { kind: 'grid', label: '', mw: grid.generation, boost: grid.boost, balance: grid.generation - drawn } satisfies PowerNodeData,
    ...box(SIZE.grid),
    handles: [],
  });
  sides.set('grid', { source: consumers.length > 0, target: true });
  for (const u of result.recipes) {
    const plant = plantIdOf(u.recipe.id);
    if (!plant) continue;
    const id = `recipe:${u.recipe.id}`;
    edges.push({
      id: `${id}>grid`,
      source: id,
      target: 'grid',
      type: 'power',
      data: { mw: grid.plants[plant] ?? 0 } satisfies PowerEdgeData,
    });
  }
  for (const c of consumers) {
    const id = `use:${c.id}`;
    nodes.push({
      id,
      type: 'power',
      position: { x: 0, y: 0 },
      data: { kind: 'consumer', label: c.label, mw: c.mw, tone: c.tone } satisfies PowerNodeData,
      ...box(SIZE.consumer),
      handles: [],
    });
    sides.set(id, { source: false, target: true });
    edges.push({ id: `grid>${id}`, source: 'grid', target: id, type: 'power', data: { mw: c.mw } satisfies PowerEdgeData });
  }
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

function place(nodes: Node[], edges: Edge[], dir: Direction, ranker: Ranker, opts: GraphOptions): Placement {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  const gap = (opts.scale ?? 1) * (opts.spacing ?? 1);
  const label = scaled(LABEL, opts.text ?? 1);
  g.setGraph({ rankdir: dir, ranker, nodesep: SPACING[dir].nodesep * gap, ranksep: SPACING[dir].ranksep * gap, marginx: 30, marginy: 30 });
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target, { ...label, labelpos: 'c' }, e.id);
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

/** Gives every belt its square route: dagre's bends made straight runs, belts of different lines kept in lanes of their own. */
function squareUp(nodes: Node[], edges: Edge[], dir: Direction, text: number) {
  const size = new Map(nodes.map((n) => [n.id, { w: n.width ?? 0, h: n.height ?? 0 }]));
  const pos = new Map(nodes.map((n) => [n.id, n.position]));
  const out = (id: string): Point => {
    const [p, s] = [pos.get(id)!, size.get(id)!];
    return dir === 'LR' ? { x: p.x + s.w, y: p.y + s.h / 2 } : { x: p.x + s.w / 2, y: p.y + s.h };
  };
  const into = (id: string): Point => {
    const [p, s] = [pos.get(id)!, size.get(id)!];
    return dir === 'LR' ? { x: p.x, y: p.y + s.h / 2 } : { x: p.x + s.w / 2, y: p.y };
  };
  const flow = edges.filter((e) => e.type === 'flow' && (e.data as FlowEdgeData).route && !(e.data as FlowEdgeData).route!.loop);
  const bends = squareBends(
    flow.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      from: out(e.source),
      to: into(e.target),
      via: (e.data as FlowEdgeData).route!.points,
    })),
    dir,
  );
  for (const e of flow) (e.data as FlowEdgeData).route!.square = bends.get(e.id);
  placeLabels(nodes, flow, dir, out, into, text);
}

type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** A belt label's box on the floor, about as big as the label draws, for keeping labels off the cards and off each other. */
const LABEL_BOX = { width: 150, height: 44 };

/**
 * Puts each square belt's label on its longest run, then slides it along the belt (and onto its other runs) while it would
 * cover a card or another belt's label. Where nothing is clear, the spot that covers least wins.
 */
function placeLabels(nodes: Node[], flow: Edge[], dir: Direction, out: (id: string) => Point, into: (id: string) => Point, text: number) {
  const box = { w: LABEL_BOX.width * text, h: LABEL_BOX.height * text };
  const cards: Rect[] = nodes.map((n) => ({ x: n.position.x - 4, y: n.position.y - 4, w: (n.width ?? 0) + 8, h: (n.height ?? 0) + 8 }));
  const taken: Rect[] = [];
  const AT = [0.5, 0.3, 0.7, 0.15, 0.85];
  for (const e of flow) {
    const route = (e.data as FlowEdgeData).route!;
    if (!route.square) continue;
    const { runs } = squarePath(out(e.source), route.square, into(e.target), dir === 'TB');
    const long = runs
      .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > 30)
      .sort(([a, b], [c, d]) => Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y));
    let best: { p: Point; cost: number } | undefined;
    for (const [a, b] of long.length ? long : runs) {
      for (const t of AT) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const r = { x: p.x - box.w / 2, y: p.y - box.h / 2, w: box.w, h: box.h };
        const cost = [...cards, ...taken].reduce((sum, c) => sum + overlap(r, c), 0);
        if (!best || cost < best.cost) best = { p, cost };
        if (cost === 0) break;
      }
      if (best?.cost === 0) break;
    }
    if (!best) continue;
    route.labelAt = best.p;
    taken.push({ x: best.p.x - box.w / 2, y: best.p.y - box.h / 2, w: box.w, h: box.h });
  }
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
function layout(nodes: Node[], edges: Edge[], opts: GraphOptions): Direction {
  const { dir, box } = opts;
  const natural: Direction = box && box.height > box.width ? 'TB' : 'LR';
  const dirs: Direction[] = dir ? [dir] : box ? ['LR', 'TB'] : ['LR'];
  const best = dirs.map((d) => RANKERS.map((r) => place(nodes, edges, d, r, opts)).reduce((a, b) => (b.crossings < a.crossings ? b : a)));
  const fit = (p: Placement) => (box ? Math.min(box.width / p.width, box.height / p.height) : 1);
  const pick = best.reduce((a, b) => {
    const [x, y] = a.dir === natural ? [a, b] : [b, a];
    return fit(y) > fit(x) * 1.2 ? y : x;
  });
  for (const n of nodes) n.position = pick.pos.get(n.id)!;
  for (const e of edges) {
    const r = pick.routes.get(e.id)!;
    (e.data as FlowEdgeData | PowerEdgeData).route = { ...r, from: pick.pos.get(e.source)!, to: pick.pos.get(e.target)! };
  }
  loopBack(nodes, edges, pick.dir, opts.text ?? 1);
  if (opts.squareBelts) squareUp(nodes, edges, pick.dir, opts.text ?? 1);
  return pick.dir;
}

/** How far a returning belt's first and last runs stand off the cards, and how far under the lowest card it runs, in floor units. */
const LOOP = { stub: 30, under: 46, lane: 62 };

/**
 * Belts that run back against the flow (water out of a later machine into an earlier one) go round under the cards:
 * out of the output, down past the lowest card in their way, back along it and up into the input. They are drawn in
 * straight runs whatever the belt style, nearer ones tucked inside wider ones.
 */
function loopBack(nodes: Node[], edges: Edge[], dir: Direction, text: number) {
  const uv = (p: Point): [number, number] => (dir === 'LR' ? [p.x, p.y] : [p.y, p.x]);
  const xy = (u: number, v: number): Point => (dir === 'LR' ? { x: u, y: v } : { x: v, y: u });
  const box = new Map(
    nodes.map((n) => {
      const [u, v] = uv(n.position);
      const [du, dv] = dir === 'LR' ? [n.width ?? 0, n.height ?? 0] : [n.height ?? 0, n.width ?? 0];
      return [n.id, { u, v, du, dv }] as const;
    }),
  );
  const loops = edges
    .filter((e) => e.type === 'flow' && (e.data as FlowEdgeData).route)
    .map((e) => {
      const [s, t] = [box.get(e.source)!, box.get(e.target)!];
      return { e, from: [s.u + s.du, s.v + s.dv / 2] as const, to: [t.u, t.v + t.dv / 2] as const };
    })
    .filter((l) => l.to[0] <= l.from[0])
    .sort((a, b) => a.from[0] - a.to[0] - (b.from[0] - b.to[0]));
  const box2 = { w: 300 * text, h: LABEL_BOX.height * text };
  const cards: Rect[] = nodes.map((n) => ({ x: n.position.x - 4, y: n.position.y - 4, w: (n.width ?? 0) + 8, h: (n.height ?? 0) + 8 }));
  const taken: Rect[] = edges
    .filter((e) => !loops.some((l) => l.e === e))
    .flatMap((e) => ((e.data as FlowEdgeData | PowerEdgeData).route?.label ? [(e.data as FlowEdgeData).route!.label] : []))
    .map((p) => ({
      x: p.x - (LABEL_BOX.width * text) / 2,
      y: p.y - (LABEL_BOX.height * text) / 2,
      w: LABEL_BOX.width * text,
      h: LABEL_BOX.height * text,
    }));
  for (const [lane, l] of loops.entries()) {
    const [lo, hi] = [l.to[0] - LOOP.stub, l.from[0] + LOOP.stub];
    let [near, far] = [Math.min(l.from[1], l.to[1]), Math.max(l.from[1], l.to[1])];
    for (const b of box.values()) {
      if (b.u >= hi || b.u + b.du <= lo) continue;
      near = Math.min(near, b.v);
      far = Math.max(far, b.v + b.dv);
    }
    // Under the cards on a floor running right; on one running down, round whichever side is nearer.
    const left = dir === 'TB' && (l.from[1] + l.to[1]) / 2 - near < far - (l.from[1] + l.to[1]) / 2;
    const v = left ? near - LOOP.under - lane * LOOP.lane : far + LOOP.under + lane * LOOP.lane;
    const route = (l.e.data as FlowEdgeData).route!;
    route.square = [xy(hi, l.from[1]), xy(hi, v), xy(lo, v), xy(lo, l.to[1])];
    // The label slides along the run to where it covers least: cards, the other belts' labels, the loops' labels already put down.
    let best: { p: Point; cost: number } | undefined;
    for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const p = xy(lo + (hi - lo) * t, v);
      const r = { x: p.x - box2.w / 2, y: p.y - box2.h / 2, w: box2.w, h: box2.h };
      const cost = [...cards, ...taken].reduce((sum, c) => sum + overlap(r, c), 0);
      if (!best || cost < best.cost) best = { p, cost };
      if (cost === 0) break;
    }
    route.labelAt = best!.p;
    taken.push({ x: best!.p.x - box2.w / 2, y: best!.p.y - box2.h / 2, w: box2.w, h: box2.h });
    route.loop = xy(lo, l.to[1]);
  }
}
