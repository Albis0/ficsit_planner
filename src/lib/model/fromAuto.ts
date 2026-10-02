import type { Edge, Node } from '@xyflow/react';
import { data, transportFor } from '../data';
import { type ExtractionSettings, extractorFor } from '../extraction';
import { buildGraph, type EndpointNodeData, type FlowEdgeData, type MachineNodeData } from '../graph';
import type { SolveResult } from '../solver';
import { cardSize as sizeOf, GRID, snap } from './layout';
import { extractorRate, mediumOf } from './ports';
import { type MLink, type MNode, type Model, MODEL_VERSION } from './types';

/*
  A solved factory as a hand-built model, so the player starts from a working factory instead of an empty floor. Every
  card on the Auto floor becomes a node where it stood; every belt a link. Where one output feeds several machines a
  splitter goes in, and where several belts feed one input a merger, because in the game one end holds one belt.
  Raw inputs become a miner (or pump) per belt, sized to what that belt carries.
*/

/** Up to three outputs per splitter (three inputs per merger); more than that chains another one on. */
const FAN = 3;

/** The belt or pipe that carries a load, as its index in the game's list, and how many side by side. */
const line = (item: string, rate: number, tier: number): { mk: number; lanes?: number } => {
  const { transport, lanes } = transportFor(data.items[item], rate, tier);
  const all = mediumOf(item) === 'pipe' ? data.pipes : data.belts;
  return {
    mk: Math.max(
      0,
      all.findIndex((t) => t.id === transport.id),
    ),
    ...(lanes > 1 ? { lanes } : {}),
  };
};

export function modelFromSolve(result: SolveResult, tier: number, extraction: ExtractionSettings): Model {
  const g = buildGraph(result, tier, { dir: 'LR', splitLines: 'each' });
  let seq = 1;
  const id = () => (seq++).toString(36);
  const nodes: MNode[] = [];
  const links: MLink[] = [];
  const byGraph = new Map<string, MNode>();
  const at = (n: Node) => ({ x: snap(n.position.x), y: snap(n.position.y) });
  const box = (n: Node) => ({ w: n.width ?? 300, h: n.height ?? 120 });

  // Machines, where the Auto floor laid them out, as many as get built at the clock they run at: 2.67 smelters at
  // 100% are 3 at 88.89%, as on the Auto card. Somersloops on a node go machine by machine, so an average across the
  // line rounds to the nearest whole one.
  for (const n of g.nodes) {
    if (n.type !== 'machine') continue;
    const { use } = n.data as MachineNodeData;
    if (use.recipe.kind === 'power') continue;
    const m: MNode = {
      id: id(),
      ...at(n),
      k: 'machine',
      recipe: use.recipe.id,
      ...(use.built !== 1 ? { n: use.built } : {}),
      ...(Math.abs(use.clock - 1) > 1e-12 ? { clock: use.clock } : {}),
      ...(Math.round(use.mod.sloops) > 0 ? { sloops: Math.round(use.mod.sloops) } : {}),
    };
    nodes.push(m);
    byGraph.set(n.id, m);
  }

  const graphNode = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Edge[]>();
  const into = new Map<string, Edge[]>();
  for (const e of g.edges) {
    if (e.type !== 'flow') continue;
    const item = (e.data as FlowEdgeData).item;
    out.set(`${e.source}|${item}`, [...(out.get(`${e.source}|${item}`) ?? []), e]);
    into.set(`${e.target}|${item}`, [...(into.get(`${e.target}|${item}`) ?? []), e]);
  }

  /** A belt end: a node and which of its outputs (or inputs). */
  type End = { node: string; port: number };
  const sourceOf = new Map<string, End>();
  const targetOf = new Map<string, End>();

  const portOf = (m: MNode, item: string, side: 'in' | 'out') => {
    if (m.k !== 'machine') return 0;
    const r = data.recipes.find((x) => x.id === m.recipe);
    return Math.max(0, (side === 'in' ? r?.inputs : r?.outputs)?.findIndex((s) => s.item === item) ?? 0);
  };

  /** A splitter (or merger) chain for one end feeding (or fed by) several belts; returns an end per belt. */
  const fan = (edges: Edge[], end: End, item: string, side: 'split' | 'merge', near: { x: number; y: number; w: number; h: number }) => {
    const pipe = mediumOf(item) === 'pipe';
    const ends: End[] = [];
    const rates = edges.map((e) => (e.data as FlowEdgeData).rate);
    let feed = end;
    let left = edges.length;
    let step = 0;
    while (left > 0) {
      // This link carries every belt still to be handed out (or taken in) from here on.
      const lane = line(
        item,
        rates.slice(edges.length - left).reduce((a, b) => a + b, 0),
        tier,
      );
      const last = left <= FAN;
      const used = last ? left : FAN - 1;
      const kind = pipe ? 'junction' : side === 'split' ? 'splitter' : 'merger';
      const l: MNode = {
        id: id(),
        x: snap(side === 'split' ? near.x + near.w + 60 + step * 100 : near.x - 140 - step * 100),
        y: snap(near.y + near.h / 2 - 40 + step * 100),
        k: 'logistic',
        kind,
        ...(pipe && side === 'merge' ? { ins: 3 } : {}),
      };
      nodes.push(l);
      // The belt between the end and this splitter (or merger).
      if (side === 'split') links.push({ id: id(), a: feed.node, ap: feed.port, b: l.id, bp: 0, ...lane });
      else links.push({ id: id(), a: l.id, ap: 0, b: feed.node, bp: feed.port, ...lane });
      for (let i = 0; i < used; i++) ends.push({ node: l.id, port: i });
      left -= used;
      // The splitter's last output (merger's last input) carries on to the next one in the chain.
      feed = { node: l.id, port: FAN - 1 };
      step++;
    }
    return ends;
  };

  for (const [key, edges] of out) {
    const [from, item] = key.split('|');
    const m = byGraph.get(from);
    if (!m) continue;
    const end = { node: m.id, port: portOf(m, item, 'out') };
    if (edges.length === 1) sourceOf.set(edges[0].id, end);
    else {
      const n = graphNode.get(from)!;
      const ends = fan(edges, end, item, 'split', { ...at(n), ...box(n) });
      for (const [i, e] of edges.entries()) sourceOf.set(e.id, ends[i]);
    }
  }
  for (const [key, edges] of into) {
    const [to, item] = key.split('|');
    const m = byGraph.get(to);
    if (!m) continue;
    const end = { node: m.id, port: portOf(m, item, 'in') };
    if (edges.length === 1) targetOf.set(edges[0].id, end);
    else {
      const n = graphNode.get(to)!;
      const ends = fan(edges, end, item, 'merge', { ...at(n), ...box(n) });
      for (const [i, e] of edges.entries()) targetOf.set(e.id, ends[i]);
    }
  }

  const routes = new Map<MLink, { x: number; y: number }[]>();

  // Raw inputs, things brought in and outputs: one node per belt, the first where the Auto floor had the card.
  const stacked = new Map<string, number>();
  // Further copies go out past the edge of the floor (sources to the left, outputs to the right), away from the
  // belts running between the machines.
  const place = (n: Node, side: -1 | 1) => {
    const k = stacked.get(n.id) ?? 0;
    stacked.set(n.id, k + 1);
    return { x: snap(n.position.x + side * k * 360), y: snap(n.position.y) };
  };
  for (const e of g.edges) {
    if (e.type !== 'flow') continue;
    const { item, rate } = e.data as FlowEdgeData;
    const a = graphNode.get(e.source)!;
    const b = graphNode.get(e.target)!;
    let src = sourceOf.get(e.id);
    let dst = targetOf.get(e.id);
    if (!src && a.type === 'endpoint') {
      const d = a.data as EndpointNodeData;
      const extractor = d.kind === 'raw' ? extractorFor(item, extraction) : undefined;
      let n: MNode;
      if (extractor) {
        const clock = extraction.overclock?.[item] ?? extraction.clock;
        const purity = extractor.purity ? extraction.purity : 'normal';
        // As many as it takes at the set clock, each running a little under it so they make just this belt's load.
        const units = rate / extractorRate(extractor, purity);
        const count = Math.max(1, Math.ceil(units / clock - 1e-6));
        const each = units / count;
        n = {
          id: id(),
          ...place(a, -1),
          k: 'extract',
          extractor: extractor.id,
          item,
          ...(purity !== 'normal' ? { purity } : {}),
          ...(count !== 1 ? { n: count } : {}),
          ...(Math.abs(each - 1) > 1e-12 ? { clock: each } : {}),
        };
      } else n = { id: id(), ...place(a, -1), k: 'in', item, lim: rate, ...(d.kind === 'missing' ? { tag: 'bring' as const } : {}) };
      nodes.push(n);
      src = { node: n.id, port: 0 };
    }
    if (!dst && b.type === 'endpoint') {
      const d = b.data as EndpointNodeData;
      const n: MNode = { id: id(), ...place(b, 1), k: 'out', item, ...(d.kind === 'surplus' ? { tag: 'spare' as const } : {}) };
      nodes.push(n);
      dst = { node: n.id, port: 0 };
    }
    if (!src || !dst) continue;
    const link: MLink = { id: id(), a: src.node, ap: src.port, b: dst.node, bp: dst.port, ...line(item, rate, tier) };
    links.push(link);
    const route = (e.data as FlowEdgeData).route;
    if (route?.points.length) routes.set(link, route.points);
  }

  const moved = spread(nodes, new Set(byGraph.values()));

  // Each belt follows the Auto floor's route where it runs between its two cards: around the machines, with its
  // label in the gap kept for it. A belt from a splitter picks the route up past the splitter.
  const placed = new Map(nodes.map((n) => [n.id, n]));
  for (const [link, points] of routes) {
    const a = placed.get(link.a)!;
    const b = placed.get(link.b)!;
    if (moved.has(a.id) || moved.has(b.id)) continue;
    const from = a.x + sizeOf(a).w + 20;
    const to = b.x - 20;
    const pts = points.filter((p) => p.x > from && p.x < to).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]);
    if (pts.length) link.pts = pts;
  }
  return { v: MODEL_VERSION, calc: 'basic', nodes, links, seq };
}

/**
 * Cards the Auto floor didn't have (splitters, mergers, a second miner for one ore) are put down near where they
 * belong, then nudged down until they lie on nothing. The machines stay where the Auto floor laid them out.
 */
function spread(nodes: MNode[], fixed: Set<MNode>): Set<string> {
  const moved = new Set<string>();
  const GAP = 20;
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  const hits = (b: { x: number; y: number; w: number; h: number }) =>
    taken.some((t) => b.x < t.x + t.w + GAP && t.x < b.x + b.w + GAP && b.y < t.y + t.h + GAP && t.y < b.y + b.h + GAP);
  for (const n of nodes) if (fixed.has(n)) taken.push({ x: n.x, y: n.y, ...sizeOf(n) });
  for (const n of nodes) {
    if (fixed.has(n)) continue;
    const box = { x: n.x, y: n.y, ...sizeOf(n) };
    const start = box.y;
    while (hits(box)) box.y += GRID;
    if (box.y !== start) {
      n.y = box.y;
      moved.add(n.id);
    }
    taken.push(box);
  }
  return moved;
}
