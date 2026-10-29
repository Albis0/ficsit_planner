import { squarePath } from '../components/floor/squarePath';
import { squareBends } from './squareRoute';
import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/react';
import { groupClocks } from './clocks';
import { data, transportFor, type Transport } from './data';
import { chains } from './autoAreas';
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
  /** An end for each item the card takes and gives, in the order that keeps its belts from crossing; set once the cards have their places. */
  ends?: CardEnds;
  /** Lines and columns the card grew by, to give every end room for the belts side by side on it. */
  room?: { rows: number; cols: number };
}

/** One end of a machine card: a square on its edge holding the item's icon, with the belts for that item going into it. */
export interface CardEnd {
  /** The handle's id: i0, i1… for what the card takes, o0, o1… for what it gives. */
  id: string;
  /** The item it takes or gives; none for a generator's power line. */
  item?: string;
  /** Where its middle is along its side, as a share of the side. */
  at: number;
  /** How long it is along the side, in floor units: as wide as the belts side by side that meet it. */
  len: number;
}

export interface CardEnds {
  in: CardEnd[];
  out: CardEnd[];
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
  /** How many belts side by side meet each end of the card. */
  ports?: { in?: number; out?: number };
  /** The products of the line this card belongs to, when the factory is built as lines of their own. */
  line?: string[];
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
  /** Which ends are as wide as the belts (a card's end), so those belts run in parallel into it instead of joining. */
  wide?: { from: boolean; to: boolean };
  route?: Route;
}

const HANDLE = { width: 10, height: 18 };

/** The most belts side by side that are drawn as such; past that the label's count says how many. */
export const MAX_LANES = 6;
/** Centre to centre between belts side by side. */
export const LANE_PITCH = 10;

/** How long a card's end is: as wide as the belts side by side that meet it, so they go in parallel. */
const endLength = (lanes: number | undefined, room: number) => Math.min(room - 6, Math.max(HANDLE.height, (lanes ?? 0) * LANE_PITCH));

/** Where along its side each of `n` ends of a splitter or merger sits, as a share of the side: one in the middle, three evenly. */
export const portSpots = (n: number): number[] => (n <= 1 ? [0.5] : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)));

/** Which of `total` ends the `used` ones sit on, in order: one in the middle, two on the outer ends, three on all. */
const slotsFor = (used: number, total: number): number[] =>
  total <= 1 ? [0] : used === 1 ? [Math.floor(total / 2)] : used === 2 && total === 3 ? [0, 2] : Array.from({ length: used }, (_, i) => i);

/** A card's end is a square this big, kept this far from the next one, and sits this far over the card's side so it is joined to it (card scale 1). */
export const END = 26;
const END_GAP = 8;
const END_LAP = 2;
const END_REACH = END - END_LAP;
/** The generator's power line among its ends. */
const POWER = 'power';
/** A card that must be wider to hold its ends grows by this much at a time, as it grows by a line for more clock groups. */
const WIDE_STEP = 40;

/** What a machine card gives ends for: the items it takes and gives, in the recipe's order. */
const keysOf = (d: MachineNodeData) => ({
  in: d.use.recipe.inputs.map((s) => s.item),
  out: [...d.use.recipe.outputs.map((s) => s.item), ...(d.use.recipe.kind === 'power' ? [POWER] : [])],
});
/** Which end of its machine a belt (or a generator's power line) is on. */
const keyOf = (e: Edge) => (e.type === 'power' ? POWER : (e.data as FlowEdgeData).item);

/** Most belts side by side any belt of an item has at a card's side. */
function lanesAt(edges: Edge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== 'flow') continue;
    const lanes = Math.min((e.data as FlowEdgeData).lanes, MAX_LANES);
    for (const k of [`${e.source}|o|${keyOf(e)}`, `${e.target}|i|${keyOf(e)}`]) m.set(k, Math.max(m.get(k) ?? 1, lanes));
  }
  return m;
}

/** How long an end is: the belts side by side that meet it, never less than its square. */
const endLen = (lanes: number | undefined, scale: number) => Math.max(END * scale, (lanes ?? 1) * LANE_PITCH);

/** The ends of one card, in the order given, spread along a side of `side` floor units with the same room between them. */
function cardEnds(id: string, order: { in: string[]; out: string[] }, lanes: Map<string, number>, side: number, scale: number): CardEnds {
  const row = (p: 'i' | 'o', keys: string[]): CardEnd[] => {
    const len = keys.map((key) => endLen(key === POWER ? 1 : lanes.get(`${id}|${p}|${key}`), scale));
    const gap = (side - len.reduce((a, b) => a + b, 0)) / (keys.length + 1);
    let from = gap;
    return keys.map((key, i) => {
      const at = (from + len[i] / 2) / side;
      from += len[i] + gap;
      return { id: `${p}${i}`, ...(key === POWER ? {} : { item: key }), at, len: len[i] };
    });
  };
  return { in: row('i', order.in), out: row('o', order.out) };
}

/**
 * Makes a machine card big enough for its ends: every end as long as the belts side by side on it, with room between.
 * It grows by lines (down a floor running right) or columns (across a floor running down), only when it has to.
 */
function growCards(nodes: Node[], edges: Edge[], box: (size: Box) => Box, scale: number, dir?: Direction) {
  const lanes = lanesAt(edges);
  for (const n of nodes) {
    if (n.type !== 'machine') continue;
    const d = n.data as MachineNodeData;
    const keys = keysOf(d);
    const room = (p: 'i' | 'o', list: string[]) =>
      list.reduce(
        (sum, key) => sum + endLen(key === POWER ? 1 : lanes.get(`${n.id}|${p}|${key}`), scale),
        END_GAP * scale * (list.length + 1),
      );
    const need = Math.max(room('i', keys.in), room('o', keys.out));
    const base = cardExtra(d.use, d.split ?? d.part);
    let [rows, cols] = [0, 0];
    while (dir !== 'TB' && box({ ...SIZE.machine, height: SIZE.machine.height + RUN_LINE * (base + rows) }).height < need) rows++;
    while (dir !== 'LR' && box({ ...SIZE.machine, width: SIZE.machine.width + WIDE_STEP * cols }).width < need) cols++;
    if (!rows && !cols) continue;
    const b = box({ width: SIZE.machine.width + WIDE_STEP * cols, height: SIZE.machine.height + RUN_LINE * (base + rows) });
    n.width = b.width;
    n.height = b.height;
    n.data = { ...d, room: { rows, cols } };
  }
}

/** Where a belt meets a node: the middle of its side, or of the end of the card it is on. */
function meet(p: Point, s: { w: number; h: number }, dir: Direction, side: 'in' | 'out', end?: CardEnd): Point {
  const at = end?.at ?? 0.5;
  return dir === 'LR'
    ? { x: p.x + (side === 'out' ? s.w : 0), y: p.y + s.h * at }
    : { x: p.x + s.w * at, y: p.y + (side === 'out' ? s.h : 0) };
}

/**
 * For each machine card, the items on its ends in the order that keeps its belts from crossing: as the other ends of
 * the belts stand across the flow (an item with no belt comes last, in the recipe's order).
 */
function orderEnds(nodes: Node[], edges: Edge[], pos: Map<string, Point>, dir: Direction): Map<string, { in: string[]; out: string[] }> {
  const size = new Map(nodes.map((n) => [n.id, n]));
  const across = (id: string) => {
    const n = size.get(id)!;
    const p = pos.get(id)!;
    return dir === 'TB' ? p.x + (n.width ?? 0) / 2 : p.y + (n.height ?? 0) / 2;
  };
  const by = (end: 'source' | 'target') => {
    const m = new Map<string, Edge[]>();
    for (const e of edges) m.set(e[end], [...(m.get(e[end]) ?? []), e]);
    return m;
  };
  const [from, into] = [by('source'), by('target')];
  const sorted = (keys: string[], belts: Edge[], far: 'source' | 'target') => {
    const where = (key: string) => {
      const x = belts.filter((e) => keyOf(e) === key).map((e) => across(e[far]));
      return x.length ? x.reduce((a, b) => a + b, 0) / x.length : Number.POSITIVE_INFINITY;
    };
    return keys
      .map((key, i) => ({ key, i, at: where(key) }))
      .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at - b.at))
      .map((x) => x.key);
  };
  const order = new Map<string, { in: string[]; out: string[] }>();
  for (const n of nodes) {
    if (n.type !== 'machine') continue;
    const keys = keysOf(n.data as MachineNodeData);
    order.set(n.id, { in: sorted(keys.in, into.get(n.id) ?? [], 'source'), out: sorted(keys.out, from.get(n.id) ?? [], 'target') });
  }
  return order;
}

/** The end each belt of a machine card is on, by the belt's id. */
function endsOfBelts(
  edges: Edge[],
  order: Map<string, { in: string[]; out: string[] }>,
): Map<string, { source?: string; target?: string }> {
  const handles = new Map<string, { source?: string; target?: string }>();
  for (const e of edges) {
    const s = order.get(e.source)?.out.indexOf(keyOf(e)) ?? -1;
    const t = order.get(e.target)?.in.indexOf(keyOf(e)) ?? -1;
    if (s >= 0 || t >= 0) handles.set(e.id, { ...(s >= 0 ? { source: `o${s}` } : {}), ...(t >= 0 ? { target: `i${t}` } : {}) });
  }
  return handles;
}

/** The cards' ends worked out for a placement. */
function endsFor(
  nodes: Node[],
  edges: Edge[],
  order: Map<string, { in: string[]; out: string[] }>,
  dir: Direction,
  scale: number,
): Map<string, CardEnds> {
  const lanes = lanesAt(edges);
  const ends = new Map<string, CardEnds>();
  for (const n of nodes) {
    const o = order.get(n.id);
    if (o) ends.set(n.id, cardEnds(n.id, o, lanes, (dir === 'TB' ? n.width : n.height) ?? 0, scale));
  }
  return ends;
}

/**
 * Handle positions spelled out up front. Without them React Flow assumes top/bottom handles for any
 * node it hasn't measured yet, and a belt can end up entering the output from above.
 */
function handlesFor(
  size: { width: number; height: number },
  sides: { target: boolean; source: boolean },
  dir: Direction,
  ends?: { ins: number; outs: number },
  wide?: { in?: number; out?: number },
  card?: CardEnds,
  scale = 1,
): NodeHandle[] {
  const list: NodeHandle[] = [];
  if (card) {
    // A machine card: a square for each item, standing just outside the side, as on the Manual floor.
    const down = dir === 'TB';
    const [reach, square] = [END_REACH * scale, END * scale];
    for (const [type, row] of [
      ['target', card.in],
      ['source', card.out],
    ] as const) {
      for (const e of row) {
        const along = e.at * (down ? size.width : size.height) - e.len / 2;
        const out = type === 'target' ? -reach : (down ? size.height : size.width) + reach - square;
        list.push({
          id: e.id,
          type,
          position: down ? (type === 'target' ? Position.Top : Position.Bottom) : type === 'target' ? Position.Left : Position.Right,
          x: down ? along : out,
          y: down ? out : along,
          width: down ? e.len : square,
          height: down ? square : e.len,
        });
      }
    }
    return list;
  }
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
    if (sides.target) {
      const flat = { width: endLength(wide?.in, size.width), height: HANDLE.width };
      list.push({ type: 'target', position: Position.Top, x: size.width / 2 - flat.width / 2, y: -flat.height / 2, ...flat });
    }
    if (sides.source) {
      const flat = { width: endLength(wide?.out, size.width), height: HANDLE.width };
      list.push({
        type: 'source',
        position: Position.Bottom,
        x: size.width / 2 - flat.width / 2,
        y: size.height - flat.height / 2,
        ...flat,
      });
    }
    return list;
  }
  if (sides.target) {
    const h = { width: HANDLE.width, height: endLength(wide?.in, size.height) };
    list.push({ type: 'target', position: Position.Left, x: -h.width / 2, y: size.height / 2 - h.height / 2, ...h });
  }
  if (sides.source) {
    const h = { width: HANDLE.width, height: endLength(wide?.out, size.height) };
    list.push({ type: 'source', position: Position.Right, x: size.width - h.width / 2, y: size.height / 2 - h.height / 2, ...h });
  }
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
    // A leftover card of a line of its own says which products that line makes, so what is made from it joins them.
    const owned = (n: Node) => (n.type === 'endpoint' ? { ...n, data: { ...n.data, line: line.items } } : n);
    for (const n of g.nodes) nodes.push({ ...owned(n), id: id(n.id), position: at(n.position) });
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

  growCards(nodes, edges, box, k, opts.dir);
  const dir = layout(nodes, edges, opts);
  if (opts.splitters) assignPorts(nodes, edges, dir);
  widenEnds(nodes, edges);
  for (const n of nodes) {
    const d = n.type === 'logistic' ? (n.data as LogisticNodeData) : undefined;
    const ports = n.type === 'endpoint' ? (n.data as EndpointNodeData).ports : undefined;
    const card = n.type === 'machine' ? (n.data as MachineNodeData).ends : undefined;
    n.handles = handlesFor(
      { width: n.width!, height: n.height! },
      sides.get(n.id)!,
      dir,
      d && { ins: d.ins, outs: d.outs },
      ports,
      card,
      k,
    );
  }
  return { nodes, edges, dir };
}

/**
 * A card's end as wide as the most belts side by side that meet it, so a line of 14 belts enters the card as a ribbon
 * and not through one point. The ends of splitters and mergers stay small: their belts join there.
 */
function widenEnds(nodes: Node[], edges: Edge[]) {
  const ports = new Map<string, { in?: number; out?: number }>();
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const card = (id: string) => type.get(id) === 'machine' || type.get(id) === 'endpoint';
  // A machine's ends are sized from their belts when the card is made; a leftover or input card has one end a side.
  const own = (id: string) => type.get(id) === 'endpoint';
  for (const e of edges) {
    if (e.type !== 'flow') continue;
    const d = e.data as FlowEdgeData;
    const lanes = Math.min(d.lanes, MAX_LANES);
    if (lanes < 2) continue;
    const wide = { from: card(e.source), to: card(e.target) };
    e.data = { ...d, wide };
    if (wide.from && own(e.source)) ports.set(e.source, { ...ports.get(e.source), out: Math.max(ports.get(e.source)?.out ?? 0, lanes) });
    if (wide.to && own(e.target)) ports.set(e.target, { ...ports.get(e.target), in: Math.max(ports.get(e.target)?.in ?? 0, lanes) });
  }
  for (const n of nodes) {
    const p = ports.get(n.id);
    if (p) n.data = { ...n.data, ports: p };
  }
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
 * pipes), as a balanced tree of up to three at a time like on the Manual floor, so the floor shows what would be built.
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

  const total = (list: Edge[]) => list.reduce((sum, e) => sum + rateOf(e), 0);
  /** How many branches a splitter or merger over n belts has: up to FAN, and the branches as even in size as can be. */
  const branches = (list: Edge[]): Edge[][] => {
    const k = list.length <= FAN ? list.length : Math.min(FAN, Math.ceil(list.length / FAN));
    const base = Math.floor(list.length / k);
    const extra = list.length % k;
    const parts: Edge[][] = [];
    for (let j = 0, at = 0; j < k; j++) {
      const size = base + (j < extra ? 1 : 0);
      parts.push(list.slice(at, at + size));
      at += size;
    }
    return parts;
  };
  // Splitters: one output going to several places. A balanced tree, as on the Manual floor: no belt waits on a chain of them.
  const split = (feed: string, list: Edge[], item: string, kind: LogisticNodeData['kind']) => {
    const id = logistic(kind, item, total(list), false);
    edges.push(make(feed, id, item, total(list)));
    for (const part of branches(list)) {
      if (part.length === 1) edges.push(make(id, part[0].target, item, rateOf(part[0])));
      else split(id, part, item, kind);
    }
  };
  for (const list of group((e) => `${e.source}|${itemOf(e)}`)) {
    const item = itemOf(list[0]);
    drop(list);
    split(
      list[0].source,
      [...list].sort((a, b) => rateOf(b) - rateOf(a)),
      item,
      pipe(item) ? 'junction' : 'splitter',
    );
  }
  // Mergers: several belts into one input, the same tree the other way round.
  const merge = (into: string, list: Edge[], item: string, kind: LogisticNodeData['kind']) => {
    const id = logistic(kind, item, total(list), true);
    edges.push(make(id, into, item, total(list)));
    for (const part of branches(list)) {
      if (part.length === 1) edges.push(make(part[0].source, id, item, rateOf(part[0])));
      else merge(id, part, item, kind);
    }
  };
  for (const list of group((e) => `${e.target}|${itemOf(e)}`)) {
    const item = itemOf(list[0]);
    drop(list);
    merge(
      list[0].target,
      [...list].sort((a, b) => rateOf(b) - rateOf(a)),
      item,
      pipe(item) ? 'junction' : 'merger',
    );
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
  /** The items on each machine card's ends, in order. */
  order: Map<string, { in: string[]; out: string[] }>;
  /** The end each belt of a machine card is on. */
  handles: Map<string, { source?: string; target?: string }>;
}

function place(nodes: Node[], edges: Edge[], dir: Direction, ranker: Ranker, opts: GraphOptions, chain?: Map<string, string[]>): Placement {
  try {
    return placeIn(nodes, edges, dir, ranker, opts, chain);
  } catch (e) {
    // dagre cannot always find where a belt leaves a cluster; the chains are then left to the layers like any other machines.
    if (!chain) throw e;
    return placeIn(nodes, edges, dir, ranker, opts);
  }
}

function placeIn(
  nodes: Node[],
  edges: Edge[],
  dir: Direction,
  ranker: Ranker,
  opts: GraphOptions,
  chain?: Map<string, string[]>,
): Placement {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: !!chain });
  const gap = (opts.scale ?? 1) * (opts.spacing ?? 1);
  const label = scaled(LABEL, opts.text ?? 1);
  g.setGraph({ rankdir: dir, ranker, nodesep: SPACING[dir].nodesep * gap, ranksep: SPACING[dir].ranksep * gap, marginx: 30, marginy: 30 });
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  // A product chain is a cluster of its own, so its machines stand together and not spread over the layers.
  for (const [root, ids] of chain ?? []) {
    g.setNode(`chain:${root}`, {});
    for (const id of ids) g.setParent(id, `chain:${root}`);
  }
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
  const order = orderEnds(nodes, edges, pos, dir);
  const handles = endsOfBelts(edges, order);
  const ends = endsFor(nodes, edges, order, dir, opts.scale ?? 1);
  return { dir, pos, routes, width, height, crossings: crossings(nodes, edges, pos, dir, ends, handles), order, handles };
}

/** Gives every belt its square route: dagre's bends made straight runs, belts of different lines kept in lanes of their own. */
function squareUp(nodes: Node[], edges: Edge[], dir: Direction, text: number) {
  const size = new Map(nodes.map((n) => [n.id, { w: n.width ?? 0, h: n.height ?? 0 }]));
  const pos = new Map(nodes.map((n) => [n.id, n.position]));
  const ends = new Map(nodes.map((n) => [n.id, (n.data as MachineNodeData).ends]));
  // Where a belt leaves or reaches a node: the end of the card it is on, or the middle of the side.
  const out = (e: Edge): Point =>
    meet(
      pos.get(e.source)!,
      size.get(e.source)!,
      dir,
      'out',
      ends.get(e.source)?.out.find((x) => x.id === e.sourceHandle),
    );
  const into = (e: Edge): Point =>
    meet(
      pos.get(e.target)!,
      size.get(e.target)!,
      dir,
      'in',
      ends.get(e.target)?.in.find((x) => x.id === e.targetHandle),
    );
  const flow = edges.filter((e) => e.type === 'flow' && (e.data as FlowEdgeData).route && !(e.data as FlowEdgeData).route!.loop);
  const bends = squareBends(
    flow.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      from: out(e),
      to: into(e),
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
function placeLabels(nodes: Node[], flow: Edge[], dir: Direction, out: (e: Edge) => Point, into: (e: Edge) => Point, text: number) {
  const box = { w: LABEL_BOX.width * text, h: LABEL_BOX.height * text };
  const cards: Rect[] = nodes.map((n) => ({ x: n.position.x - 4, y: n.position.y - 4, w: (n.width ?? 0) + 8, h: (n.height ?? 0) + 8 }));
  const taken: Rect[] = [];
  const AT = [0.5, 0.3, 0.7, 0.15, 0.85];
  for (const e of flow) {
    const route = (e.data as FlowEdgeData).route!;
    if (!route.square) continue;
    const { runs } = squarePath(out(e), route.square, into(e), dir === 'TB');
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
function crossings(
  nodes: Node[],
  edges: Edge[],
  pos: Map<string, Point>,
  dir: Direction,
  ends: Map<string, CardEnds>,
  handles: Map<string, { source?: string; target?: string }>,
): number {
  const size = new Map(nodes.map((n) => [n.id, { w: n.width ?? 0, h: n.height ?? 0 }]));
  const lines = edges.map((e) => {
    const h = handles.get(e.id);
    return {
      e,
      h,
      a: meet(
        pos.get(e.source)!,
        size.get(e.source)!,
        dir,
        'out',
        ends.get(e.source)?.out.find((x) => x.id === h?.source),
      ),
      b: meet(
        pos.get(e.target)!,
        size.get(e.target)!,
        dir,
        'in',
        ends.get(e.target)?.in.find((x) => x.id === h?.target),
      ),
    };
  });
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[i];
      const m = lines[j];
      // Belts on the same end of a card meet there, they do not cross.
      if (l.e.source === m.e.source && l.h?.source === m.h?.source) continue;
      if (l.e.target === m.e.target && l.h?.target === m.h?.target) continue;
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
function choose(nodes: Node[], edges: Edge[], opts: GraphOptions): Placement {
  const { box } = opts;
  const natural: Direction = box && box.height > box.width ? 'TB' : 'LR';
  const best = bestPerDirection(nodes, edges, opts);
  const fit = (p: Placement) => (box ? Math.min(box.width / p.width, box.height / p.height) : 1);
  return best.reduce((a, b) => {
    const [x, y] = a.dir === natural ? [a, b] : [b, a];
    return fit(y) > fit(x) * 1.2 ? y : x;
  });
}

/** The fewest crossing placement in each direction the layout may take. */
function bestPerDirection(nodes: Node[], edges: Edge[], opts: GraphOptions): Placement[] {
  const { dir, box } = opts;
  const chain = opts.consumers ? undefined : chains(nodes, edges);
  const dirs: Direction[] = dir ? [dir] : box ? ['LR', 'TB'] : ['LR'];
  // What these are made from: the nodes (ids and sizes), the belts between them and the options that shape the layout.
  // The screen's size isn't part of it, as it only decides between the directions afterwards. Changing a number leaves all of this as it was.
  const key = [
    dirs.join(),
    opts.scale ?? 1,
    opts.spacing ?? 1,
    opts.text ?? 1,
    nodes.map((n) => `${n.id}:${n.width}x${n.height}`).join(','),
    edges.map((e) => `${e.id}>${e.source}>${e.target}`).join(','),
    [...(chain ?? [])].map(([root, ids]) => `${root}=${ids.join('+')}`).join(','),
  ].join('|');
  const hit = placements.get(key);
  if (hit) return hit;
  const made = dirs.map((d) =>
    RANKERS.map((r) => place(nodes, edges, d, r, opts, chain)).reduce((a, b) => (b.crossings < a.crossings ? b : a)),
  );
  placements.set(key, made);
  if (placements.size > MAX_PLACEMENTS) placements.delete(placements.keys().next().value as string);
  return made;
}

/** Placements already made, by everything they are made from. */
const placements = new Map<string, Placement[]>();
const MAX_PLACEMENTS = 64;

export function forgetPlacements() {
  placements.clear();
}

/** Puts the nodes and belt routes where the chosen placement has them, then runs the returning and square belts round them. */
function layout(nodes: Node[], edges: Edge[], opts: GraphOptions): Direction {
  const pick = choose(nodes, edges, opts);
  for (const n of nodes) n.position = { ...pick.pos.get(n.id)! };
  // Every machine card's ends, and the belts on them, before the belts are routed to them.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const [id, ends] of endsFor(nodes, edges, pick.order, pick.dir, opts.scale ?? 1)) {
    const n = byId.get(id)!;
    n.data = { ...n.data, ends };
  }
  for (const e of edges) {
    const h = pick.handles.get(e.id);
    if (h?.source) e.sourceHandle = h.source;
    if (h?.target) e.targetHandle = h.target;
    const r = pick.routes.get(e.id)!;
    (e.data as FlowEdgeData | PowerEdgeData).route = {
      points: r.points.map((p) => ({ ...p })),
      label: { ...r.label },
      from: { ...pick.pos.get(e.source)! },
      to: { ...pick.pos.get(e.target)! },
    };
  }
  loopBack(nodes, edges, pick.dir, opts.text ?? 1);
  if (opts.squareBelts) squareUp(nodes, edges, pick.dir, opts.text ?? 1);
  return pick.dir;
}

/** How far a returning belt's first and last runs stand off the cards, and how far under the lowest card it runs, in floor units. */
const LOOP = { stub: 42, under: 46, lane: 62 };

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
  const ends = new Map(nodes.map((n) => [n.id, (n.data as MachineNodeData).ends]));
  const loops = edges
    .filter((e) => e.type === 'flow' && (e.data as FlowEdgeData).route)
    .map((e) => {
      const [s, t] = [box.get(e.source)!, box.get(e.target)!];
      // The ends of a machine card the belt is on, not the middle of its side.
      const [a, b] = [
        ends.get(e.source)?.out.find((x) => x.id === e.sourceHandle),
        ends.get(e.target)?.in.find((x) => x.id === e.targetHandle),
      ];
      return { e, from: [s.u + s.du, s.v + s.dv * (a?.at ?? 0.5)] as const, to: [t.u, t.v + t.dv * (b?.at ?? 0.5)] as const };
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
