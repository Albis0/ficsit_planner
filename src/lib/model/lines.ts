import { cardSize, endSpot, GRID, HALF } from './layout';
import { portsOf } from './ports';
import type { MLink, MNode } from './types';

export type Pt = { x: number; y: number };

/** A belt's bends and label spot, and the ends it leaves and reaches on a splitter or merger. */
export type Route = { pts: [number, number][]; lbl?: [number, number]; ap: number; bp: number };

/** A line of machines with the splitter tree above and the merger tree below it, laid out on its own and then moved as one. */
export interface Block {
  id: string;
  w: number;
  h: number;
  members: Set<string>;
  /** Where each card sits from the block's top left corner. */
  inner: Map<string, Pt>;
  /** The belts between them, with bends from the same corner. */
  routes: Map<string, Route>;
}

/**
 * Splitters, mergers and pipe junctions: any of their ends on a side does the same, so the engine may put them in the order that keeps belts
 * from crossing (the top output to the card highest up). Smart and programmable splitters keep theirs: each end has
 * its own rule.
 */
export const loose = (n: MNode) => n.k === 'logistic' && (n.kind === 'splitter' || n.kind === 'merger' || n.kind === 'junction');

interface Tree {
  nodes: string[];
  height: Map<string, number>;
  leaves: string[];
  side: 'split' | 'merge';
}

export interface Found {
  machines: string[];
  trees: Tree[];
}

/** Lines of machines that share splitter and merger trees. */
export function findGroups(nodes: MNode[], links: MLink[]): Found[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inL = new Map<string, MLink[]>();
  const outL = new Map<string, MLink[]>();
  for (const l of links) {
    inL.set(l.b, [...(inL.get(l.b) ?? []), l]);
    outL.set(l.a, [...(outL.get(l.a) ?? []), l]);
  }
  const nIn = (id: string) => inL.get(id)?.length ?? 0;
  const nOut = (id: string) => outL.get(id)?.length ?? 0;
  const lo = (id: string) => {
    const n = byId.get(id);
    return !!n && loose(n);
  };
  const isSplit = (id: string) => lo(id) && nIn(id) === 1 && nOut(id) >= 2;
  const isMerge = (id: string) => lo(id) && nOut(id) === 1 && nIn(id) >= 2;
  const tree = (root: string, side: 'split' | 'merge'): Tree => {
    const t: Tree = { nodes: [], height: new Map(), leaves: [], side };
    const walk = (id: string): number => {
      t.nodes.push(id);
      let h = 0;
      for (const l of (side === 'split' ? outL : inL).get(id) ?? []) {
        const next = side === 'split' ? l.b : l.a;
        if (side === 'split' ? isSplit(next) : isMerge(next)) h = Math.max(h, 1 + walk(next));
        else t.leaves.push(next);
      }
      t.height.set(id, h);
      return h;
    };
    walk(root);
    return t;
  };
  const trees: Tree[] = [];
  for (const n of nodes) {
    if (isSplit(n.id) && !isSplit(inL.get(n.id)![0].a)) trees.push(tree(n.id, 'split'));
    if (isMerge(n.id) && !isMerge(outL.get(n.id)![0].b)) trees.push(tree(n.id, 'merge'));
  }
  const good = trees.filter(
    (t) => t.leaves.length >= 2 && new Set(t.leaves).size === t.leaves.length && t.leaves.every((id) => byId.get(id)?.k === 'machine'),
  );
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    const p = parent.get(a) ?? a;
    if (p === a) return a;
    const r = find(p);
    parent.set(a, r);
    return r;
  };
  for (const t of good) for (const id of t.leaves) parent.set(find(id), find(t.leaves[0]));
  const groups = new Map<string, { machines: Set<string>; trees: Tree[] }>();
  for (const t of good) {
    const key = find(t.leaves[0]);
    const g = groups.get(key) ?? { machines: new Set<string>(), trees: [] };
    for (const id of t.leaves) g.machines.add(id);
    g.trees.push(t);
    groups.set(key, g);
  }
  // A belt from elsewhere to a machine, or from a machine to elsewhere, is fine on a side with no tree: it leaves the
  // line's edge. Where there is a tree it would have to cross it, so such a line is left to the general layout.
  const whole = [...groups.values()].filter((g) => {
    const mine = new Set<string>(g.machines);
    for (const t of g.trees) for (const id of t.nodes) mine.add(id);
    const split = g.trees.some((t) => t.side === 'split');
    const merge = g.trees.some((t) => t.side === 'merge');
    return links.every((l) => {
      if (mine.has(l.a) && mine.has(l.b)) return true;
      if (g.machines.has(l.b)) return !split;
      if (g.machines.has(l.a)) return !merge;
      return true;
    });
  });
  return whole.map((g) => ({ machines: [...g.machines], trees: g.trees }));
}

/**
 * One line laid out by hand: machines in a row, the splitter trees above and the merger trees below. A side with one
 * tree has each splitter centred over what it feeds; a side with several trees (two items going into one machine)
 * packs them side by side and runs every belt to its machine along a level of its own in the gap, so they never mix.
 */
export function layoutGroup(g: Found, all: Map<string, MNode>, links: MLink[], dir: 'LR' | 'TB'): Block {
  const down = dir === 'TB';
  const mem = new Set<string>(g.machines);
  for (const t of g.trees) for (const id of t.nodes) mem.add(id);
  const own = links.filter((l) => mem.has(l.a) && mem.has(l.b));
  const inL = new Map<string, MLink[]>();
  const outL = new Map<string, MLink[]>();
  for (const l of own) {
    inL.set(l.b, [...(inL.get(l.b) ?? []), l]);
    outL.set(l.a, [...(outL.get(l.a) ?? []), l]);
  }
  const node = (id: string) => all.get(id)!;
  const sizeA = (id: string) => (down ? cardSize(node(id), dir).w : cardSize(node(id), dir).h);
  const sizeF = (id: string) => (down ? cardSize(node(id), dir).h : cardSize(node(id), dir).w);
  const portA = (id: string, side: 'in' | 'out', i: number) => {
    const e = endSpot(node(id), side, i, dir);
    return down ? e.x : e.y;
  };
  const splits = g.trees.filter((t) => t.side === 'split');
  const merges = g.trees.filter((t) => t.side === 'merge');
  const kids = (t: Tree, id: string) =>
    (t.side === 'split'
      ? (outL.get(id) ?? []).slice().sort((x, y) => x.ap - y.ap)
      : (inL.get(id) ?? []).slice().sort((x, y) => x.bp - y.bp)
    ).map((l) => ({ l, id: t.side === 'split' ? l.b : l.a }));
  // Machines in the order the first tree reaches them.
  const first = splits[0] ?? merges[0];
  const order: string[] = [];
  const walk = (t: Tree, id: string) => {
    for (const k of kids(t, id)) {
      if (t.nodes.includes(k.id)) walk(t, k.id);
      else if (t === first) order.push(k.id);
    }
  };
  walk(first, first.nodes[0]);
  const idx = new Map(order.map((id, i) => [id, i]));
  const rest = g.machines.filter((id) => !idx.has(id));
  for (const id of rest) idx.set(id, idx.size);
  const rowOf = [...idx.keys()];
  const pitch = Math.max(...rowOf.map(sizeA)) + GRID * 2;
  const mA = new Map(rowOf.map((id) => [id, idx.get(id)! * pitch]));
  const Hm = Math.max(...rowOf.map(sizeF));
  // Labels are wider than a grid square: a floor running across needs the room between columns for them.
  const ROOM = down ? 0 : GRID * 4;
  const STEP = GRID * 3 + ROOM;
  const FZ = Math.max(...[...mem].filter((id) => !g.machines.includes(id)).map(sizeF), GRID * 2);

  /** Where each tree node's centre falls across the floor, and the levels each tree stands on. */
  const centre = new Map<string, number>();
  const place1 = (t: Tree) => {
    const side = t.side === 'split' ? 'in' : 'out';
    const attach = (k: { l: MLink; id: string }) => {
      if (t.nodes.includes(k.id)) {
        // The child's end facing this node.
        const facing = t.side === 'split' ? 'in' : 'out';
        return centre.get(k.id)! + portA(k.id, facing, 0) - sizeA(k.id) / 2;
      }
      return mA.get(k.id)! + portA(k.id, side, t.side === 'split' ? k.l.bp : k.l.ap);
    };
    const go = (id: string) => {
      const ks = kids(t, id);
      for (const k of ks) if (t.nodes.includes(k.id)) go(k.id);
      centre.set(id, ks.reduce((a, k) => a + attach(k), 0) / ks.length);
    };
    go(t.nodes[0]);
  };
  const lay = (ts: Tree[]) => {
    // Each tree centred over what it feeds; trees on one side that would meet are moved apart, side by side.
    for (const t of ts) place1(t);
    const placed: { id: string; h: number }[] = [];
    const shifts: [Tree, number][] = [];
    for (const t of [...ts].sort((x, y) => centre.get(x.nodes[0])! - centre.get(y.nodes[0])!)) {
      let by = 0;
      for (const v of t.nodes)
        for (const u of placed) {
          if (u.h !== t.height.get(v)) continue;
          const need = (sizeA(u.id) + sizeA(v)) / 2 + GRID;
          const d = centre.get(v)! - centre.get(u.id)!;
          if (d < need && d > -need) by = Math.max(by, need - d);
        }
      for (const v of t.nodes) {
        centre.set(v, centre.get(v)! + by);
        placed.push({ id: v, h: t.height.get(v)! });
      }
      shifts.push([t, by]);
    }
    const back = shifts.reduce((n, [, by]) => n + by, 0) / Math.max(1, shifts.length);
    for (const t of ts) for (const v of t.nodes) centre.set(v, centre.get(v)! - back);
  };
  lay(splits);
  lay(merges);

  const levels = (ts: Tree[]) => Math.max(0, ...ts.map((t) => (t.height.get(t.nodes[0]) ?? 0) + 1));
  const leafBelts = (ts: Tree[]) => ts.reduce((a, t) => a + t.leaves.length, 0);
  const chOf = (ts: Tree[]) =>
    ts.length === 0 ? 0 : ts.length === 1 ? GRID * 3 + ROOM : Math.ceil((GRID * 2 + (leafBelts(ts) + 1) * HALF + ROOM) / GRID) * GRID;
  const chIn = chOf(splits);
  const chOut = chOf(merges);
  const Din = splits.length ? chIn + levels(splits) * (FZ + STEP) - STEP + 0 : 0;
  const Fm = splits.length ? Din + 0 : 0;
  const fTop = new Map<string, number>();
  for (const id of rowOf) fTop.set(id, Fm);
  for (const t of splits) for (const [id, h] of t.height) fTop.set(id, Fm - chIn - h * (FZ + STEP) - sizeF(id));
  for (const t of merges) for (const [id, h] of t.height) fTop.set(id, Fm + Hm + chOut + h * (FZ + STEP));
  const Fend = merges.length ? Fm + Hm + chOut + levels(merges) * (FZ + STEP) - STEP : Fm + Hm;

  // Snap: left edges on the grid.
  const aLeft = new Map<string, number>();
  for (const id of rowOf) aLeft.set(id, mA.get(id)!);
  for (const [id, c] of centre) aLeft.set(id, Math.round((c - sizeA(id) / 2) / GRID) * GRID);
  let minA = Infinity;
  let maxA = -Infinity;
  for (const [id, a] of aLeft) {
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a + sizeA(id));
  }
  const inner = new Map<string, Pt>();
  for (const [id, a] of aLeft) {
    const f = fTop.get(id)!;
    inner.set(id, down ? { x: a - minA, y: f } : { x: f, y: a - minA });
  }
  const abs = (id: string, side: 'in' | 'out', i: number) => {
    const p = inner.get(id)!;
    const e = endSpot(node(id), side, i, dir);
    return { a: down ? p.x + e.x : p.y + e.y, f: down ? p.y + e.y : p.x + e.x };
  };
  const xy = (a: number, f: number): [number, number] => (down ? [a, f] : [f, a]);

  // Ends on each splitter or merger go in the order of the cards they reach, so its belts never cross.
  const apOf = new Map(own.map((l) => [l.id, l.ap]));
  const bpOf = new Map(own.map((l) => [l.id, l.bp]));
  for (const t of g.trees)
    for (const id of t.nodes) {
      const split = t.side === 'split';
      const ls = (split ? outL : inL).get(id) ?? [];
      const ends = (split ? portsOf(node(id)).outs : portsOf(node(id)).ins).length;
      const far = (l: MLink) => (split ? abs(l.b, 'in', l.bp).a : abs(l.a, 'out', l.ap).a);
      const sorted = ls.slice().sort((x, y) => far(x) - far(y));
      const use = sorted.length === 2 && ends === 3 ? [0, 2] : sorted.map((_, i) => i);
      for (const [i, l] of sorted.entries()) (split ? apOf : bpOf).set(l.id, use[i]);
    }

  const routes: Map<string, Route> = new Map();
  // Belts from the trees to the machines: one level each in the gap, ordered by where they go.
  const leafLinks = (ts: Tree[]) =>
    own.filter((l) =>
      ts.some((t) =>
        t.side === 'split' ? t.nodes.includes(l.a) && g.machines.includes(l.b) : t.nodes.includes(l.b) && g.machines.includes(l.a),
      ),
    );
  const level = new Map<string, number>();
  for (const ts of [splits, merges]) {
    if (ts.length < 2) continue;
    const ls = leafLinks(ts)
      .map((l) => ({ l, from: abs(l.a, 'out', apOf.get(l.id)!).a, to: abs(l.b, 'in', bpOf.get(l.id)!).a }))
      .sort((p, q) => p.to - q.to || p.from - q.from);
    for (const [k, p] of ls.entries()) level.set(p.l.id, k);
  }
  for (const l of own) {
    const P = abs(l.a, 'out', apOf.get(l.id)!);
    const Q = abs(l.b, 'in', bpOf.get(l.id)!);
    const k = level.get(l.id);
    let f: number;
    if (k === undefined) f = Math.round((P.f + Q.f) / 2 / HALF) * HALF;
    else if (splits.some((t) => t.nodes.includes(l.a))) f = Fm - chIn + GRID + k * HALF;
    else f = Fm + Hm + GRID + k * HALF;
    const pts: [number, number][] = Math.abs(P.a - Q.a) < 1 ? [] : [xy(P.a, f), xy(Q.a, f)];
    routes.set(l.id, { ap: apOf.get(l.id)!, bp: bpOf.get(l.id)!, pts });
  }
  const w = down ? maxA - minA : Fend;
  const h = down ? Fend : maxA - minA;
  // A spot for each belt's label along the belt, on no card and no other label, inside the block where it can be.
  type Box = { x: number; y: number; w: number; h: number };
  const hit = (p: Box, q: Box) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  const cards: Box[] = [...mem].map((id) => ({ ...inner.get(id)!, ...cardSize(node(id), dir) }));
  const taken: Box[] = [];
  const snapHalf = (v: number) => Math.round(v / HALF) * HALF;
  for (const l of own) {
    const r = routes.get(l.id)!;
    const P = abs(l.a, 'out', apOf.get(l.id)!);
    const Q = abs(l.b, 'in', bpOf.get(l.id)!);
    const line: Pt[] = [
      ...[P].map((p) => ({ x: xy(p.a, p.f)[0], y: xy(p.a, p.f)[1] })),
      ...r.pts.map(([x, y]) => ({ x, y })),
      ...[Q].map((p) => ({ x: xy(p.a, p.f)[0], y: xy(p.a, p.f)[1] })),
    ];
    // Points along the belt, those nearest its middle first.
    const spots: { at: Pt; away: number }[] = [];
    let run = 0;
    for (let i = 1; i < line.length; i++) {
      const [p, q] = [line[i - 1], line[i]];
      const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      for (let d = 0; d <= len; d += HALF) {
        const t = len ? d / len : 0;
        spots.push({ at: { x: snapHalf(p.x + (q.x - p.x) * t), y: snapHalf(p.y + (q.y - p.y) * t) }, away: run + d });
      }
      run += len;
    }
    spots.sort((p, q) => Math.abs(p.away - run / 2) - Math.abs(q.away - run / 2));
    const rect = (at: Pt): Box => ({ x: at.x - 80, y: at.y - 18, w: 160, h: 36 });
    const clear = (at: Pt) => !cards.some((c) => hit(rect(at), c)) && !taken.some((t) => hit(rect(at), t));
    const inside = (at: Pt) => rect(at).x >= 0 && rect(at).y >= 0 && rect(at).x + 160 <= w && rect(at).y + 36 <= h;
    const spot = (spots.find((p) => clear(p.at) && inside(p.at)) ?? spots.find((p) => clear(p.at)) ?? spots[0]).at;
    taken.push(rect(spot));
    r.lbl = [spot.x, spot.y];
  }
  return { id: '', w, h, members: mem, inner, routes };
}
