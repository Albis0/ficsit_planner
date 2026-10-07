import type { Plan } from '../store';
import { POOL } from '../store';
import type { Target } from './solver';

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

/** What the factory tabs take from the pool, per tab. */
export const takesFromPool = (plans: Pick<Plan, 'supplies'>[]): Target[][] =>
  plans.map((p) => p.supplies.filter((x) => x.from === POOL).map(({ item, rate }) => ({ item, rate })));

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
