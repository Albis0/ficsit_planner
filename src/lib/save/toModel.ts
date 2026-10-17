import names from '../../data/world-names.json';
import { data, generatorById, recipeById } from '../data';
import { PURITIES } from '../extraction';
import { portsOf } from '../model/ports';
import { cleanModel } from '../model/sanitize';
import { emptyModel, type LogisticKind, type MLink, type MNode, type Model, MODEL_VERSION } from '../model/types';
import { NODES } from '../world';
import type { SaveBuilding, SaveLink } from './types';

/*
  Factories from a save as hand-built models: every building one card at its own clock, every run of belts or pipes
  between two of them one belt. The game's machines take any item on any input, so which of a card's ends a belt goes
  to is found from what flows on it: what the machines and miners upstream make, carried on through splitters and
  mergers, across the whole save, so a line coming in from another factory brings what is made over there. Lines that
  leave a factory become an input or an output card. What can't be drawn is counted, not made up.
*/

const LINE = new Set<SaveBuilding['kind']>(['belt', 'lift', 'pipe', 'pass', 'pump']);
const NODE = new Map(names.node.map((n, i) => [n, i]));
const WATER = 'Desc_Water_C';

/** One end of a joint: a building (or something the planner has no card for) and its port. */
type End = { b: string; port: string; pipe: boolean };

/** Each building's ports and what is on the other side of each. */
function connections(links: readonly SaveLink[]): Map<string, Map<string, End>> {
  const out = new Map<string, Map<string, End>>();
  const put = (a: string, ap: string, to: End) => {
    const has = out.get(a) ?? new Map<string, End>();
    has.set(ap, to);
    out.set(a, has);
  };
  for (const l of links) {
    put(l.a, l.ap, { b: l.b, port: l.bp, pipe: l.pipe });
    put(l.b, l.bp, { b: l.a, port: l.ap, pipe: l.pipe });
  }
  return out;
}

/** Belt and lift marks, pipe marks: the planner's index into its belts or pipes. */
const mkOf = (cls: string): number | undefined => {
  const belt = /^Build_Conveyor(Belt|Lift)Mk(\d)_C$/.exec(cls);
  if (belt) return Number(belt[2]) - 1;
  if (/^Build_Pipeline/.test(cls)) return /MK2/.test(cls) ? 1 : 0;
  return undefined;
};

type Side = 'in' | 'out' | '?';

/** Which way a port faces, from the building and the port's name; '?' for pipe junctions and fluid tanks, which go either way. */
function sideOf(b: SaveBuilding | undefined, port: string): Side {
  switch (b?.kind) {
    case 'extractor':
      return 'out';
    case 'sink':
      return 'in';
    case 'junction':
      return '?';
  }
  if (/^(Pipe)?Output/i.test(port)) return 'out';
  if (/^(Pipe)?Input/i.test(port)) return 'in';
  // A generator's water or fuel pipe.
  return b?.kind === 'generator' ? 'in' : '?';
}

/** The digit at the end of a port's name (Output2 is 2), for keeping a splitter's ends in their order. */
const digit = (port: string) => Number(/(\d+)$/.exec(port)?.[1] ?? 0);

const clocked = (b: SaveBuilding) => (b.clock !== undefined && Math.abs(b.clock - 1) > 1e-6 ? { clock: b.clock } : {});

type Card = MNode extends infer N ? (N extends MNode ? Omit<N, 'id' | 'x' | 'y'> : never) : never;

/** A building's card; 'skip' when the planner cannot draw it (no recipe, an event recipe); undefined when it has none (a battery). */
function cardOf(b: SaveBuilding): Card | 'skip' | undefined {
  switch (b.kind) {
    case 'machine': {
      const r = b.recipe ? recipeById.get(b.recipe) : undefined;
      if (!r || r.kind === 'power') return 'skip';
      const slots = data.machines[r.machine]?.somersloopSlots ?? 0;
      return { k: 'machine', recipe: r.id, ...clocked(b), ...(b.sloops && slots ? { sloops: Math.min(slots, b.sloops) } : {}) };
    }
    case 'extractor': {
      const node = b.node === undefined ? undefined : NODES[NODE.get(b.node) ?? -1];
      const item = node?.item ?? (b.cls === 'Build_WaterPump_C' ? WATER : undefined);
      if (!item) return 'skip';
      return {
        k: 'extract',
        extractor: b.cls,
        item,
        ...(node && node.purity !== 1 ? { purity: PURITIES[node.purity] } : {}),
        ...clocked(b),
      };
    }
    case 'generator': {
      const g = generatorById.get(b.cls);
      // Geothermal plants and the augmenter take no belts; they come in with the power circuits.
      if (g?.kind !== 'fuel' || !g.fuels.length) return undefined;
      const fuel = g.fuels.some((f) => f.item === b.fuel) ? b.fuel! : g.fuels[0].item;
      return { k: 'gen', generator: g.id, fuel, ...clocked(b) };
    }
    case 'splitter':
    case 'merger':
    case 'smart':
    case 'prog':
    case 'prio':
    case 'junction':
      return { k: 'logistic', kind: b.kind as LogisticKind };
    case 'storage':
      return { k: 'storage', mode: 'fill' };
    case 'sink':
      return { k: 'sink' };
    default:
      return undefined;
  }
}

/** A belt or pipe between two buildings, by the game's port names at its ends, before it is put onto cards' ends. */
type Arc = { a: string; ap: string; b: string; bp: string; pipe: boolean; mk?: number; items: Set<string>; need: Set<string> };

export type FloorFromSave = {
  model: Model;
  /** Buildings and belts the floor leaves out: machines with no recipe or an event one, belts onto ends a card does not have. */
  skipped: number;
};

/**
 * Each factory of a save (as `clusters` gives them) as a model, before it is laid out. The whole save goes in, so
 * lines between factories can be followed to what they carry.
 */
export function toModels(
  buildings: readonly SaveBuilding[],
  links: readonly SaveLink[],
  groups: readonly SaveBuilding[][],
): FloorFromSave[] {
  const all = new Map(buildings.map((b) => [b.id, b]));
  const joints = connections(links);
  const cards = new Map<string, Card>();
  const skip = new Set<string>();
  for (const b of buildings) {
    if (LINE.has(b.kind)) continue;
    const c = cardOf(b);
    if (c === 'skip') skip.add(b.id);
    else if (c) cards.set(b.id, c);
  }

  // Each run of belts or pipes from a card's port to the next building, or to whatever the planner has no card for.
  const runs = new Map<string, { from: End; to: End; mk?: number }>();
  for (const id of cards.keys()) {
    for (const [port, first] of joints.get(id) ?? []) {
      let at = first;
      let mk: number | undefined;
      let ok = true;
      for (let steps = 0; LINE.has(all.get(at.b)?.kind as SaveBuilding['kind']); steps++) {
        const m = mkOf(all.get(at.b)!.cls);
        if (m !== undefined) mk = mk === undefined ? m : Math.min(mk, m);
        const from = at;
        const next = [...(joints.get(at.b) ?? [])].find(([p]) => p !== from.port)?.[1];
        // A belt that ends in the air carries nothing anywhere.
        if (!next || steps > 100_000) {
          ok = false;
          break;
        }
        at = next;
      }
      if (!ok) continue;
      const key = [`${id}.${port}`, `${at.b}.${at.port}`].sort().join('|');
      if (!runs.has(key)) runs.set(key, { from: { b: id, port, pipe: first.pipe }, to: { ...at, pipe: first.pipe }, mk });
    }
  }

  // Which way each run goes. Runs between two ends that go either way are settled from the other runs on them.
  const arcs: Arc[] = [];
  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  const push = (a: End, b: End, mk?: number) => {
    arcs.push({ a: a.b, ap: a.port, b: b.b, bp: b.port, pipe: a.pipe, mk, items: new Set(), need: new Set() });
    outs.set(a.b, (outs.get(a.b) ?? 0) + 1);
    ins.set(b.b, (ins.get(b.b) ?? 0) + 1);
  };
  // Both ends say "out" (or both "in"): drawn neither way.
  const wrong: [string, string][] = [];
  const pending: { x: End; y: End; mk?: number }[] = [];
  for (const { from, to, mk } of runs.values()) {
    const sa = sideOf(all.get(from.b), from.port);
    const sb = sideOf(all.get(to.b), to.port);
    const forward = sa === 'out' || sb === 'in';
    const back = sa === 'in' || sb === 'out';
    if (forward && back) wrong.push([from.b, to.b]);
    else if (forward) push(from, to, mk);
    else if (back) push(to, from, mk);
    else pending.push({ x: from, y: to, mk });
  }
  // A junction or tank with lines only coming in sends the undecided ones out, and the other way round.
  const only = (id: string, side: 'in' | 'out') =>
    side === 'in' ? (ins.get(id) ?? 0) > 0 && !outs.get(id) : (outs.get(id) ?? 0) > 0 && !ins.get(id);
  for (let changed = true; changed && pending.length; ) {
    changed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const { x, y, mk } = pending[i];
      const xy = only(x.b, 'in') || only(y.b, 'out');
      const yx = only(y.b, 'in') || only(x.b, 'out');
      if (xy === yx) continue;
      if (xy) push(x, y, mk);
      else push(y, x, mk);
      pending.splice(i, 1);
      changed = true;
    }
  }
  for (const { x, y, mk } of pending) push(x, y, mk);

  const outOf = new Map<string, Arc[]>();
  const into = new Map<string, Arc[]>();
  const add = (m: Map<string, Arc[]>, id: string, r: Arc) => {
    const has = m.get(id);
    if (has) has.push(r);
    else m.set(id, [r]);
  };
  for (const r of arcs) {
    add(outOf, r.a, r);
    add(into, r.b, r);
  }
  const medium = (r: Arc) => (r.pipe ? 'pipe' : 'belt');
  // Lines by their port's name in the game, so the first belt output is the recipe's first solid product.
  const byName = (list: Arc[], port: (r: Arc) => string) =>
    [...list].sort((p, q) => port(p).localeCompare(port(q), 'en', { numeric: true }));
  const shape = new Map([...cards].map(([id, c]) => [id, portsOf({ ...c, id, x: 0, y: 0 } as MNode)]));

  // What flows on each line: what machines and miners make, carried through splitters, mergers, junctions and tanks.
  for (const [id, c] of cards) {
    if (c.k !== 'machine' && c.k !== 'extract' && c.k !== 'gen') continue;
    for (const m of ['belt', 'pipe'] as const) {
      const ports = shape.get(id)!.outs.filter((p) => p.medium === m);
      for (const [i, r] of byName(
        (outOf.get(id) ?? []).filter((r) => medium(r) === m),
        (r) => r.ap,
      ).entries()) {
        const item = ports[i]?.item;
        if (item) r.items.add(item);
      }
    }
  }
  const passes = (id: string) => {
    const k = cards.get(id)?.k;
    return k === 'logistic' || k === 'storage';
  };
  const through = [...cards.keys()].filter(passes);
  const flow = (from: Map<string, Arc[]>, to: Map<string, Arc[]>, key: 'items' | 'need') => {
    for (let round = 0, changed = true; changed && round < 500; round++) {
      changed = false;
      for (const id of through) {
        const come = new Set((from.get(id) ?? []).flatMap((r) => [...r[key]]));
        for (const r of to.get(id) ?? [])
          for (const i of come)
            if (!r[key].has(i)) {
              r[key].add(i);
              changed = true;
            }
      }
    }
  };
  flow(into, outOf, 'items');

  // Each line onto one of a card's ends: a machine's by what flows on it, the others' by the port's own number.
  const placed = new Map<Arc, { ap: number; bp: number }>();
  const put = (r: Arc, side: 'ap' | 'bp', v: number) => {
    const at = placed.get(r) ?? { ap: -1, bp: -1 };
    at[side] = v;
    placed.set(r, at);
  };
  for (const [id, c] of cards) {
    const ports = shape.get(id)!;
    const comes = into.get(id) ?? [];
    const goes = outOf.get(id) ?? [];
    if (c.k === 'machine' || c.k === 'gen' || c.k === 'extract') {
      for (const m of ['belt', 'pipe'] as const) {
        const free = ports.ins.map((p, i) => ({ p, i })).filter(({ p }) => p.medium === m);
        // Lines with a known item first, onto the end that takes it; then the rest onto what is left, in order.
        const mine = comes.filter((r) => medium(r) === m).sort((p, q) => Number(q.items.size > 0) - Number(p.items.size > 0));
        for (const r of mine) {
          if (!free.length) break;
          const k = Math.max(
            0,
            free.findIndex(({ p }) => p.item && r.items.has(p.item)),
          );
          put(r, 'bp', free[k].i);
          const item = free[k].p.item;
          if (item) r.need.add(item);
          free.splice(k, 1);
        }
        const out = ports.outs.map((p, i) => ({ p, i })).filter(({ p }) => p.medium === m);
        for (const [i, r] of byName(
          goes.filter((r) => medium(r) === m),
          (r) => r.ap,
        ).entries())
          if (out[i]) put(r, 'ap', out[i].i);
      }
      continue;
    }
    if (c.k === 'logistic' && c.kind === 'junction') {
      const n = Math.min(3, Math.max(1, comes.length));
      cards.set(id, { ...c, ...(n > 1 ? { ins: n } : {}) });
      for (const [i, r] of comes.slice(0, n).entries()) put(r, 'bp', i);
      for (const [i, r] of goes.slice(0, 4 - n).entries()) put(r, 'ap', i);
      continue;
    }
    let now = ports;
    if (c.k === 'storage') {
      const mode = comes.length && goes.length ? 'pass' : goes.length ? 'empty' : 'fill';
      cards.set(id, { ...c, mode });
      now = portsOf({ ...c, mode, id, x: 0, y: 0 } as MNode);
    }
    // Splitters' and mergers' ends by their number in the game (Output1 is the first), then any left free.
    const spread = (list: Arc[], side: 'ap' | 'bp', count: number, port: (r: Arc) => string) => {
      const used = new Set<number>();
      const rest: Arc[] = [];
      for (const r of list) {
        const i = c.k === 'logistic' ? digit(port(r)) - 1 : 0;
        if (i >= 0 && i < count && !used.has(i)) {
          used.add(i);
          put(r, side, i);
        } else rest.push(r);
      }
      for (const r of rest) {
        const i = Array.from({ length: count }, (_, k) => k).find((k) => !used.has(k));
        if (i === undefined) break;
        used.add(i);
        put(r, side, i);
      }
    };
    spread(comes, 'bp', now.ins.length, (r) => r.bp);
    spread(goes, 'ap', now.outs.length, (r) => r.ap);
  }
  // What the machines need from each line, carried back up through splitters and mergers.
  flow(outOf, into, 'need');

  return groups.map((group) => {
    const members = new Set(group.map((b) => b.id));
    let skipped = group.filter((b) => skip.has(b.id)).length + wrong.filter(([x, y]) => members.has(x) || members.has(y)).length;
    let seq = 1;
    const newId = () => (seq++).toString(36);
    const nodes = new Map<string, MNode>();
    const local = new Map<string, string>();
    for (const b of group) {
      const c = cards.get(b.id);
      if (!c) continue;
      const id = newId();
      local.set(b.id, id);
      nodes.set(id, { ...c, id, x: 0, y: 0 } as MNode);
    }
    const out: MLink[] = [];
    const link = (a: string, ap: number, b: string, bp: number, mk?: number) =>
      out.push({ id: newId(), a, ap, b, bp, ...(mk !== undefined ? { mk } : {}) });
    const lines = new Set([...members].flatMap((id) => [...(outOf.get(id) ?? []), ...(into.get(id) ?? [])]));
    for (const r of lines) {
      const a = local.get(r.a);
      const b = local.get(r.b);
      const at = placed.get(r);
      // A building of this factory the floor does not draw (a machine with no recipe): the line has nowhere to go.
      if ((!a && members.has(r.a)) || (!b && members.has(r.b))) continue;
      if (a && b) {
        if (at && at.ap >= 0 && at.bp >= 0) link(a, at.ap, b, at.bp, r.mk);
        else skipped++;
        continue;
      }
      // A line leaving the factory: an output card, or an input card bringing what is needed downstream of it.
      if (a) {
        if (!at || at.ap < 0) {
          skipped++;
          continue;
        }
        const id = newId();
        nodes.set(id, { id, x: 0, y: 0, k: 'out', ...(r.items.size === 1 ? { item: [...r.items][0] } : {}) });
        link(a, at.ap, id, 0, r.mk);
      } else if (b) {
        const item = [...r.need][0] ?? [...r.items][0];
        if (!at || at.bp < 0 || !item) {
          skipped++;
          continue;
        }
        const id = newId();
        nodes.set(id, { id, x: 0, y: 0, k: 'in', item, tag: 'bring' });
        link(id, 0, b, at.bp, r.mk);
      }
    }
    for (const [bid, id] of local) {
      const n = nodes.get(id)!;
      if (n.k === 'storage' && n.mode === 'empty') {
        const item = (outOf.get(bid) ?? []).flatMap((r) => [...r.need])[0];
        if (item) n.item = item;
      }
    }
    const raw = { v: MODEL_VERSION, calc: 'basic', nodes: [...nodes.values()], links: out, seq };
    const model = cleanModel(raw) ?? emptyModel();
    skipped += out.length - model.links.length;
    return { model, skipped };
  });
}
