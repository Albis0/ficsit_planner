import { data, generatorById, recipeById } from '../data';
import { PURITIES, type Purity } from '../extraction';
import { plantValid } from '../power';
import { extractorById, portsOf } from './ports';
import {
  CALC_MODES,
  type CalcMode,
  LOGISTIC_KINDS,
  type LineStyle,
  type LogisticKind,
  type MLink,
  type MNode,
  type Model,
  MODEL_VERSION,
  type OutRule,
  type StorageMode,
} from './types';

/*
  A hand-built model comes from a save, a backup, a shared link or a report, so it's cleaned like the rest of a plan:
  only what has the right shape stays. A node whose recipe or building left the game becomes an "unknown" node that
  keeps its belts, so an update never quietly deletes work done by hand. Cleaning twice gives the same model.
*/

type Loose = Record<string, unknown>;
const obj = (x: unknown): Loose => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Loose) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const within = (x: unknown, lo: number, hi: number, fallback: number) => (finite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
const oneOf = <T extends string>(x: unknown, options: readonly T[], fallback: T): T => (options.includes(x as T) ? (x as T) : fallback);
const str = (x: unknown, max: number) => (typeof x === 'string' && x ? x.slice(0, max) : undefined);

export const MAX_NODES = 5000;
export const MAX_LINKS = 10000;
const COORD = 1e6;
const MAX_RATE = 1e7;
/** Machines on one node, which is plenty for anything the game can hold. */
export const MAX_COUNT = 1e5;

/** Optional numbers are left out at their default, so a cleaned model reads the same every time. */
const opt = <K extends string>(key: K, value: number | undefined, fallback: number): Partial<Record<K, number>> =>
  value === undefined || Math.abs(value - fallback) < 1e-12 ? {} : ({ [key]: value } as Record<K, number>);

const rate = (x: unknown) => (finite(x) && x >= 0 ? Math.min(MAX_RATE, x) : undefined);
/** Machines on a node: at least a sliver of one (1% of a machine), so a node never stands for nothing. */
const count = (x: unknown) => (finite(x) && x > 0 ? Math.min(MAX_COUNT, Math.max(0.01, x)) : undefined);
const clock = (x: unknown) => (finite(x) && x > 0 ? Math.min(2.5, Math.max(0.01, x)) : undefined);

function rules(x: unknown): OutRule[] | undefined {
  const out = list(x)
    .slice(0, 3)
    .map((r): OutRule => {
      const o = obj(r);
      if (o.any === true) return { any: true };
      if (o.undef === true) return { undef: true };
      if (o.over === true) return { over: true };
      if (Array.isArray(o.items)) {
        const items = [...new Set(o.items.filter((i): i is string => typeof i === 'string' && !!data.items[i]))].slice(0, 64);
        if (items.length) return { items };
      }
      return { none: true };
    });
  return out.length ? out : undefined;
}

/** A node as saved, or undefined when it isn't one. Ports of unknown nodes are filled in from the links later. */
function node(x: unknown): MNode | undefined {
  const o = obj(x);
  const id = str(o.id, 12);
  if (!id) return undefined;
  const base = {
    id,
    x: Math.round(within(o.x, -COORD, COORD, 0)),
    y: Math.round(within(o.y, -COORD, COORD, 0)),
    ...(o.done === true ? { done: true as const } : {}),
    ...(str(o.label, 60) ? { label: str(o.label, 60) } : {}),
  };
  const unknown = (was: string): MNode => ({ ...base, k: 'unknown', was: was.slice(0, 80), ins: 0, outs: 0 });
  switch (o.k) {
    case 'machine': {
      const recipe = recipeById.get(o.recipe as string);
      if (!recipe || recipe.kind === 'power') return unknown(String(o.recipe ?? ''));
      const slots = data.machines[recipe.machine]?.somersloopSlots ?? 0;
      const sloops = finite(o.sloops) ? Math.min(slots, Math.max(0, Math.round(o.sloops))) : 0;
      return {
        ...base,
        k: 'machine',
        recipe: recipe.id,
        ...(o.auto === true ? { auto: true as const } : opt('n', count(o.n), 1)),
        ...opt('clock', clock(o.clock), 1),
        ...opt('sloops', sloops, 0),
      };
    }
    case 'gen': {
      const generator = String(o.generator ?? '');
      const fuel = String(o.fuel ?? '');
      if (!generatorById.has(generator) || !plantValid({ id: '', generator, fuel, by: 'count', amount: 1, clock: 1 }))
        return unknown(generator);
      return { ...base, k: 'gen', generator, fuel, ...opt('n', count(o.n), 1), ...opt('clock', clock(o.clock), 1) };
    }
    case 'extract': {
      const e = extractorById.get(o.extractor as string);
      const item = String(o.item ?? '');
      const fits = e && data.items[item]?.raw && (e.resources.length ? e.resources.includes(item) : data.items[item].form === 'solid');
      if (!e || !fits) return unknown(String(o.extractor ?? ''));
      const purity = e.purity ? oneOf<Purity>(o.purity, PURITIES, 'normal') : 'normal';
      return {
        ...base,
        k: 'extract',
        extractor: e.id,
        item,
        ...(purity !== 'normal' ? { purity } : {}),
        ...opt('n', count(o.n), 1),
        ...opt('clock', clock(o.clock), 1),
      };
    }
    case 'in':
    case 'out': {
      const item = typeof o.item === 'string' && data.items[o.item] ? o.item : undefined;
      // Something coming in has to be something.
      if (o.k === 'in' && !item) return undefined;
      const lim = rate(o.lim);
      const tag = o.k === 'out' ? (o.tag === 'spare' ? 'spare' : undefined) : o.tag === 'bring' ? 'bring' : undefined;
      const from = o.k === 'in' && typeof o.from === 'string' && o.from ? o.from : undefined;
      return {
        ...base,
        k: o.k,
        ...(item ? { item } : {}),
        ...(lim !== undefined ? { lim } : {}),
        ...(tag ? { tag } : {}),
        ...(from ? { from } : {}),
      };
    }
    case 'logistic': {
      const kind = oneOf<LogisticKind>(o.kind, LOGISTIC_KINDS, 'splitter');
      const r = kind === 'smart' || kind === 'prog' ? rules(o.rules) : undefined;
      return {
        ...base,
        k: 'logistic',
        kind,
        ...(r ? { rules: r } : {}),
        ...(kind === 'junction' ? opt('ins', Math.round(within(o.ins, 1, 3, 1)), 1) : {}),
      };
    }
    case 'sink':
      return { ...base, k: 'sink' };
    case 'storage': {
      const mode = oneOf<StorageMode>(o.mode, ['fill', 'empty', 'pass'], 'fill');
      const item = typeof o.item === 'string' && data.items[o.item] ? o.item : undefined;
      const lim = rate(o.lim);
      return { ...base, k: 'storage', mode, ...(item ? { item } : {}), ...(lim !== undefined ? { lim } : {}) };
    }
    case 'note':
      return {
        ...base,
        k: 'note',
        text: typeof o.text === 'string' ? o.text.slice(0, 2000) : '',
        w: Math.round(within(o.w, 80, 4000, 240)),
        h: Math.round(within(o.h, 40, 4000, 120)),
      };
    case 'group':
      return { ...base, k: 'group', w: Math.round(within(o.w, 80, 20000, 600)), h: Math.round(within(o.h, 80, 20000, 400)) };
    case 'unknown':
      return {
        ...base,
        k: 'unknown',
        was: typeof o.was === 'string' ? o.was.slice(0, 80) : '',
        ins: Math.round(within(o.ins, 0, 8, 0)),
        outs: Math.round(within(o.outs, 0, 8, 0)),
      };
    default:
      return undefined;
  }
}

/** Belt bends: pairs of whole numbers on the floor, a few dozen at most. */
function bends(x: unknown): [number, number][] | undefined {
  const pts = list(x)
    .slice(0, 50)
    .flatMap((p) =>
      Array.isArray(p) && finite(p[0]) && finite(p[1])
        ? [[Math.round(within(p[0], -COORD, COORD, 0)), Math.round(within(p[1], -COORD, COORD, 0))] as [number, number]]
        : [],
    );
  return pts.length ? pts : undefined;
}

/** The highest id in base 36, so new ones never clash. */
const idNumber = (id: string) => {
  const n = Number.parseInt(id, 36);
  return Number.isFinite(n) ? n : 0;
};

/** A hand-built model cleaned against the current game data; undefined when there's nothing usable in it. */
export function cleanModel(saved: unknown): Model | undefined {
  const m = obj(saved);
  if (m.v !== undefined && m.v !== MODEL_VERSION) return undefined;
  const nodes: MNode[] = [];
  const ids = new Set<string>();
  for (const x of list(m.nodes)) {
    if (nodes.length >= MAX_NODES) break;
    const n = node(x);
    if (!n || ids.has(n.id)) continue;
    ids.add(n.id);
    nodes.push(n);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Unknown nodes keep as many ends as their belts use.
  const raw = list(m.links).map(obj);
  for (const l of raw) {
    const a = byId.get(l.a as string);
    const b = byId.get(l.b as string);
    if (a?.k === 'unknown' && finite(l.ap) && l.ap >= 0 && l.ap < 8) a.outs = Math.max(a.outs, Math.round(l.ap) + 1);
    if (b?.k === 'unknown' && finite(l.bp) && l.bp >= 0 && l.bp < 8) b.ins = Math.max(b.ins, Math.round(l.bp) + 1);
  }

  const ports = new Map(nodes.map((n) => [n.id, portsOf(n)]));
  const links: MLink[] = [];
  const linkIds = new Set<string>();
  const taken = new Set<string>();
  for (const l of raw) {
    if (links.length >= MAX_LINKS) break;
    const id = str(l.id, 12);
    const a = str(l.a, 12);
    const b = str(l.b, 12);
    if (!id || !a || !b || linkIds.has(id) || !finite(l.ap) || !finite(l.bp)) continue;
    const ap = Math.round(l.ap);
    const bp = Math.round(l.bp);
    const from = ports.get(a);
    const to = ports.get(b);
    if (!from || !to || ap < 0 || bp < 0 || ap >= from.outs.length || bp >= to.ins.length) continue;
    // One belt per end, as in the game.
    if (taken.has(`${a}>${ap}`) || taken.has(`${b}<${bp}`)) continue;
    taken.add(`${a}>${ap}`);
    taken.add(`${b}<${bp}`);
    linkIds.add(id);
    const lim = rate(l.lim);
    const pts = bends(l.pts);
    const lbl = bends([l.lbl])?.[0];
    const line = oneOf<LineStyle | ''>(l.line, ['curve', 'straight', 'step', ''], '');
    links.push({
      id,
      a,
      ap,
      b,
      bp,
      ...(finite(l.mk) ? { mk: Math.round(within(l.mk, 0, 9, 0)) } : {}),
      ...(finite(l.lanes) && Math.round(l.lanes) > 1 ? { lanes: Math.round(Math.min(99, l.lanes)) } : {}),
      ...(lim !== undefined ? { lim } : {}),
      ...(pts ? { pts } : {}),
      ...(lbl ? { lbl } : {}),
      ...(line && line !== 'step' ? { line } : {}),
    });
  }
  if (nodes.length === 0) return undefined;
  const top = Math.max(0, ...nodes.map((n) => idNumber(n.id)), ...links.map((l) => idNumber(l.id)));
  return {
    v: MODEL_VERSION,
    calc: oneOf<CalcMode>(m.calc, CALC_MODES, 'basic'),
    nodes,
    links,
    seq: Math.max(top + 1, Math.round(within(m.seq, 1, 1e9, 1))),
    ...(m.stall === true ? { stall: true as const } : {}),
    ...(m.dir === 'TB' ? { dir: 'TB' as const } : {}),
  };
}
