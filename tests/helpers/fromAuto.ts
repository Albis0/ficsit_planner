import type { Edge, Node } from '@xyflow/react';
import { data, transportFor } from '../../src/lib/data';
import { type ExtractionSettings, extractorFor } from '../../src/lib/extraction';
import { buildGraph, type EndpointNodeData, type FlowEdgeData, type MachineNodeData } from '../../src/lib/graph';
import type { SolveResult, Target } from '../../src/lib/solver';
import { arrangeModel } from '../../src/lib/model/arrange';
import type { Dir } from '../../src/lib/model/layout';
import { extractorRate, mediumOf } from '../../src/lib/model/ports';
import { type MLink, type MNode, type Model, MODEL_VERSION } from '../../src/lib/model/types';

/*
  For tests: a solved factory as a hand-built model, a floor as big and as tangled as a player makes one. Every
  card on the Auto floor becomes a node; every belt a link. Where one output feeds several machines a splitter goes
  in, and where several belts feed one input a merger, because in the game one end holds one belt. Raw inputs become
  a miner (or pump) per belt, sized to what that belt carries. Then the whole of it is laid out afresh, splitters,
  mergers and miners included, so every card has its place and every belt a route around the cards.
*/

/** A rate without the noise of adding floats (50.00000000000001 is 50). */
const clean = (x: number) => Math.round(x * 1e9) / 1e9;

/** Up to three outputs per splitter (three inputs per merger); more than that goes into a tree of them. */
const FAN = 3;

/**
 * Belts and pipes are left to the load, so the line takes the slowest Mk that carries what it does and follows it when
 * a target changes. Only a load past the best one unlocked gets lines side by side.
 */
const line = (item: string, rate: number, tier: number): { lanes?: number } => {
  const { lanes } = transportFor(data.items[item], rate, tier);
  return lanes > 1 ? { lanes } : {};
};

type Graph = ReturnType<typeof buildGraph>;

/** Most cards one line may become, and most the floor may gain, when every building is a card of its own: the layout slows fast past a couple of hundred. */
const MOST_PER_LINE = 64;
const MOST_CARDS = 250;

/**
 * Every machine of a line as a card of its own (the "3 ×" card becomes three), each at its own clock and with its share
 * of what the line takes and gives. Where one belt reaches or leaves several of them the splitters and mergers come from
 * the same step that adds them for any belt feeding several machines; where several cards meet several (smelters into
 * constructors), the merger tree's root belt goes straight into the splitter tree's root, so it is merged once and split
 * once. A belt from a raw input or to an output stays one card however many buildings it feeds.
 */
function perBuilding(g: Graph): { graph: Graph; copies: Set<string>; buses: Map<string, string> } {
  const copies = new Set<string>();
  const buses = new Map<string, string>();
  const shares = new Map<string, { id: string; share: number }[]>();
  const kind = new Map(g.nodes.map((n) => [n.id, n.type]));
  let total = 0;
  const nodes: Node[] = g.nodes.flatMap((n) => {
    if (n.type !== 'machine') return [n];
    const { use } = n.data as MachineNodeData;
    const k = use.clocks.length;
    if (use.recipe.kind === 'power' || k < 2 || k > MOST_PER_LINE || total + k > MOST_CARDS) return [n];
    total += k;
    const sum = use.clocks.reduce((a, b) => a + b, 0);
    const parts = use.clocks.map((clock, i) => {
      const share = clock / sum;
      const id = `${n.id}#${i}`;
      copies.add(id);
      const scale = (list: Target[]) => list.map((x) => ({ ...x, rate: x.rate * share }));
      const own = {
        ...use,
        count: use.count * share,
        built: 1,
        clock,
        clocks: [clock],
        power: use.power * share,
        inputs: scale(use.inputs),
        outputs: scale(use.outputs),
      };
      return { id, share, node: { ...n, id, data: { ...n.data, use: own } } as Node };
    });
    shares.set(n.id, parts);
    return parts.map((p) => p.node);
  });
  const side = (id: string) => shares.get(id) ?? [{ id, share: 1 }];
  // What the copies of one machine give, over every belt leaving it: they are merged once, however many places it goes.
  const feeds = new Map<string, { edge: Edge; from: { id: string; share: number }[]; rate: number }>();
  const edges = g.edges.flatMap((e): Edge[] => {
    const a = side(e.source);
    const b = side(e.target);
    if (e.type !== 'flow' || a.length + b.length === 2) return [e];
    const { rate, item } = e.data as FlowEdgeData;
    const link = (id: string, source: string, target: string, r: number): Edge => ({
      ...e,
      id,
      source,
      target,
      // `group`: the belt of the line it goes to, so each line has splitters of its own under the one that shares between lines.
      data: { ...e.data, rate: r, group: e.id },
    });
    const bus = a.length > 1 || (b.length > 1 && kind.get(e.source) === 'endpoint');
    if (!bus) return a.flatMap((x) => b.map((y) => link(`${e.id}#${x.id}|${y.id}`, x.id, y.id, rate * x.share * y.share)));
    const mid = a.length > 1 ? `bus:${e.source}|${item}` : `bus:${e.id}`;
    if (!buses.has(mid)) {
      buses.set(mid, item);
      nodes.push({ id: mid, type: 'bus', position: { x: 0, y: 0 }, data: {} });
    }
    const onward = b.map((y) => link(`${e.id}#>${y.id}`, mid, y.id, rate * y.share));
    if (a.length === 1) return [link(`${e.id}#${a[0].id}>`, a[0].id, mid, rate), ...onward];
    const fed = feeds.get(mid);
    if (fed) fed.rate += rate;
    else feeds.set(mid, { edge: e, from: a, rate });
    return onward;
  });
  for (const [mid, { edge, from, rate }] of feeds)
    for (const x of from)
      edges.push({ ...edge, id: `${mid}#${x.id}>`, source: x.id, target: mid, data: { ...edge.data, rate: rate * x.share } });
  return { graph: { ...g, nodes, edges }, copies, buses };
}

export async function modelFromSolve(
  result: SolveResult,
  tier: number,
  extraction: ExtractionSettings,
  dir: Dir = 'LR',
  /** Each building a card of its own, instead of one card saying how many. */
  eachBuilding = false,
): Promise<Model> {
  const whole = buildGraph(result, tier, { dir: 'LR', splitLines: 'each' });
  const {
    graph: g,
    copies,
    buses,
  } = eachBuilding ? perBuilding(whole) : { graph: whole, copies: new Set<string>(), buses: new Map<string, string>() };
  let seq = 1;
  const id = () => (seq++).toString(36);
  const nodes: MNode[] = [];
  const links: MLink[] = [];
  const byGraph = new Map<string, MNode>();
  // Where each card goes is worked out at the end, once every card is there.
  const at = { x: 0, y: 0 };

  // Machines size themselves to what comes in, at the clock they run at on the Auto card (2.67 smelters at 100% are 3
  // at 88.89%), so a target set lower later takes fewer of them instead of running them all slower. Somersloops on a
  // node go machine by machine, so an average across the line rounds to the nearest whole one.
  for (const n of g.nodes) {
    if (n.type !== 'machine') continue;
    const { use } = n.data as MachineNodeData;
    if (use.recipe.kind === 'power') continue;
    const m: MNode = {
      id: id(),
      ...at,
      k: 'machine',
      recipe: use.recipe.id,
      ...(copies.has(n.id) ? {} : { auto: true as const }),
      ...(Math.abs(use.clock - 1) > 1e-12 ? { clock: Math.max(0.01, use.clock) } : {}),
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

  // A machine that feeds itself (Encased Uranium Cell takes back the acid it gives off) is shown on the Auto floor as what
  // it takes in net; the hand-built one needs the belt from its own output round to its own input, or it starves.
  const rounds: Edge[] = [];
  for (const n of g.nodes) {
    if (n.type !== 'machine') continue;
    const { use } = n.data as MachineNodeData;
    for (const o of use.outputs) {
      const gross = use.inputs.find((i) => i.item === o.item)?.rate ?? 0;
      if (gross <= 0) continue;
      const fed = (into.get(`${n.id}|${o.item}`) ?? []).reduce((a, e) => a + (e.data as FlowEdgeData).rate, 0);
      const back = Math.min(o.rate, gross - fed);
      if (back < 1e-6) continue;
      const e = { id: `round:${n.id}|${o.item}`, source: n.id, target: n.id, type: 'flow', data: { item: o.item, rate: back } } as Edge;
      rounds.push(e);
      out.set(`${n.id}|${o.item}`, [...(out.get(`${n.id}|${o.item}`) ?? []), e]);
      into.set(`${n.id}|${o.item}`, [...(into.get(`${n.id}|${o.item}`) ?? []), e]);
    }
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

  const tree = (edges: Edge[], item: string, side: 'split' | 'merge', feed?: End): { ends: End[]; root: End } => {
    const pipe = mediumOf(item) === 'pipe';
    const rates = edges.map((e) => (e.data as FlowEdgeData).rate);
    const ends: End[] = new Array(edges.length);
    const build = (from: number, to: number, up?: End): End => {
      const n = to - from;
      const k = n <= FAN ? n : Math.min(FAN, Math.ceil(n / FAN));
      const l: MNode = {
        id: id(),
        ...at,
        k: 'logistic',
        kind: pipe ? 'junction' : side === 'split' ? 'splitter' : 'merger',
        ...(pipe && side === 'merge' ? { ins: 3 } : {}),
      };
      nodes.push(l);
      const lane = line(
        item,
        rates.slice(from, to).reduce((a, b) => a + b, 0),
        tier,
      );
      if (up) {
        if (side === 'split') links.push({ id: id(), a: up.node, ap: up.port, b: l.id, bp: 0, ...lane });
        else links.push({ id: id(), a: l.id, ap: 0, b: up.node, bp: up.port, ...lane });
      }
      const base = Math.floor(n / k);
      const extra = n % k;
      let at2 = from;
      for (let j = 0; j < k; j++) {
        const size = base + (j < extra ? 1 : 0);
        if (size === 1) ends[at2] = { node: l.id, port: j };
        else build(at2, at2 + size, { node: l.id, port: j });
        at2 += size;
      }
      return { node: l.id, port: 0 };
    };
    const root = build(0, edges.length, feed);
    return { ends, root };
  };
  const fan = (edges: Edge[], end: End, item: string, side: 'split' | 'merge') => tree(edges, item, side, end).ends;

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

  for (const [mid, item] of buses) {
    const A = g.edges.filter((e) => e.type === 'flow' && e.target === mid);
    const B = g.edges.filter((e) => e.type === 'flow' && e.source === mid);
    const rate = (es: Edge[]) => es.reduce((n, e) => n + (e.data as FlowEdgeData).rate, 0);
    // The belts to one line go together; the line's own splitters share them out among its machines.
    const to = new Map<string, Edge[]>();
    for (const e of B) {
      const key = (e.data as { group?: string }).group ?? e.id;
      to.set(key, [...(to.get(key) ?? []), e]);
    }
    const lines = [...to.values()];
    const merge = A.length > 1 ? tree(A, item, 'merge') : undefined;
    if (merge) for (const [i, e] of A.entries()) targetOf.set(e.id, merge.ends[i]);
    const own = lines.map((es) => (es.length > 1 ? tree(es, item, 'split') : undefined));
    for (const [i, es] of lines.entries()) for (const [j, e] of es.entries()) if (own[i]) sourceOf.set(e.id, own[i]!.ends[j]);
    // Between several lines, one more splitter shares what comes out of the merger.
    const hub =
      lines.length > 1
        ? tree(
            lines.map((es) => ({ ...es[0], data: { ...es[0].data, rate: rate(es) } })),
            item,
            'split',
          )
        : undefined;
    for (const [i, es] of lines.entries()) {
      if (!hub) break;
      const at = hub.ends[i];
      if (own[i]) links.push({ id: id(), a: at.node, ap: at.port, b: own[i]!.root.node, bp: 0, ...line(item, rate(es), tier) });
      else sourceOf.set(es[0].id, at);
    }
    const entry = hub ? hub.root : own[0]?.root;
    if (merge && entry) links.push({ id: id(), a: merge.root.node, ap: 0, b: entry.node, bp: entry.port, ...line(item, rate(A), tier) });
    else if (merge) sourceOf.set(B[0].id, merge.root);
    else if (entry) targetOf.set(A[0].id, entry);
  }

  for (const e of rounds) {
    const src = sourceOf.get(e.id);
    const dst = targetOf.get(e.id);
    if (src && dst)
      links.push({
        id: id(),
        a: src.node,
        ap: src.port,
        b: dst.node,
        bp: dst.port,
        ...line((e.data as FlowEdgeData).item, (e.data as FlowEdgeData).rate, tier),
      });
  }

  // Things brought in or supplied come in on one card however many machines take them, split on from there; the Auto
  // floor has a card per belt, but the panel's Comes in list would show the same item over and over.
  const carried = new Map<string, Edge[]>();
  for (const e of g.edges) {
    if (e.type !== 'flow') continue;
    const a = graphNode.get(e.source)!;
    if (a.type !== 'endpoint') continue;
    const kind = (a.data as EndpointNodeData).kind;
    if (kind !== 'missing' && kind !== 'supply') continue;
    const key = `${kind}|${(e.data as FlowEdgeData).item}`;
    carried.set(key, [...(carried.get(key) ?? []), e]);
  }
  for (const [key, edges] of carried) {
    if (edges.length < 2) continue;
    const [kind, item] = key.split('|');
    const total = edges.reduce((s, e) => s + (e.data as FlowEdgeData).rate, 0);
    const n: MNode = { id: id(), ...at, k: 'in', item, lim: clean(total), ...(kind === 'missing' ? { tag: 'bring' as const } : {}) };
    nodes.push(n);
    const ends = fan(edges, { node: n.id, port: 0 }, item, 'split');
    for (const [i, e] of edges.entries()) sourceOf.set(e.id, ends[i]);
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
          // The game's slowest setting is 1%; a belt needing less than that just leaves the miner part busy.
          ...(Math.abs(each - 1) > 1e-12 ? { clock: Math.max(0.01, each) } : {}),
        };
      } else n = { id: id(), ...at, k: 'in', item, lim: clean(rate), ...(d.kind === 'missing' ? { tag: 'bring' as const } : {}) };
      nodes.push(n);
      src = { node: n.id, port: 0 };
    }
    if (!dst && b.type === 'endpoint') {
      const d = b.data as EndpointNodeData;
      // A product takes what the factory was solved for and no more, so machines sizing themselves share what comes in
      // as the solve did; what's left over takes whatever reaches it.
      const n: MNode = { id: id(), ...at, k: 'out', item, ...(d.kind === 'surplus' ? { tag: 'spare' as const } : { lim: rate }) };
      nodes.push(n);
      dst = { node: n.id, port: 0 };
    }
    if (!src || !dst) continue;
    links.push({ id: id(), a: src.node, ap: src.port, b: dst.node, bp: dst.port, ...line(item, rate, tier) });
  }
  return arrangeModel({ v: MODEL_VERSION, calc: 'basic', nodes, links, seq, ...(dir === 'TB' ? { dir } : {}) });
}
