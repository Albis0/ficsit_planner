import { data, type Recipe, type Transport } from '../../data';
import { amplification } from '../../solver';
import { mediumOf, type Medium, type Ports, portAccepts, portsOf, runnerRecipe } from '../ports';
import { isPart, isRunner, type MLink, type MNode, type Model } from '../types';

/*
  A model turned into what the calculators work on: each part with its ends, each belt with what can arrive on it and
  what it carries at most, and which parts can ever start. All of it is plain data, the same for every calculator.
*/

export interface CNode {
  node: MNode;
  ports: Ports;
  /** Machines, generators and extractors: one machine at 100%. */
  recipe?: Recipe;
  /** Machines times clock: what the node does in 100% machines. */
  units: number;
  /** Somersloop output boost. */
  amp: number;
  inArcs: (Arc | undefined)[];
  outArcs: (Arc | undefined)[];
}

export interface Arc {
  index: number;
  link: MLink;
  from: CNode;
  to: CNode;
  /** Items that can turn up on it. */
  items: string[];
  medium: Medium;
  transport: Transport;
  /** Most it carries a minute: the belt or pipe, or less when the player set a limit. */
  cap: number;
  /** Brings its far end something that end can't take: the game's belt stops. */
  jam: boolean;
}

export interface Net {
  nodes: CNode[];
  arcs: Arc[];
  byId: Map<string, CNode>;
  /** Parts that can start running: fed from a source through parts that can start too. */
  started: Set<string>;
  drain: boolean;
}

/** The belt or pipe a link is: the one the player picked, or the best one unlocked. */
export function transportOf(medium: Medium, mk: number | undefined, tier: number): Transport {
  const all = medium === 'pipe' ? data.pipes : data.belts;
  if (mk !== undefined) return all[Math.min(all.length - 1, Math.max(0, mk))];
  return all.filter((t) => t.tier <= tier).at(-1) ?? all[0];
}

/** Which kind of line a link is: whatever its ends say, belt when neither does. */
export function linkMedium(fromPorts: Ports, toPorts: Ports, link: MLink): Medium {
  const a = fromPorts.outs[link.ap];
  const b = toPorts.ins[link.bp];
  return a?.medium ?? (a?.item ? mediumOf(a.item) : undefined) ?? b?.medium ?? (b?.item ? mediumOf(b.item) : undefined) ?? 'belt';
}

/** Parts that pass on whatever they get, so what can come out of them is everything that can go in. */
const passes = (n: MNode) => n.k === 'logistic' || (n.k === 'storage' && n.mode === 'pass');

export function compile(m: Model, tier: number): Net {
  const nodes: CNode[] = [];
  const byId = new Map<string, CNode>();
  for (const node of m.nodes) {
    if (!isPart(node)) continue;
    const ports = portsOf(node);
    const recipe = isRunner(node) ? runnerRecipe(node) : undefined;
    const n = isRunner(node) ? (node.n ?? 1) : 0;
    const clock = isRunner(node) ? (node.clock ?? 1) : 1;
    const amp = node.k === 'machine' && recipe ? amplification(recipe, { clock, sloops: node.sloops ?? 0 }) : 1;
    const c: CNode = {
      node,
      ports,
      recipe,
      units: n * clock,
      amp,
      inArcs: ports.ins.map(() => undefined),
      outArcs: ports.outs.map(() => undefined),
    };
    nodes.push(c);
    byId.set(node.id, c);
  }

  const arcs: Arc[] = [];
  for (const link of m.links) {
    const from = byId.get(link.a);
    const to = byId.get(link.b);
    if (!from || !to || !from.ports.outs[link.ap] || !to.ports.ins[link.bp]) continue;
    const medium = linkMedium(from.ports, to.ports, link);
    const transport = transportOf(medium, link.mk, tier);
    const arc: Arc = {
      index: arcs.length,
      link,
      from,
      to,
      items: [],
      medium,
      transport,
      cap: Math.min(transport.rate * (link.lanes ?? 1), link.lim ?? Number.POSITIVE_INFINITY),
      jam: false,
    };
    arcs.push(arc);
    from.outArcs[link.ap] = arc;
    to.inArcs[link.bp] = arc;
  }

  // What can arrive on each belt: a fixed item where the belt starts, otherwise whatever reaches the splitter,
  // merger or storage it leaves from, until nothing new turns up.
  const sets = arcs.map(() => new Set<string>());
  for (const a of arcs) {
    const item = a.from.ports.outs[a.link.ap].item;
    if (item) sets[a.index].add(item);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of nodes) {
      if (!passes(c.node)) continue;
      const incoming = new Set<string>();
      for (const a of c.inArcs) if (a) for (const i of sets[a.index]) incoming.add(i);
      for (const a of c.outArcs) {
        if (!a) continue;
        for (const i of incoming) {
          if (sets[a.index].has(i) || mediumOf(i) !== a.medium) continue;
          sets[a.index].add(i);
          grew = true;
        }
      }
    }
  }
  for (const a of arcs) {
    a.items = [...sets[a.index]].sort();
    const end = a.to.ports.ins[a.link.bp];
    a.jam = a.items.some((i) => !portAccepts(end, i));
  }

  // Which parts can start: sources do; a machine once every input has a working belt from a part that started; a
  // splitter, merger or output once any of its inputs does. A loop with nothing from outside never starts.
  const started = new Set<string>();
  const live = (a: Arc | undefined) => !!a && !a.jam && a.items.length > 0 && started.has(a.from.node.id);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of nodes) {
      const id = c.node.id;
      if (started.has(id)) continue;
      const k = c.node.k;
      let go: boolean;
      if (k === 'in' || (k === 'storage' && c.node.mode === 'empty')) go = true;
      else if (isRunner(c.node)) go = !!c.recipe && c.inArcs.every(live);
      else if (k === 'unknown') go = false;
      else go = c.inArcs.some(live);
      if (go) {
        started.add(id);
        grew = true;
      }
    }
  }

  return { nodes, arcs, byId, started, drain: m.drain === true };
}

/** One machine's rate on each end at 100% and its node's clock, times the node's machines. */
export const fullIn = (c: CNode, p: number) => (c.recipe?.inputs[p]?.rate ?? 0) * c.units;
export const fullOut = (c: CNode, q: number) => (c.recipe?.outputs[q]?.rate ?? 0) * c.units * c.amp;

/** The item each item-carrying end of a node holds, for nodes that hold one. */
export const portItem = (c: CNode, side: 'in' | 'out', i: number) => (side === 'in' ? c.ports.ins[i] : c.ports.outs[i])?.item;

/** Whether an item is a fluid, for the m³ units. */
export const isFluid = (item: string) => data.items[item]?.form !== 'solid';
