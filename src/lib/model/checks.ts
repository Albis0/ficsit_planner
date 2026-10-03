import { data, recipeById, recipeTier } from '../data';
import type { CalcResult } from './calc/result';
import { extractorById, portsOf } from './ports';
import { isPart, type Model } from './types';

/** Per end of a card: true where it needs a belt and has none. */
export interface OpenEnds {
  ins: boolean[];
  outs: boolean[];
}

/**
 * The ends left open that matter. A machine stops with an input or output open (an output only while open outputs
 * stop it, as in the game); a splitter's spare outputs and a merger's spare inputs are fine as in the game, as
 * long as one on each side is used.
 */
export function openEnds(m: Model): Map<string, OpenEnds> {
  const wired = new Map<string, OpenEnds>();
  for (const n of m.nodes) {
    if (!isPart(n)) continue;
    const p = portsOf(n);
    wired.set(n.id, { ins: p.ins.map(() => false), outs: p.outs.map(() => false) });
  }
  for (const l of m.links) {
    const a = wired.get(l.a);
    const b = wired.get(l.b);
    if (a && l.ap < a.outs.length) a.outs[l.ap] = true;
    if (b && l.bp < b.ins.length) b.ins[l.bp] = true;
  }
  const open = new Map<string, OpenEnds>();
  for (const n of m.nodes) {
    const w = wired.get(n.id);
    if (!w) continue;
    let ins = w.ins.map((x) => !x);
    let outs = w.outs.map((x) => !x);
    if (n.k === 'logistic') {
      // One belt on each side is enough.
      if (w.ins.some(Boolean)) ins = ins.map(() => false);
      if (w.outs.some(Boolean)) outs = outs.map(() => false);
    } else if (n.k === 'unknown') {
      ins = ins.map(() => false);
      outs = outs.map(() => false);
    } else if (!m.stall && (n.k === 'machine' || n.k === 'gen' || n.k === 'extract')) outs = outs.map(() => false);
    open.set(n.id, { ins, outs });
  }
  return open;
}

/** Cards with an end that needs a belt, in the order the line runs (left to right, then top to bottom). */
export function openCards(m: Model, open = openEnds(m)): string[] {
  return m.nodes
    .filter((n) => {
      const o = open.get(n.id);
      return !!o && (o.ins.some(Boolean) || o.outs.some(Boolean));
    })
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((n) => n.id);
}

/**
 * Where a card goes against the factory's side panel: its recipe turned off in Recipes, above the tier picked there,
 * or a resource mined past its limit in Resources (or past what the world has).
 */
export type Flag = { k: 'off' } | { k: 'tier'; tier: number } | { k: 'cap'; item: string; rate: number; cap: number; world?: true };

export interface FlagRules {
  tier: number;
  /** Recipes turned on in Recipes; unset leaves recipes alone. */
  on?: ReadonlySet<string>;
  /** Most of each resource a minute, from Resources. */
  caps?: Record<string, number>;
}

/** The cards that go against the side panel, and how. Nothing is changed or taken off the floor: the card says so. */
export function ruleFlags(m: Model, rules: FlagRules, calc?: CalcResult): Map<string, Flag> {
  const flags = new Map<string, Flag>();
  const mined = new Map<string, number>();
  for (const n of m.nodes) {
    if (n.k === 'machine') {
      const r = recipeById.get(n.recipe);
      if (!r) continue;
      const tier = recipeTier(r);
      if (tier > rules.tier) flags.set(n.id, { k: 'tier', tier });
      else if (rules.on && !rules.on.has(r.id)) flags.set(n.id, { k: 'off' });
    } else if (n.k === 'extract') {
      const e = extractorById.get(n.extractor);
      if (e && e.tier > rules.tier) flags.set(n.id, { k: 'tier', tier: e.tier });
      const c = calc?.nodes[n.id];
      if (c) mined.set(n.item, (mined.get(n.item) ?? 0) + (c.outs[0] ?? 0) + (c.spare?.[0] ?? 0));
    }
  }
  for (const [item, rate] of mined) {
    const own = rules.caps?.[item];
    const cap = own ?? data.worldLimits[item];
    if (cap == null || rate <= cap + 1e-6) continue;
    const flag: Flag = { k: 'cap', item, rate, cap, ...(own === undefined ? { world: true as const } : {}) };
    for (const n of m.nodes) if (n.k === 'extract' && n.item === item && !flags.has(n.id)) flags.set(n.id, flag);
  }
  return flags;
}
