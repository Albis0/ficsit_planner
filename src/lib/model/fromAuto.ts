import type { Edge } from '@xyflow/react';
import { data, transportFor } from '../data';
import { type ExtractionSettings, extractorFor } from '../extraction';
import { buildGraph, type EndpointNodeData, type FlowEdgeData, type MachineNodeData } from '../graph';
import type { SolveResult } from '../solver';
import { arrangeModel } from './arrange';
import { extractorRate, mediumOf } from './ports';
import { type MLink, type MNode, type Model, MODEL_VERSION } from './types';

/*
  A solved factory as a hand-built model, so the player starts from a working factory instead of an empty floor. Every
  card on the Auto floor becomes a node; every belt a link. Where one output feeds several machines a splitter goes
  in, and where several belts feed one input a merger, because in the game one end holds one belt. Raw inputs become
  a miner (or pump) per belt, sized to what that belt carries. Then the whole of it is laid out afresh, splitters,
  mergers and miners included, so every card has its place and every belt a route around the cards.
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

export async function modelFromSolve(result: SolveResult, tier: number, extraction: ExtractionSettings): Promise<Model> {
  const g = buildGraph(result, tier, { dir: 'LR', splitLines: 'each' });
  let seq = 1;
  const id = () => (seq++).toString(36);
  const nodes: MNode[] = [];
  const links: MLink[] = [];
  const byGraph = new Map<string, MNode>();
  // Where each card goes is worked out at the end, once every card is there.
  const at = { x: 0, y: 0 };

  // Machines, as many as get built at the clock they run at: 2.67 smelters at
  // 100% are 3 at 88.89%, as on the Auto card. Somersloops on a node go machine by machine, so an average across the
  // line rounds to the nearest whole one.
  for (const n of g.nodes) {
    if (n.type !== 'machine') continue;
    const { use } = n.data as MachineNodeData;
    if (use.recipe.kind === 'power') continue;
    const m: MNode = {
      id: id(),
      ...at,
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
  const fan = (edges: Edge[], end: End, item: string, side: 'split' | 'merge') => {
    const pipe = mediumOf(item) === 'pipe';
    const ends: End[] = [];
    const rates = edges.map((e) => (e.data as FlowEdgeData).rate);
    let feed = end;
    let left = edges.length;
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
        ...at,
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
      const ends = fan(edges, end, item, 'split');
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
      const ends = fan(edges, end, item, 'merge');
      for (const [i, e] of edges.entries()) targetOf.set(e.id, ends[i]);
    }
  }

  // Raw inputs, things brought in and outputs: one node per belt.
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
          ...at,
          k: 'extract',
          extractor: extractor.id,
          item,
          ...(purity !== 'normal' ? { purity } : {}),
          ...(count !== 1 ? { n: count } : {}),
          ...(Math.abs(each - 1) > 1e-12 ? { clock: each } : {}),
        };
      } else n = { id: id(), ...at, k: 'in', item, lim: rate, ...(d.kind === 'missing' ? { tag: 'bring' as const } : {}) };
      nodes.push(n);
      src = { node: n.id, port: 0 };
    }
    if (!dst && b.type === 'endpoint') {
      const d = b.data as EndpointNodeData;
      const n: MNode = { id: id(), ...at, k: 'out', item, ...(d.kind === 'surplus' ? { tag: 'spare' as const } : {}) };
      nodes.push(n);
      dst = { node: n.id, port: 0 };
    }
    if (!src || !dst) continue;
    links.push({ id: id(), a: src.node, ap: src.port, b: dst.node, bp: dst.port, ...line(item, rate, tier) });
  }
  return arrangeModel({ v: MODEL_VERSION, calc: 'basic', nodes, links, seq });
}
