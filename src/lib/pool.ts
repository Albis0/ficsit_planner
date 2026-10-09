import type { Plan, PowerPlan, Supply } from '../store';
import type { IoNode } from './model/types';
import type { Target } from './solver';

/** What a supply's `from` holds when it's taken from the shared pool: what every factory and plant leaves over, added up. */
export const POOL = 'pool';

/** One item in the shared pool: what the factories and plants leave over, what's taken from it, and what's still there. */
export interface PoolLine {
  item: string;
  made: number;
  taken: number;
  /** made less taken; below zero when more is taken than there is. */
  left: number;
}

const total = (lists: Target[][]) => {
  const sum = new Map<string, number>();
  for (const list of lists) for (const x of list) if (x.rate > 1e-9) sum.set(x.item, (sum.get(x.item) ?? 0) + x.rate);
  return sum;
};

/**
 * What a factory takes in from elsewhere: its list of supplies, and on a hand-built floor the input cards that say where
 * they come from, each for its limit. A card stands in for a supply of the same item.
 */
export function suppliesOf(p: Pick<Plan, 'supplies' | 'model'>): Supply[] {
  const cards = (p.model?.nodes ?? []).filter((n): n is IoNode => n.k === 'in' && !!n.item && !!n.from && (n.lim ?? 0) > 0);
  if (cards.length === 0) return p.supplies;
  const by = new Set(cards.map((n) => n.item));
  return [
    ...p.supplies.filter((x) => !by.has(x.item)),
    ...cards.map((n) => ({ item: n.item as string, rate: n.lim as number, from: n.from })),
  ];
}

/** What the factory tabs take from the pool, per tab. */
export const takesFromPool = (plans: Pick<Plan, 'supplies' | 'model'>[]): Target[][] =>
  plans.map((p) =>
    suppliesOf(p)
      .filter((x) => x.from === POOL)
      .map(({ item, rate }) => ({ item, rate })),
  );

/** What the power plants take from the pool, per plant: the fuel they're sized to that comes from it. */
export const plantTakesFromPool = (plants: Pick<PowerPlan, 'have'>[]): Target[][] =>
  plants.map((p) => p.have.filter((x) => x.from === POOL).map(({ item, rate }) => ({ item, rate })));

/** Which factories and plants leave each item over, by name, most first. */
export function poolSources(made: { name: string; leaves: Target[] }[]): Map<string, string[]> {
  const by = new Map<string, { name: string; rate: number }[]>();
  for (const m of made)
    for (const x of m.leaves) if (x.rate > 1e-9) by.set(x.item, [...(by.get(x.item) ?? []), { name: m.name, rate: x.rate }]);
  return new Map([...by].map(([item, list]) => [item, list.sort((a, b) => b.rate - a.rate).map((x) => x.name)]));
}

/**
 * The pool: every list of leftovers added up per item, less everything taken from it. Taking from it makes nothing
 * extra anywhere, so what's left can run out (below zero) but never loops back on itself.
 */
export function poolLines(surplus: Target[][], takes: Target[][]): PoolLine[] {
  const made = total(surplus);
  const taken = total(takes);
  return [...new Set([...made.keys(), ...taken.keys()])]
    .map((item) => {
      const m = made.get(item) ?? 0;
      const k = taken.get(item) ?? 0;
      return { item, made: m, taken: k, left: m - k };
    })
    .sort((a, b) => b.left - a.left);
}

/** One factory or plant on either side of an item in the pool, with how much of it. */
export interface PoolParty {
  id: string;
  name: string;
  power: boolean;
  rate: number;
}

/** Who stands behind each item's total, the largest first: the ones that leave it over, or the ones that take it. */
export function poolParties(sides: { id: string; name: string; power: boolean; list: Target[] }[]): Map<string, PoolParty[]> {
  const by = new Map<string, PoolParty[]>();
  for (const s of sides)
    for (const x of s.list)
      if (x.rate > 1e-9) by.set(x.item, [...(by.get(x.item) ?? []), { id: s.id, name: s.name, power: s.power, rate: x.rate }]);
  for (const list of by.values()) list.sort((a, b) => b.rate - a.rate);
  return by;
}
